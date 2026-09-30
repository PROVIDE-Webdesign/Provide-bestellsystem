-- Item configuration belongs to the immutable menu-version aggregate. NULL denotes legacy data,
-- never an inferred tax/allergen declaration. Browser roles acquire no new write privileges.
create function private.valid_menu_configuration(config jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare x jsonb; g jsonb; labels jsonb; ids text[] := '{}'; option_count integer:=0;
begin
 if config is null then return true; end if;
 if jsonb_typeof(config)<>'object' or not(config ?& array['schemaVersion','informationConfirmed','taxRateBasisPoints','allergens','additives','variants','optionGroups'])
 or config-array['schemaVersion','informationConfirmed','taxRateBasisPoints','allergens','additives','variants','optionGroups']<>'{}'::jsonb
 or config->'schemaVersion'<>'1'::jsonb or config->'informationConfirmed'<>'true'::jsonb
 or jsonb_typeof(config->'taxRateBasisPoints')<>'number' or (config->>'taxRateBasisPoints') !~ '^[0-9]{1,5}$'
 or (config->>'taxRateBasisPoints')::integer>10000 then return false; end if;
 foreach labels in array array[config->'allergens',config->'additives'] loop
  if jsonb_typeof(labels)<>'array' or jsonb_array_length(labels)>64 then return false; end if;
  if exists(select 1 from jsonb_array_elements(labels) e where jsonb_typeof(e)<>'string' or char_length(e#>>'{}') not between 1 and 120 or btrim(e#>>'{}')='' or (e#>>'{}') ~ '[[:cntrl:]]')
  or (select count(distinct e) from jsonb_array_elements(labels) e)<>jsonb_array_length(labels) then return false; end if;
 end loop;
 if jsonb_typeof(config->'variants')<>'array' or jsonb_array_length(config->'variants')>20
 or jsonb_typeof(config->'optionGroups')<>'array' or jsonb_array_length(config->'optionGroups')>20 then return false; end if;
 if jsonb_array_length(config->'variants')>0 and not exists(select 1 from jsonb_array_elements(config->'variants') v where v->'isActive'='true'::jsonb) then return false; end if;
 -- Group IDs and choice IDs share one namespace within an item configuration.
 for g in select value from jsonb_array_elements(config->'optionGroups') loop
  if jsonb_typeof(g)<>'object' or not(g ?& array['id','name','minSelections','maxSelections','options'])
  or g-array['id','name','minSelections','maxSelections','options']<>'{}'::jsonb
  or jsonb_typeof(g->'id')<>'string' or (g->>'id') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or lower(g->>'id')=any(ids) or jsonb_typeof(g->'name')<>'string' or char_length(g->>'name') not between 1 and 100 or btrim(g->>'name')='' or (g->>'name')~'[[:cntrl:]]'
  or jsonb_typeof(g->'minSelections')<>'number' or (g->>'minSelections')!~'^[0-9]{1,2}$'
  or jsonb_typeof(g->'maxSelections')<>'number' or (g->>'maxSelections')!~'^[0-9]{1,2}$'
  or jsonb_typeof(g->'options')<>'array' or jsonb_array_length(g->'options') not between 1 and 50
  or (g->>'minSelections')::integer>(g->>'maxSelections')::integer or (g->>'maxSelections')::integer>jsonb_array_length(g->'options')
  or (g->>'minSelections')::integer>(select count(*) from jsonb_array_elements(g->'options') o where o->'isActive'='true'::jsonb) then return false; end if;
  ids:=array_append(ids,lower(g->>'id')); option_count:=option_count+jsonb_array_length(g->'options');
 end loop;
 if option_count>200 then return false; end if;
 for x in select value from jsonb_array_elements(config->'variants') union all
 select o.value from jsonb_array_elements(config->'optionGroups') g cross join lateral jsonb_array_elements(g->'options') o loop
  if jsonb_typeof(x)<>'object' or not(x ?& array['id','name','priceDeltaAmountMinor','isActive'])
  or x-array['id','name','priceDeltaAmountMinor','isActive']<>'{}'::jsonb
  or jsonb_typeof(x->'id')<>'string' or (x->>'id') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or lower(x->>'id')=any(ids) or jsonb_typeof(x->'name')<>'string' or char_length(x->>'name') not between 1 and 100 or btrim(x->>'name')='' or (x->>'name')~'[[:cntrl:]]'
  or jsonb_typeof(x->'priceDeltaAmountMinor')<>'number' or (x->>'priceDeltaAmountMinor') !~ '^[0-9]{1,10}$'
  or (x->>'priceDeltaAmountMinor')::bigint>1000000000 or jsonb_typeof(x->'isActive')<>'boolean' then return false; end if;
  ids:=array_append(ids,lower(x->>'id'));
 end loop;
 return true;
exception when others then return false;
end; $$;
revoke all on function private.valid_menu_configuration(jsonb) from public,anon,authenticated,service_role;
alter table public.menu_version_items add column configuration jsonb;
alter table public.menu_version_items add constraint menu_item_configuration_valid check(private.valid_menu_configuration(configuration));
-- CHECK predicates are required by existing scoped draft table writes. The validator reads no data.
grant execute on function private.valid_menu_configuration(jsonb) to service_role;
alter table public.menu_version_items add column configuration_revision integer not null default 0 check(configuration_revision>=0);
alter table public.order_lines add column selection_snapshot jsonb;
alter table public.order_lines add constraint order_selection_snapshot_object check(selection_snapshot is null or jsonb_typeof(selection_snapshot)='object');

create function private.canonical_menu_lines(lines jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare l jsonb; c jsonb; result jsonb:='[]'; ids jsonb; total integer:=0; keys text[]:='{}'; k text;
begin
 if jsonb_typeof(lines) is distinct from 'array' then raise exception 'order lines must be an array'; end if;
 if jsonb_array_length(lines) not between 1 and 100 then raise exception 'order line count is invalid'; end if;
 for l in select value from jsonb_array_elements(lines) loop
  if jsonb_typeof(l)<>'object' or not(l ?& array['menu_item_id','quantity'])
  or l-array['menu_item_id','quantity','variant_id','option_ids']<>'{}'::jsonb
  or jsonb_typeof(l->'menu_item_id')<>'string' or (l->>'menu_item_id') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or jsonb_typeof(l->'quantity')<>'number' or (l->>'quantity')!~'^[1-9][0-9]{0,3}$' or (l->>'quantity')::integer>1000
  then raise exception 'order item quantity is invalid'; end if;
  if l ? 'variant_id' and (jsonb_typeof(l->'variant_id') is distinct from 'string' or (l->>'variant_id') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') then raise exception 'invalid menu selection'; end if;
  ids:=coalesce(l->'option_ids','[]'::jsonb);
  if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>200 then raise exception 'invalid menu selection'; end if;
  if exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string' or (x#>>'{}') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') then raise exception 'invalid menu selection'; end if;
  select coalesce(jsonb_agg(lower(value) order by lower(value)),'[]'::jsonb) into ids from jsonb_array_elements_text(ids);
  if (select count(distinct value) from jsonb_array_elements(ids))<>jsonb_array_length(ids) then raise exception 'invalid menu selection'; end if;
  c:=jsonb_build_object('menu_item_id',lower(l->>'menu_item_id'),'quantity',(l->>'quantity')::integer);
  if l ? 'variant_id' then c:=c||jsonb_build_object('variant_id',lower(l->>'variant_id')); end if;
  if jsonb_array_length(ids)>0 then c:=c||jsonb_build_object('option_ids',ids); end if;
  k:=(c-'quantity')::text;
  if k=any(keys) then raise exception 'order lines contain duplicate menu items'; end if;
  keys:=array_append(keys,k); total:=total+(l->>'quantity')::integer;
  if total>1000 then raise exception 'order item quantity is invalid'; end if;
  result:=result||jsonb_build_array(c);
 end loop;
 select jsonb_agg(value order by value->>'menu_item_id',coalesce(value->>'variant_id',''),coalesce((value->'option_ids')::text,'')) into result from jsonb_array_elements(result);
 return result;
end; $$;
revoke all on function private.canonical_menu_lines(jsonb) from public,anon,authenticated,service_role;

create function private.price_menu_lines(restaurant uuid,location uuid,menu uuid,version uuid,lines jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l jsonb; item public.menu_version_items%rowtype; cfg jsonb; variant jsonb; opt jsonb; g jsonb;
 selected jsonb; snapshot jsonb; priced jsonb:='[]'; unit bigint; gross bigint; subtotal bigint:=0; amount integer:=0; found_count integer; group_count integer; tax bigint;
begin
 for l in select value from jsonb_array_elements(private.canonical_menu_lines(lines)) loop
  select i.* into item from public.menu_version_items i left join public.menu_item_location_availability a
   on a.restaurant_id=i.restaurant_id and a.location_id=location and a.menu_id=i.menu_id and a.menu_item_id=i.menu_item_id
   where i.restaurant_id=restaurant and i.menu_id=menu and i.menu_version_id=version and i.menu_item_id=(l->>'menu_item_id')::uuid
   and i.is_active and coalesce(a.status,'available')='available';
  if item.menu_item_id is null then raise exception 'order contains unavailable menu items'; end if;
  cfg:=item.configuration; unit:=item.price_amount_minor; variant:=null; selected:='[]';
  if cfg is null then
   if l ? 'variant_id' or l ? 'option_ids' then raise exception 'invalid menu selection'; end if;
   snapshot:=null;
  else
   if jsonb_array_length(cfg->'variants')>0 then
    select v into variant from jsonb_array_elements(cfg->'variants') v where lower(v->>'id')=l->>'variant_id' and v->'isActive'='true'::jsonb;
    if variant is null then raise exception 'invalid menu selection'; end if;
    unit:=unit+(variant->>'priceDeltaAmountMinor')::bigint;
   elsif l ? 'variant_id' then raise exception 'invalid menu selection'; end if;
   found_count:=0;
   for g in select value from jsonb_array_elements(cfg->'optionGroups') loop
    group_count:=0;
    for opt in select value from jsonb_array_elements(g->'options') loop
     if coalesce(l->'option_ids','[]'::jsonb) ? lower(opt->>'id') then
      if opt->'isActive'<>'true'::jsonb then raise exception 'invalid menu selection'; end if;
      group_count:=group_count+1; found_count:=found_count+1; unit:=unit+(opt->>'priceDeltaAmountMinor')::bigint;
      selected:=selected||jsonb_build_array(opt-'isActive');
     end if;
    end loop;
    if group_count not between (g->>'minSelections')::integer and (g->>'maxSelections')::integer then raise exception 'invalid menu selection'; end if;
   end loop;
   if found_count<>jsonb_array_length(coalesce(l->'option_ids','[]'::jsonb)) then raise exception 'invalid menu selection'; end if;
   if unit>1000000000 then raise exception 'menu selection amount is invalid'; end if;
   gross:=unit*(l->>'quantity')::integer;
   tax:=round(gross::numeric*(cfg->>'taxRateBasisPoints')::integer/(10000+(cfg->>'taxRateBasisPoints')::integer))::bigint;
   snapshot:=jsonb_build_object('schemaVersion',1,'variant',variant-'isActive','options',selected,'allergens',cfg->'allergens','additives',cfg->'additives','taxRateBasisPoints',cfg->'taxRateBasisPoints','taxAmountMinor',tax);
  end if;
  gross:=unit*(l->>'quantity')::integer; subtotal:=subtotal+gross; amount:=amount+(l->>'quantity')::integer;
  priced:=priced||jsonb_build_array(l||jsonb_build_object('display_name',item.display_name,'unit_price_amount_minor',unit,'line_amount_minor',gross,'selection_snapshot',snapshot));
 end loop;
 return jsonb_build_object('lines',priced,'subtotal',subtotal,'item_count',amount);
end; $$;
revoke all on function private.price_menu_lines(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function private.set_menu_item_configuration(restaurant uuid,menu uuid,version uuid,item uuid,actor uuid,aal text,expected_revision integer,configuration jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare current_revision integer;
begin
 if aal is distinct from 'aal2' then raise exception 'menu administration requires aal2'; end if;
 perform private.assert_menu_actor(restaurant,null,actor,aal);
 if configuration is null or not private.valid_menu_configuration(configuration) then raise exception 'invalid menu configuration'; end if;
 perform 1 from public.menu_versions v where v.restaurant_id=restaurant and v.menu_id=menu and v.id=version and v.status='draft' for update;
 if not found then return 'conflict'; end if;
 select i.configuration_revision into current_revision from public.menu_version_items i where i.restaurant_id=restaurant and i.menu_id=menu and i.menu_version_id=version and i.menu_item_id=item for update;
 if not found or expected_revision is distinct from current_revision then return 'conflict'; end if;
 update public.menu_version_items i set configuration=set_menu_item_configuration.configuration,configuration_revision=configuration_revision+1 where i.restaurant_id=restaurant and i.menu_id=menu and i.menu_version_id=version and i.menu_item_id=item;
 insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(restaurant,'menu_item',item,'menu.item.configuration_changed',jsonb_build_object('menu_version_id',version,'revision',current_revision+1),'menu-config:'||version::text||':'||item::text||':'||(current_revision+1)::text);
 return 'updated';
end; $$;
revoke all on function private.set_menu_item_configuration(uuid,uuid,uuid,uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function private.set_menu_item_configuration(uuid,uuid,uuid,uuid,uuid,text,integer,jsonb) to service_role;

create or replace function private.submit_order(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_menu_id uuid,
  target_menu_version_id uuid,
  target_fulfillment_type text,
  target_requested_for timestamptz,
  target_lines jsonb,
  target_submission_key text,
  target_evaluated_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_submission_key text := btrim(target_submission_key);
  requested_line_count integer;
  distinct_line_count integer;
  invalid_line_count integer;
  requested_item_count integer;
  matched_line_count integer;
  canonical_lines jsonb;
  canonical_payload jsonb;
  existing_order public.orders%rowtype;
  selected_menu_version public.menu_versions%rowtype;
  created_order_id uuid := gen_random_uuid();
  capacity_claim_key text;
  selected_capacity_claim public.ordering_capacity_claims%rowtype;
  subtotal bigint;
  priced jsonb;
  menu_clock_started_at timestamptz := clock_timestamp();
  menu_evaluated_at timestamptz;
begin
  if target_fulfillment_type not in ('pickup', 'delivery') then
    raise exception using errcode = 'P0001', message = 'order fulfillment type is invalid';
  end if;

  if normalized_submission_key is null
    or normalized_submission_key = ''
    or char_length(normalized_submission_key) < 8
    or char_length(normalized_submission_key) > 128
  then
    raise exception using errcode = 'P0001', message = 'order submission key is invalid';
  end if;

  if jsonb_typeof(target_lines) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'order lines must be an array';
  end if;

  if target_requested_for is null or target_evaluated_at is null then
    raise exception using errcode = 'P0001', message = 'order timestamps are required';
  end if;

  canonical_lines := private.canonical_menu_lines(target_lines);
  select sum((value->>'quantity')::integer)::integer into requested_item_count from jsonb_array_elements(canonical_lines);
  requested_line_count := jsonb_array_length(canonical_lines);

  canonical_payload := jsonb_build_object(
    'menu_id', target_menu_id,
    'menu_version_id', target_menu_version_id,
    'fulfillment_type', target_fulfillment_type,
    'requested_for', target_requested_for,
    'lines', canonical_lines
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_restaurant_id::text || ':' || target_location_id::text || ':'
      || normalized_submission_key,
      0
    )
  );

  select order_record.*
  into existing_order
  from public.orders as order_record
  where order_record.restaurant_id = target_restaurant_id
    and order_record.location_id = target_location_id
    and order_record.submission_key = normalized_submission_key;

  if existing_order.id is not null then
    if existing_order.submission_payload = canonical_payload then
      return existing_order.id;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'order submission key was reused with different values';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('menu-publication:'||target_restaurant_id::text||':'||target_location_id::text||':'||target_menu_id::text,0));
  -- A publication can become effective while this checkout waits for the shared lock.
  menu_evaluated_at := target_evaluated_at + (clock_timestamp() - menu_clock_started_at);
  if private.resolve_public_menu_version(
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    menu_evaluated_at
  ) is distinct from target_menu_version_id then
    raise exception using errcode = 'P0001', message = 'order menu version is not publicly active';
  end if;

  select version.*
  into selected_menu_version
  from public.menu_versions as version
  where version.restaurant_id = target_restaurant_id
    and version.menu_id = target_menu_id
    and version.id = target_menu_version_id
    and version.status = 'published';

  if selected_menu_version.id is null then
    raise exception using errcode = 'P0001', message = 'published order menu version was not found';
  end if;

  priced := private.price_menu_lines(target_restaurant_id,target_location_id,target_menu_id,target_menu_version_id,canonical_lines);
  subtotal := (priced->>'subtotal')::bigint;

  capacity_claim_key := 'order:' || created_order_id::text;

  if not private.reserve_ordering_capacity(
    target_restaurant_id,
    target_location_id,
    target_fulfillment_type,
    target_requested_for,
    requested_item_count,
    capacity_claim_key,
    target_evaluated_at
  ) then
    raise exception using errcode = 'P0001', message = 'order is not available';
  end if;

  select claim.*
  into selected_capacity_claim
  from public.ordering_capacity_claims as claim
  where claim.restaurant_id = target_restaurant_id
    and claim.location_id = target_location_id
    and claim.fulfillment_type = target_fulfillment_type
    and claim.claim_key = capacity_claim_key
    and claim.claim_kind = 'reserve';

  if selected_capacity_claim.id is null then
    raise exception using errcode = 'P0001', message = 'order capacity reservation was not found';
  end if;

  insert into public.orders (
    id,
    restaurant_id,
    location_id,
    menu_id,
    menu_version_id,
    schedule_version_id,
    capacity_claim_id,
    submission_key,
    submission_payload,
    fulfillment_type,
    requested_for,
    currency_code,
    subtotal_amount_minor,
    total_amount_minor,
    item_count
  )
  values (
    created_order_id,
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_menu_version_id,
    selected_capacity_claim.schedule_version_id,
    selected_capacity_claim.id,
    normalized_submission_key,
    canonical_payload,
    target_fulfillment_type,
    target_requested_for,
    selected_menu_version.currency_code,
    subtotal,
    subtotal,
    requested_item_count
  );

  insert into public.order_lines(restaurant_id,location_id,order_id,line_number,menu_id,menu_version_id,menu_item_id,display_name,quantity,unit_price_amount_minor,line_amount_minor,selection_snapshot)
  select target_restaurant_id,target_location_id,created_order_id,ordinality::integer,target_menu_id,target_menu_version_id,
   (value->>'menu_item_id')::uuid,value->>'display_name',(value->>'quantity')::integer,
   (value->>'unit_price_amount_minor')::bigint,(value->>'line_amount_minor')::bigint,nullif(value->'selection_snapshot','null'::jsonb)
  from jsonb_array_elements(priced->'lines') with ordinality;

  insert into public.order_status_events (
    restaurant_id,
    location_id,
    order_id,
    event_sequence,
    from_status,
    to_status,
    actor_kind
  )
  values (
    target_restaurant_id,
    target_location_id,
    created_order_id,
    1,
    null,
    'submitted',
    'system'
  );

  insert into public.outbox_events (
    restaurant_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    idempotency_key
  )
  values (
    target_restaurant_id,
    'order',
    created_order_id,
    'order.submitted',
    jsonb_build_object(
      'order_id', created_order_id,
      'location_id', target_location_id,
      'fulfillment_type', target_fulfillment_type,
      'requested_for', target_requested_for,
      'status', 'submitted',
      'currency_code', selected_menu_version.currency_code,
      'total_amount_minor', subtotal,
      'item_count', requested_item_count
    ),
    'order-submitted:' || created_order_id::text
  );

  return created_order_id;
end;
$$;

create or replace function private.submit_priced_delivery_order(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_menu_id uuid,
  target_menu_version_id uuid,
  target_fulfillment_type text,
  target_requested_for timestamptz,
  target_lines jsonb,
  target_submission_key text,
  target_evaluated_at timestamptz,
  target_policy_id uuid,
  target_fee bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_submission_key text := btrim(target_submission_key);
  requested_line_count integer;
  distinct_line_count integer;
  invalid_line_count integer;
  requested_item_count integer;
  matched_line_count integer;
  canonical_lines jsonb;
  canonical_payload jsonb;
  existing_order public.orders%rowtype;
  selected_menu_version public.menu_versions%rowtype;
  created_order_id uuid := gen_random_uuid();
  capacity_claim_key text;
  selected_capacity_claim public.ordering_capacity_claims%rowtype;
  subtotal bigint;
  priced jsonb;
  menu_clock_started_at timestamptz := clock_timestamp();
  menu_evaluated_at timestamptz;
begin
  if target_fulfillment_type <> 'delivery' or target_policy_id is null or target_fee is null or target_fee < 0 then
    raise exception 'invalid delivery price';
  end if;
  if target_fulfillment_type not in ('pickup', 'delivery') then
    raise exception using errcode = 'P0001', message = 'order fulfillment type is invalid';
  end if;

  if normalized_submission_key is null
    or normalized_submission_key = ''
    or char_length(normalized_submission_key) < 8
    or char_length(normalized_submission_key) > 128
  then
    raise exception using errcode = 'P0001', message = 'order submission key is invalid';
  end if;

  if jsonb_typeof(target_lines) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'order lines must be an array';
  end if;

  if target_requested_for is null or target_evaluated_at is null then
    raise exception using errcode = 'P0001', message = 'order timestamps are required';
  end if;

  canonical_lines := private.canonical_menu_lines(target_lines);
  select sum((value->>'quantity')::integer)::integer into requested_item_count from jsonb_array_elements(canonical_lines);
  requested_line_count := jsonb_array_length(canonical_lines);

  canonical_payload := jsonb_build_object(
    'menu_id', target_menu_id,
    'menu_version_id', target_menu_version_id,
    'fulfillment_type', target_fulfillment_type,
    'requested_for', target_requested_for,
    'lines', canonical_lines,
    'delivery_policy_id', target_policy_id,
    'delivery_fee_amount_minor', target_fee
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_restaurant_id::text || ':' || target_location_id::text || ':'
      || normalized_submission_key,
      0
    )
  );

  select order_record.*
  into existing_order
  from public.orders as order_record
  where order_record.restaurant_id = target_restaurant_id
    and order_record.location_id = target_location_id
    and order_record.submission_key = normalized_submission_key;

  if existing_order.id is not null then
    if existing_order.submission_payload = canonical_payload then
      return existing_order.id;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'order submission key was reused with different values';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('menu-publication:'||target_restaurant_id::text||':'||target_location_id::text||':'||target_menu_id::text,0));
  -- A publication can become effective while this checkout waits for the shared lock.
  menu_evaluated_at := target_evaluated_at + (clock_timestamp() - menu_clock_started_at);
  if private.resolve_public_menu_version(
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    menu_evaluated_at
  ) is distinct from target_menu_version_id then
    raise exception using errcode = 'P0001', message = 'order menu version is not publicly active';
  end if;

  select version.*
  into selected_menu_version
  from public.menu_versions as version
  where version.restaurant_id = target_restaurant_id
    and version.menu_id = target_menu_id
    and version.id = target_menu_version_id
    and version.status = 'published';

  if selected_menu_version.id is null then
    raise exception using errcode = 'P0001', message = 'published order menu version was not found';
  end if;

  priced := private.price_menu_lines(target_restaurant_id,target_location_id,target_menu_id,target_menu_version_id,canonical_lines);
  subtotal := (priced->>'subtotal')::bigint;

  capacity_claim_key := 'order:' || created_order_id::text;

  if not private.reserve_ordering_capacity(
    target_restaurant_id,
    target_location_id,
    target_fulfillment_type,
    target_requested_for,
    requested_item_count,
    capacity_claim_key,
    target_evaluated_at
  ) then
    raise exception using errcode = 'P0001', message = 'order is not available';
  end if;

  select claim.*
  into selected_capacity_claim
  from public.ordering_capacity_claims as claim
  where claim.restaurant_id = target_restaurant_id
    and claim.location_id = target_location_id
    and claim.fulfillment_type = target_fulfillment_type
    and claim.claim_key = capacity_claim_key
    and claim.claim_kind = 'reserve';

  if selected_capacity_claim.id is null then
    raise exception using errcode = 'P0001', message = 'order capacity reservation was not found';
  end if;

  insert into public.orders (
    id,
    restaurant_id,
    location_id,
    menu_id,
    menu_version_id,
    schedule_version_id,
    capacity_claim_id,
    submission_key,
    submission_payload,
    fulfillment_type,
    requested_for,
    currency_code,
    subtotal_amount_minor,
    delivery_policy_id,
    delivery_fee_amount_minor,
    total_amount_minor,
    item_count
  )
  values (
    created_order_id,
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_menu_version_id,
    selected_capacity_claim.schedule_version_id,
    selected_capacity_claim.id,
    normalized_submission_key,
    canonical_payload,
    target_fulfillment_type,
    target_requested_for,
    selected_menu_version.currency_code,
    subtotal,
    target_policy_id,
    target_fee,
    subtotal + target_fee,
    requested_item_count
  );

  insert into public.order_lines(restaurant_id,location_id,order_id,line_number,menu_id,menu_version_id,menu_item_id,display_name,quantity,unit_price_amount_minor,line_amount_minor,selection_snapshot)
  select target_restaurant_id,target_location_id,created_order_id,ordinality::integer,target_menu_id,target_menu_version_id,
   (value->>'menu_item_id')::uuid,value->>'display_name',(value->>'quantity')::integer,
   (value->>'unit_price_amount_minor')::bigint,(value->>'line_amount_minor')::bigint,nullif(value->'selection_snapshot','null'::jsonb)
  from jsonb_array_elements(priced->'lines') with ordinality;

  insert into public.order_status_events (
    restaurant_id,
    location_id,
    order_id,
    event_sequence,
    from_status,
    to_status,
    actor_kind
  )
  values (
    target_restaurant_id,
    target_location_id,
    created_order_id,
    1,
    null,
    'submitted',
    'system'
  );

  insert into public.outbox_events (
    restaurant_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    idempotency_key
  )
  values (
    target_restaurant_id,
    'order',
    created_order_id,
    'order.submitted',
    jsonb_build_object(
      'order_id', created_order_id,
      'location_id', target_location_id,
      'fulfillment_type', target_fulfillment_type,
      'requested_for', target_requested_for,
      'status', 'submitted',
      'currency_code', selected_menu_version.currency_code,
      'total_amount_minor', subtotal + target_fee,
      'item_count', requested_item_count
    ),
    'order-submitted:' || created_order_id::text
  );

  return created_order_id;
end;
$$;

create or replace function private.create_menu_draft(
  target_restaurant_id uuid,
  target_menu_id uuid,
  target_source_version_id uuid,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_version_id uuid := gen_random_uuid();
  created_version_number integer;
  restaurant_currency text;
begin
  perform private.assert_menu_actor(
    target_restaurant_id,
    null,
    target_actor_user_id,
    target_authentication_assurance
  );

  if not exists (
    select 1
    from public.menus as menu
    where menu.restaurant_id = target_restaurant_id
      and menu.id = target_menu_id
      and menu.status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'active menu was not found';
  end if;

  if target_source_version_id is not null
    and not exists (
      select 1
      from public.menu_versions as source_version
      where source_version.restaurant_id = target_restaurant_id
        and source_version.menu_id = target_menu_id
        and source_version.id = target_source_version_id
        and source_version.status = 'published'
    )
  then
    raise exception using errcode = 'P0001', message = 'published source menu version was not found';
  end if;

  select restaurant.currency_code
  into restaurant_currency
  from public.restaurants as restaurant
  where restaurant.id = target_restaurant_id;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_restaurant_id::text || ':' || target_menu_id::text, 0)
  );

  select coalesce(max(version.version_number), 0) + 1
  into created_version_number
  from public.menu_versions as version
  where version.restaurant_id = target_restaurant_id
    and version.menu_id = target_menu_id;

  insert into public.menu_versions (
    id,
    restaurant_id,
    menu_id,
    version_number,
    currency_code,
    source_version_id,
    created_by_user_id
  )
  values (
    created_version_id,
    target_restaurant_id,
    target_menu_id,
    created_version_number,
    restaurant_currency,
    target_source_version_id,
    target_actor_user_id
  );

  if target_source_version_id is not null then
    insert into public.menu_version_sections (
      restaurant_id,
      menu_id,
      menu_version_id,
      section_key,
      display_name,
      sort_order
    )
    select
      source_section.restaurant_id,
      source_section.menu_id,
      created_version_id,
      source_section.section_key,
      source_section.display_name,
      source_section.sort_order
    from public.menu_version_sections as source_section
    where source_section.restaurant_id = target_restaurant_id
      and source_section.menu_id = target_menu_id
      and source_section.menu_version_id = target_source_version_id;

    insert into public.menu_version_items (
      restaurant_id,
      menu_id,
      menu_version_id,
      menu_item_id,
      section_key,
      display_name,
      description,
      price_amount_minor,
      configuration,
      is_active,
      sort_order
    )
    select
      source_item.restaurant_id,
      source_item.menu_id,
      created_version_id,
      source_item.menu_item_id,
      source_item.section_key,
      source_item.display_name,
      source_item.description,
      source_item.price_amount_minor,
      source_item.configuration,
      source_item.is_active,
      source_item.sort_order
    from public.menu_version_items as source_item
    where source_item.restaurant_id = target_restaurant_id
      and source_item.menu_id = target_menu_id
      and source_item.menu_version_id = target_source_version_id;
  end if;

  return created_version_id;
end;
$$;

create or replace function private.publish_menu_version(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_menu_id uuid,
  target_menu_version_id uuid,
  target_effective_at timestamptz,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  publication_id uuid := gen_random_uuid();
  version_status text;
  version_currency text;
  restaurant_currency text;
  publication_event_type text;
begin
  perform private.assert_menu_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('menu-publication:'||target_restaurant_id::text||':'||target_location_id::text||':'||target_menu_id::text,0));

  if target_effective_at < now() - interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'menu publication cannot be backdated';
  end if;

  if not exists (
    select 1
    from public.locations as location
    where location.restaurant_id = target_restaurant_id
      and location.id = target_location_id
      and location.status <> 'suspended'
  ) then
    raise exception using errcode = 'P0001', message = 'menu publication location was not found';
  end if;

  select version.status, version.currency_code, restaurant.currency_code
  into version_status, version_currency, restaurant_currency
  from public.menu_versions as version
  join public.restaurants as restaurant
    on restaurant.id = version.restaurant_id
  join public.menus as menu
    on menu.restaurant_id = version.restaurant_id
    and menu.id = version.menu_id
  where version.restaurant_id = target_restaurant_id
    and version.menu_id = target_menu_id
    and version.id = target_menu_version_id
    and menu.status = 'active'
  for update of version;

  if version_status is null then
    raise exception using errcode = 'P0001', message = 'active menu version was not found';
  end if;

  if version_currency <> restaurant_currency then
    raise exception using errcode = 'P0001', message = 'menu version currency does not match restaurant';
  end if;

  if not exists (
    select 1
    from public.menu_version_items as item
    where item.restaurant_id = target_restaurant_id
      and item.menu_id = target_menu_id
      and item.menu_version_id = target_menu_version_id
      and item.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'menu version has no active item';
  end if;

  if version_status = 'draft' then
    update public.menu_versions
    set
      status = 'published',
      published_by_user_id = target_actor_user_id,
      published_at = now()
    where restaurant_id = target_restaurant_id
      and menu_id = target_menu_id
      and id = target_menu_version_id;
  end if;

  insert into public.menu_publications (
    id,
    restaurant_id,
    location_id,
    menu_id,
    menu_version_id,
    publication_kind,
    effective_at,
    actor_user_id,
    authentication_assurance
  )
  values (
    publication_id,
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_menu_version_id,
    'publish',
    target_effective_at,
    target_actor_user_id,
    target_authentication_assurance
  );

  publication_event_type := case
    when target_effective_at > now() then 'menu.version.scheduled'
    else 'menu.version.published'
  end;

  insert into public.outbox_events (
    restaurant_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    idempotency_key
  )
  values (
    target_restaurant_id,
    'menu',
    target_menu_id,
    publication_event_type,
    jsonb_build_object(
      'publication_id', publication_id,
      'location_id', target_location_id,
      'menu_version_id', target_menu_version_id,
      'effective_at', target_effective_at
    ),
    'menu-publication:' || publication_id::text
  );

  return publication_id;
end;
$$;

create or replace function private.rollback_menu_version(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_menu_id uuid,
  target_menu_version_id uuid,
  target_effective_at timestamptz,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  publication_id uuid := gen_random_uuid();
begin
  perform private.assert_menu_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('menu-publication:'||target_restaurant_id::text||':'||target_location_id::text||':'||target_menu_id::text,0));

  if target_effective_at < now() - interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'menu rollback cannot be backdated';
  end if;

  if not exists (
    select 1
    from public.menu_versions as version
    where version.restaurant_id = target_restaurant_id
      and version.menu_id = target_menu_id
      and version.id = target_menu_version_id
      and version.status = 'published'
  ) then
    raise exception using errcode = 'P0001', message = 'published rollback menu version was not found';
  end if;

  if not exists (
    select 1
    from public.menu_publications as publication
    where publication.restaurant_id = target_restaurant_id
      and publication.location_id = target_location_id
      and publication.menu_id = target_menu_id
      and publication.menu_version_id = target_menu_version_id
      and publication.effective_at <= now()
  ) then
    raise exception using errcode = 'P0001', message = 'rollback version was never active at this location';
  end if;

  insert into public.menu_publications (
    id,
    restaurant_id,
    location_id,
    menu_id,
    menu_version_id,
    publication_kind,
    effective_at,
    actor_user_id,
    authentication_assurance
  )
  values (
    publication_id,
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_menu_version_id,
    'rollback',
    target_effective_at,
    target_actor_user_id,
    target_authentication_assurance
  );

  insert into public.outbox_events (
    restaurant_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    idempotency_key
  )
  values (
    target_restaurant_id,
    'menu',
    target_menu_id,
    case
      when target_effective_at > now() then 'menu.version.rollback_scheduled'
      else 'menu.version.rolled_back'
    end,
    jsonb_build_object(
      'publication_id', publication_id,
      'location_id', target_location_id,
      'menu_version_id', target_menu_version_id,
      'effective_at', target_effective_at
    ),
    'menu-publication:' || publication_id::text
  );

  return publication_id;
end;
$$;

create or replace function private.set_menu_item_availability(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_menu_id uuid,
  target_menu_item_id uuid,
  target_status text,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  transition_id uuid := gen_random_uuid();
  previous_status text;
begin
  perform private.assert_menu_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('menu-publication:'||target_restaurant_id::text||':'||target_location_id::text||':'||target_menu_id::text,0));

  if target_status not in ('available', 'sold_out', 'unavailable') then
    raise exception using errcode = 'P0001', message = 'menu item availability status is invalid';
  end if;

  if not exists (
    select 1
    from public.locations as location
    join public.menu_items as item
      on item.restaurant_id = location.restaurant_id
    where location.restaurant_id = target_restaurant_id
      and location.id = target_location_id
      and item.menu_id = target_menu_id
      and item.id = target_menu_item_id
  ) then
    raise exception using errcode = 'P0001', message = 'menu item location boundary is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_restaurant_id::text || ':' || target_location_id::text || ':' || target_menu_item_id::text,
      0
    )
  );

  select availability.status
  into previous_status
  from public.menu_item_location_availability as availability
  where availability.restaurant_id = target_restaurant_id
    and availability.location_id = target_location_id
    and availability.menu_id = target_menu_id
    and availability.menu_item_id = target_menu_item_id
  for update;

  if previous_status = target_status then
    raise exception using errcode = 'P0001', message = 'menu item availability status is unchanged';
  end if;

  insert into public.menu_item_location_availability (
    restaurant_id,
    location_id,
    menu_id,
    menu_item_id,
    status,
    updated_by_user_id
  )
  values (
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_menu_item_id,
    target_status,
    target_actor_user_id
  )
  on conflict (restaurant_id, location_id, menu_item_id)
  do update set
    status = excluded.status,
    updated_by_user_id = excluded.updated_by_user_id;

  insert into public.menu_item_availability_transitions (
    id,
    restaurant_id,
    location_id,
    menu_id,
    menu_item_id,
    from_status,
    to_status,
    actor_user_id,
    authentication_assurance
  )
  values (
    transition_id,
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_menu_item_id,
    previous_status,
    target_status,
    target_actor_user_id,
    target_authentication_assurance
  );

  insert into public.outbox_events (
    restaurant_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    idempotency_key
  )
  values (
    target_restaurant_id,
    'menu_item',
    target_menu_item_id,
    'menu.item.availability_changed',
    jsonb_build_object(
      'transition_id', transition_id,
      'location_id', target_location_id,
      'menu_id', target_menu_id,
      'from_status', previous_status,
      'to_status', target_status
    ),
    'menu-availability:' || transition_id::text
  );

  return transition_id;
end;
$$;

create or replace function private.read_storefront_catalog(
  target_restaurant_slug text,
  target_location_slug text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_restaurant public.restaurants%rowtype;
  selected_location public.locations%rowtype;
  result_menus jsonb;
  evaluated_at timestamptz := statement_timestamp();
begin
  if target_restaurant_slug is null or target_location_slug is null
    or char_length(target_restaurant_slug) not between 3 and 63
    or char_length(target_location_slug) not between 2 and 63
    or target_restaurant_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or target_location_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    return null;
  end if;

  select restaurant.* into selected_restaurant
  from public.restaurants as restaurant
  where restaurant.slug = target_restaurant_slug and restaurant.status = 'active';

  select location.* into selected_location
  from public.locations as location
  where location.restaurant_id = selected_restaurant.id
    and location.slug = target_location_slug and location.status = 'active';

  if selected_location.id is null
    or not private.is_location_go_live(selected_restaurant.id, selected_location.id)
    or not private.is_restaurant_feature_enabled(selected_restaurant.id, 'catalog.public_menu')
    or not exists (select 1 from pg_catalog.pg_timezone_names where name = selected_location.timezone)
  then
    return null;
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', menu.id,
    'versionId', version.id,
    'name', menu.display_name,
    'currency', version.currency_code,
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', section.section_key,
        'name', section.display_name,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', item.menu_item_id,
            'name', item.display_name,
            'description', item.description,
            'priceAmountMinor', item.price_amount_minor,
            'availability', coalesce(availability.status, 'available')
          ) || case when item.configuration is null then '{}'::jsonb else jsonb_build_object('configuration',item.configuration) end order by item.sort_order, item.menu_item_id)
          from public.menu_version_items as item
          left join public.menu_item_location_availability as availability
            on availability.restaurant_id = item.restaurant_id
            and availability.location_id = selected_location.id
            and availability.menu_id = item.menu_id
            and availability.menu_item_id = item.menu_item_id
          where item.restaurant_id = section.restaurant_id
            and item.menu_id = section.menu_id
            and item.menu_version_id = section.menu_version_id
            and item.section_key = section.section_key
            and item.is_active
        ), '[]'::jsonb)
      ) order by section.sort_order, section.section_key)
      from public.menu_version_sections as section
      where section.restaurant_id = version.restaurant_id
        and section.menu_id = version.menu_id
        and section.menu_version_id = version.id
    ), '[]'::jsonb)
  ) order by menu.slug, menu.id)
  into result_menus
  from public.menus as menu
  join public.menu_versions as version
    on version.restaurant_id = menu.restaurant_id and version.menu_id = menu.id
    and version.id = private.resolve_public_menu_version(
      selected_restaurant.id, selected_location.id, menu.id, evaluated_at
    )
  where menu.restaurant_id = selected_restaurant.id and menu.status = 'active';

  if result_menus is null then return null; end if;

  return jsonb_build_object(
    'restaurant', jsonb_build_object('slug', selected_restaurant.slug, 'name', selected_restaurant.display_name),
    'location', jsonb_build_object(
      'slug', selected_location.slug,
      'name', selected_location.display_name,
      'timezone', selected_location.timezone,
      'address', jsonb_build_object(
        'line1', selected_location.address_line_1, 'line2', selected_location.address_line_2,
        'postalCode', selected_location.postal_code, 'city', selected_location.city,
        'countryCode', selected_location.country_code
      )
    ),
    'menus', result_menus
  );
end;
$$;

create or replace function private.quote_public_delivery_order(
  restaurant_slug text, location_slug text, menu_id uuid, menu_version_id uuid,
  requested_for timestamptz, lines jsonb, postal_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare restaurant uuid; location uuid; policy uuid; zone jsonb; subtotal bigint; quantity integer;
  priced jsonb; matched integer; currency text; fee bigint; minimum bigint;
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
  priced:=private.price_menu_lines(restaurant,location,menu_id,menu_version_id,lines);
  subtotal:=(priced->>'subtotal')::bigint; quantity:=(priced->>'item_count')::integer;
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

-- Current public menu only; quote neither reserves capacity nor creates orders/payments.
create function private.quote_public_cart(restaurant_slug text,location_slug text,menu_id uuid,source_version_id uuid,fulfillment text,requested_for timestamptz,lines jsonb,postal_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare restaurant uuid; location uuid; current_version uuid; currency text; priced jsonb; l jsonb; issues jsonb:='[]'; n integer:=0; delivery_quote jsonb; result jsonb;
begin
 if fulfillment is null or fulfillment not in ('pickup','delivery') or requested_for is null or not isfinite(requested_for) or source_version_id is null then raise exception 'invalid cart quote'; end if;
 if private.read_storefront_catalog(restaurant_slug,location_slug) is null then return null; end if;
 select r.id,l.id into restaurant,location from public.restaurants r join public.locations l on l.restaurant_id=r.id where r.slug=restaurant_slug and l.slug=location_slug;
 current_version:=private.resolve_public_menu_version(restaurant,location,menu_id,statement_timestamp());
 if current_version is null then return null; end if;
 lines:=private.canonical_menu_lines(lines);
 for l in select value from jsonb_array_elements(lines) loop
  begin
   perform private.price_menu_lines(restaurant,location,menu_id,current_version,jsonb_build_array(l));
  exception when raise_exception then
   issues:=issues||jsonb_build_array(jsonb_build_object('menuItemId',l->>'menu_item_id','variantId',l->'variant_id','optionIds',coalesce(l->'option_ids','[]'::jsonb),'code','selection_unavailable'));
  end;
 end loop;
 if jsonb_array_length(issues)>0 then return jsonb_build_object('status','unavailable','currentMenuVersionId',current_version,'issues',issues); end if;
 priced:=private.price_menu_lines(restaurant,location,menu_id,current_version,lines);
 if private.read_storefront_availability(restaurant_slug,location_slug,fulfillment,requested_for,(priced->>'item_count')::integer)->>'status' is distinct from 'available' then
  return jsonb_build_object('status','unavailable','currentMenuVersionId',current_version,'issues',jsonb_build_array(jsonb_build_object('code','time_unavailable')));
 end if;
 if fulfillment='delivery' then
  begin delivery_quote:=private.quote_public_delivery_order(restaurant_slug,location_slug,menu_id,current_version,requested_for,lines,postal_code);
  exception when raise_exception then return jsonb_build_object('status','unavailable','currentMenuVersionId',current_version,'issues',jsonb_build_array(jsonb_build_object('code','delivery_unavailable'))); end;
 end if;
 select v.currency_code into currency from public.menu_versions v where v.id=current_version and v.restaurant_id=restaurant and v.menu_id=quote_public_cart.menu_id;
 select coalesce(jsonb_agg(jsonb_build_object('menuItemId',value->>'menu_item_id','quantity',value->'quantity','name',value->>'display_name','variantId',value->'variant_id','optionIds',coalesce(value->'option_ids','[]'::jsonb),'unitPriceAmountMinor',value->'unit_price_amount_minor','lineAmountMinor',value->'line_amount_minor','selectionSnapshot',value->'selection_snapshot')),'[]'::jsonb) into result from jsonb_array_elements(priced->'lines');
 return jsonb_build_object('status',case when current_version=source_version_id then 'current' else 'changed' end,'currentMenuVersionId',current_version,'currency',currency,'itemCount',(priced->>'item_count')::integer,'subtotalAmountMinor',(priced->>'subtotal')::bigint,'lines',result,'deliveryQuote',delivery_quote);
end; $$;
revoke all on function private.quote_public_cart(text,text,uuid,uuid,text,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function private.quote_public_cart(text,text,uuid,uuid,text,timestamptz,jsonb,text) to service_role;
