-- Full German postal areas only. No external geocoding or real data.
create table public.delivery_policy_versions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  zones jsonb not null,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (restaurant_id, location_id, id),
  foreign key (restaurant_id, location_id) references public.locations (restaurant_id, id),
  check (jsonb_typeof(zones) = 'array' and jsonb_array_length(zones) between 1 and 100)
);
create table public.delivery_policy_publications (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null,
  location_id uuid not null,
  policy_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (restaurant_id, location_id, policy_id)
    references public.delivery_policy_versions (restaurant_id, location_id, id)
);
create index delivery_policy_current_idx on public.delivery_policy_publications
  (restaurant_id, location_id, id desc);

create function private.protect_delivery_policy() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or old.published or new.id <> old.id
    or new.restaurant_id <> old.restaurant_id or new.location_id <> old.location_id
    or new.zones <> old.zones or new.created_at <> old.created_at
  then raise exception 'delivery policy is immutable'; end if;
  return new;
end;
$$;
create trigger delivery_policy_immutable before update or delete on public.delivery_policy_versions
for each row execute function private.protect_delivery_policy();
create trigger delivery_publications_immutable before update or delete on public.delivery_policy_publications
for each row execute function private.prevent_ordering_history_mutation();

create function private.create_delivery_policy(
  target_actor uuid, target_aal text, target_restaurant uuid, target_location uuid, target_zones jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare zone jsonb; postcodes text[] := '{}'; postal text; result uuid;
begin
  if private.dashboard_order_actor_role(target_restaurant,target_location,target_actor,target_aal)
    is null or private.dashboard_order_actor_role(target_restaurant,target_location,target_actor,target_aal)
    not in ('owner','manager') then raise exception 'delivery policy access denied'; end if;
  if jsonb_typeof(target_zones) is distinct from 'array'
    or jsonb_array_length(target_zones) not between 1 and 100 then raise exception 'invalid delivery zones'; end if;
  for zone in select value from jsonb_array_elements(target_zones) loop
    if jsonb_typeof(zone) is distinct from 'object'
      or not (zone ?& array['postalCodes','minimumAmountMinor','feeAmountMinor'])
      or (zone - array['postalCodes','minimumAmountMinor','feeAmountMinor']) <> '{}'::jsonb
      or jsonb_typeof(zone->'postalCodes') is distinct from 'array'
      or jsonb_array_length(zone->'postalCodes') not between 1 and 1000
      or jsonb_typeof(zone->'minimumAmountMinor') is distinct from 'number'
      or jsonb_typeof(zone->'feeAmountMinor') is distinct from 'number'
      or (zone->>'minimumAmountMinor') !~ '^[0-9]{1,9}$'
      or (zone->>'feeAmountMinor') !~ '^[0-9]{1,9}$'
    then raise exception 'invalid delivery zone'; end if;
    if exists(select 1 from jsonb_array_elements(zone->'postalCodes') p where jsonb_typeof(p) <> 'string')
    then raise exception 'ambiguous or invalid delivery postal code'; end if;
    for postal in select value from jsonb_array_elements_text(zone->'postalCodes') loop
      if postal is null or postal !~ '^[0-9]{5}$' or postal = any(postcodes)
      then raise exception 'ambiguous or invalid delivery postal code'; end if;
      postcodes := array_append(postcodes,postal);
    end loop;
  end loop;
  if cardinality(postcodes) > 10000 then raise exception 'delivery policy too large'; end if;
  insert into public.delivery_policy_versions (restaurant_id,location_id,zones)
    values (target_restaurant,target_location,target_zones) returning id into result;
  return result;
end;
$$;
create function private.publish_delivery_policy(
  target_actor uuid, target_aal text, target_restaurant uuid, target_location uuid, target_policy uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.dashboard_order_actor_role(target_restaurant,target_location,target_actor,target_aal)
    is null or private.dashboard_order_actor_role(target_restaurant,target_location,target_actor,target_aal)
    not in ('owner','manager') then raise exception 'delivery policy access denied'; end if;
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('delivery-policy:' || target_location::text,0));
  if not exists(select 1 from public.delivery_policy_versions where id=target_policy
    and restaurant_id=target_restaurant and location_id=target_location)
  then raise exception 'delivery policy unavailable'; end if;
  update public.delivery_policy_versions set published=true where id=target_policy and not published;
  insert into public.delivery_policy_publications(restaurant_id,location_id,policy_id)
    values(target_restaurant,target_location,target_policy);
end;
$$;

alter table public.orders add column delivery_fee_amount_minor bigint not null default 0
  check (delivery_fee_amount_minor between 0 and 999999999);
alter table public.orders add column delivery_policy_id uuid;
alter table public.orders add constraint orders_delivery_policy_fk
  foreign key (restaurant_id,location_id,delivery_policy_id)
  references public.delivery_policy_versions(restaurant_id,location_id,id);
alter table public.orders drop constraint orders_total_matches_subtotal;
alter table public.orders add constraint orders_total_matches_components
  check (total_amount_minor = subtotal_amount_minor + delivery_fee_amount_minor);
alter table public.orders add constraint orders_pickup_has_no_delivery_charge
  check (fulfillment_type = 'delivery' or (delivery_fee_amount_minor=0 and delivery_policy_id is null));
create function private.protect_delivery_order_price() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.delivery_fee_amount_minor is distinct from old.delivery_fee_amount_minor
    or new.delivery_policy_id is distinct from old.delivery_policy_id
  then raise exception 'delivery price snapshot is immutable'; end if;
  return new;
end;
$$;
create trigger orders_delivery_price_immutable before update on public.orders
for each row execute function private.protect_delivery_order_price();

create function private.quote_public_delivery_order(
  restaurant_slug text, location_slug text, menu_id uuid, menu_version_id uuid,
  requested_for timestamptz, lines jsonb, postal_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare restaurant uuid; location uuid; policy uuid; zone jsonb; subtotal bigint; quantity integer;
  matched integer; currency text; fee bigint; minimum bigint;
begin
  if postal_code is null or postal_code !~ '^[0-9]{5}$'
    or jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) not between 1 and 100
  then raise exception 'invalid delivery request'; end if;
  select r.id,l.id into restaurant,location from public.restaurants r
    join public.locations l on l.restaurant_id=r.id where r.slug=restaurant_slug and l.slug=location_slug;
  if location is null or private.read_storefront_catalog(restaurant_slug,location_slug) is null
  then raise exception 'delivery unavailable'; end if;
  select p.policy_id into policy from public.delivery_policy_publications p
    where p.restaurant_id=restaurant and p.location_id=location order by p.id desc limit 1;
  select z.value into zone from public.delivery_policy_versions v,
    lateral jsonb_array_elements(v.zones) z where v.id=policy and v.published
    and z.value->'postalCodes' ? postal_code;
  if zone is null then raise exception 'delivery area unavailable'; end if;
  if private.resolve_public_menu_version(restaurant,location,menu_id,statement_timestamp())
    is distinct from menu_version_id then raise exception 'delivery menu unavailable'; end if;
  if exists(select 1 from jsonb_array_elements(lines) x where jsonb_typeof(x) <> 'object'
    or not (x ?& array['menu_item_id','quantity']) or (x - array['menu_item_id','quantity']) <> '{}'::jsonb
    or jsonb_typeof(x->'quantity') <> 'number' or (x->>'quantity') !~ '^[1-9][0-9]{0,3}$')
    or (select count(distinct x->>'menu_item_id') from jsonb_array_elements(lines) x) <> jsonb_array_length(lines)
  then raise exception 'invalid delivery lines'; end if;
  select count(*)::integer,sum(i.price_amount_minor*x.quantity)::bigint,sum(x.quantity)::integer
    into matched,subtotal,quantity from jsonb_to_recordset(lines) x(menu_item_id uuid,quantity integer)
    join public.menu_version_items i on i.restaurant_id=restaurant and i.menu_id=quote_public_delivery_order.menu_id
      and i.menu_version_id=quote_public_delivery_order.menu_version_id and i.menu_item_id=x.menu_item_id and i.is_active
    left join public.menu_item_location_availability a on a.restaurant_id=restaurant and a.location_id=location
      and a.menu_id=i.menu_id and a.menu_item_id=i.menu_item_id
    where coalesce(a.status,'available')='available' and x.quantity between 1 and 1000;
  if matched <> jsonb_array_length(lines) or quantity not between 1 and 1000
  then raise exception 'delivery items unavailable'; end if;
  select v.currency_code into currency from public.menu_versions v where v.id=menu_version_id;
  if currency is distinct from 'EUR' then raise exception 'delivery currency unavailable'; end if;
  fee := (zone->>'feeAmountMinor')::bigint;
  minimum := (zone->>'minimumAmountMinor')::bigint;
  if subtotal < minimum then raise exception 'delivery minimum not reached'; end if;
  if private.read_storefront_availability(restaurant_slug,location_slug,'delivery',requested_for,quantity)
    ->>'status' is distinct from 'available' then raise exception 'delivery time unavailable'; end if;
  return jsonb_build_object('policyId',policy,'subtotalAmountMinor',subtotal,
    'deliveryFeeAmountMinor',fee,'totalAmountMinor',subtotal+fee,'minimumAmountMinor',minimum,'currency',currency);
end;
$$;

alter table public.delivery_policy_versions enable row level security;
alter table public.delivery_policy_versions force row level security;
alter table public.delivery_policy_publications enable row level security;
alter table public.delivery_policy_publications force row level security;
revoke all on public.delivery_policy_versions, public.delivery_policy_publications from public,anon,authenticated,service_role;
revoke all on function private.protect_delivery_policy(),private.protect_delivery_order_price() from public,anon,authenticated,service_role;
revoke all on function private.create_delivery_policy(uuid,text,uuid,uuid,jsonb),
  private.publish_delivery_policy(uuid,text,uuid,uuid,uuid),
  private.quote_public_delivery_order(text,text,uuid,uuid,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function private.create_delivery_policy(uuid,text,uuid,uuid,jsonb),
  private.publish_delivery_policy(uuid,text,uuid,uuid,uuid),
  private.quote_public_delivery_order(text,text,uuid,uuid,timestamptz,jsonb,text) to service_role;
