-- Global immutable identity, including existing orders. A reference is never an access credential.
alter table public.orders
  add column order_number bigint generated always as identity (no cycle);
alter table public.orders
  add constraint orders_order_number_unique unique (order_number);

create function private.format_order_number(number bigint)
returns text language sql immutable strict set search_path = '' as $$
  select 'BS-' || lpad(number::text, greatest(8, length(number::text)), '0');
$$;
revoke all on function private.format_order_number(bigint) from public, anon, authenticated;
grant execute on function private.format_order_number(bigint) to service_role;

create function private.prevent_order_number_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.order_number is distinct from old.order_number then
    raise exception 'order number is immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_order_number_change() from public, anon, authenticated;
create trigger orders_immutable_order_number before update on public.orders
for each row execute function private.prevent_order_number_change();

-- Backend-only enrichment of projections already produced by an authorized boundary.
create function private.attach_order_number(value jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb; number bigint;
begin
  if value is null then return null; end if;
  if jsonb_typeof(value) = 'array' then
    select coalesce(jsonb_agg(private.attach_order_number(entry.value) order by entry.ordinality), '[]'::jsonb)
    into result from jsonb_array_elements(value) with ordinality as entry(value, ordinality);
    return result;
  end if;
  if jsonb_typeof(value) <> 'object' then return value; end if;
  result := value;
  if value ? 'orderId' then
    select o.order_number into number from public.orders o where o.id = (value->>'orderId')::uuid;
    if number is null then raise exception 'missing order number projection'; end if;
    result := result || jsonb_build_object('orderNumber', private.format_order_number(number));
  end if;
  if value ? 'data' then
    result := jsonb_set(result, '{data}', private.attach_order_number(value->'data'));
  end if;
  if value ? 'orders' then
    result := jsonb_set(result, '{orders}', private.attach_order_number(value->'orders'));
  end if;
  return result;
end;
$$;
revoke all on function private.attach_order_number(jsonb) from public, anon, authenticated;
grant execute on function private.attach_order_number(jsonb) to service_role;

comment on column public.orders.order_number is
  'Globally unique immutable identity; readable BS- reference. Not an access credential. Gaps are permitted.';
comment on function private.attach_order_number(jsonb) is
  'Backend-only enrichment of previously authorized projections; never a public order lookup.';

-- Exact number search reuses existing authorization and detail projection. No customer lookup.
create function private.read_dashboard_orders_by_number(
  actor uuid, aal text, restaurant uuid, location uuid, status_filter text,
  cursor_time timestamptz, cursor_id uuid, page_size integer, fulfillment text, target_number bigint
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare target uuid; detail jsonb; summary jsonb; rows jsonb := '[]'::jsonb;
begin
  if target_number is null then
    return private.read_dashboard_fulfillment_orders(actor,aal,restaurant,location,status_filter,cursor_time,cursor_id,page_size,fulfillment);
  end if;
  if target_number < 1 or page_size is null or page_size not between 1 and 50
    or (fulfillment is not null and fulfillment not in ('pickup','delivery'))
    or (status_filter is not null and status_filter not in ('submitted','accepted','preparing','ready','completed','rejected','cancelled'))
    or ((cursor_time is null) <> (cursor_id is null)) then
    return jsonb_build_object('outcome','invalid');
  end if;
  if private.dashboard_order_actor_role(restaurant,location,actor,aal) is null then
    return jsonb_build_object('outcome','forbidden');
  end if;
  select o.id into target from public.orders o
    where o.restaurant_id=restaurant and o.location_id=location and o.order_number=target_number
      and (fulfillment is null or o.fulfillment_type=fulfillment)
      and (status_filter is null or o.status=status_filter)
      and (cursor_time is null or (o.requested_for,o.id)>(cursor_time,cursor_id));
  if target is not null then
    detail := private.read_dashboard_order(actor,aal,restaurant,location,target);
    if detail->>'outcome'='allowed' then
      select jsonb_object_agg(field.key,field.value) into summary from jsonb_each(detail->'data') as field(key,value)
        where field.key in ('orderId','status','fulfillmentType','paymentCollectionMode','paymentState',
          'requestedFor','currency','totalAmountMinor','itemCount','updatedAt','allowedTransitions');
      rows := jsonb_build_array(summary);
    end if;
  end if;
  return jsonb_build_object('outcome','allowed','data',jsonb_build_object(
    'restaurantId',restaurant,'locationId',location,'orders',rows,'nextCursor',null));
end;
$$;
revoke all on function private.read_dashboard_orders_by_number(uuid,text,uuid,uuid,text,timestamptz,uuid,integer,text,bigint)
  from public,anon,authenticated;
grant execute on function private.read_dashboard_orders_by_number(uuid,text,uuid,uuid,text,timestamptz,uuid,integer,text,bigint)
  to service_role;
