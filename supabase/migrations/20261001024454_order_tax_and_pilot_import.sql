-- Explicit gross-inclusive component declarations; no rate inferred for legacy data.
alter function private.valid_menu_configuration(jsonb) rename to valid_menu_configuration_without_choice_tax;
create function private.valid_menu_configuration(config jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare v_choice jsonb;v_group jsonb;v_variants jsonb:='[]';v_groups jsonb:='[]';v_options jsonb;
begin
 if config is null then return true;end if;
 for v_choice in select value from jsonb_array_elements(config->'variants') union all select opt.value from jsonb_array_elements(config->'optionGroups') grp(value) cross join lateral jsonb_array_elements(grp.value->'options') opt(value) loop
  if v_choice ? 'taxRateBasisPoints' and (jsonb_typeof(v_choice->'taxRateBasisPoints')<>'number' or (v_choice->>'taxRateBasisPoints')!~'^[0-9]{1,5}$' or (v_choice->>'taxRateBasisPoints')::integer>10000) then return false;end if;
 end loop;
 for v_choice in select value from jsonb_array_elements(config->'variants') loop v_variants:=v_variants||jsonb_build_array(v_choice-'taxRateBasisPoints');end loop;
 for v_group in select value from jsonb_array_elements(config->'optionGroups') loop
  select coalesce(jsonb_agg(value-'taxRateBasisPoints'),'[]') into v_options from jsonb_array_elements(v_group->'options');
  v_groups:=v_groups||jsonb_build_array(jsonb_set(v_group,'{options}',v_options));
 end loop;
 return private.valid_menu_configuration_without_choice_tax(jsonb_set(jsonb_set(config,'{variants}',v_variants),'{optionGroups}',v_groups));
exception when others then return false;
end;$$;
-- Existing CHECK is bound to the old function OID; bind it to the new validator explicitly.
alter table public.menu_version_items drop constraint menu_item_configuration_valid;
alter table public.menu_version_items add constraint menu_item_configuration_valid check(private.valid_menu_configuration(configuration));
revoke all on function private.valid_menu_configuration_without_choice_tax(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.valid_menu_configuration(jsonb) from public,anon,authenticated;
grant execute on function private.valid_menu_configuration(jsonb) to service_role;

create function private.tax_component(kind text,choice uuid,gross bigint,rate integer) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('kind',kind,'choiceId',choice,'grossAmountMinor',gross,'taxRateBasisPoints',rate,'taxAmountMinor',round(gross::numeric*rate/(10000+rate))::bigint);
$$;
alter function private.price_menu_lines(uuid,uuid,uuid,uuid,jsonb) rename to price_menu_lines_without_tax;
create function private.price_menu_lines(r uuid,l uuid,m uuid,v uuid,lines jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare priced jsonb;line jsonb;cfg jsonb;components jsonb;output jsonb:='[]';snapshot jsonb;c jsonb;q integer;v_rate integer;tax bigint;base bigint;
begin
 priced:=private.price_menu_lines_without_tax(r,l,m,v,lines);
 for line in select value from jsonb_array_elements(priced->'lines') loop
  select configuration,price_amount_minor into cfg,base from public.menu_version_items where restaurant_id=r and menu_id=m and menu_version_id=v and menu_item_id=(line->>'menu_item_id')::uuid;
  if cfg is not null then
   q:=(line->>'quantity')::integer;v_rate:=(cfg->>'taxRateBasisPoints')::integer;
   components:=jsonb_build_array(private.tax_component('base',null,base*q,v_rate));
   for c in select value from jsonb_array_elements(cfg->'variants') where lower(value->>'id')=line->>'variant_id' loop
    components:=components||jsonb_build_array(private.tax_component('variant',(c->>'id')::uuid,(c->>'priceDeltaAmountMinor')::bigint*q,coalesce((c->>'taxRateBasisPoints')::integer,v_rate)));
   end loop;
   for c in select o.value from jsonb_array_elements(cfg->'optionGroups') g cross join lateral jsonb_array_elements(g->'options') o where coalesce(line->'option_ids','[]') ? lower(o.value->>'id') loop
    components:=components||jsonb_build_array(private.tax_component('option',(c->>'id')::uuid,(c->>'priceDeltaAmountMinor')::bigint*q,coalesce((c->>'taxRateBasisPoints')::integer,v_rate)));
   end loop;
   -- Round once per line/rate, then distribute cents deterministically to its components.
   with entries as(select value,ordinality ord,(value->>'grossAmountMinor')::bigint gross,(value->>'taxRateBasisPoints')::integer rate from jsonb_array_elements(components) with ordinality),
   shares as(select *,floor(gross::numeric*rate/(10000+rate))::bigint part,mod(gross::numeric*rate,10000+rate) remainder from entries),
   ranked as(select *,row_number() over(partition by rate order by remainder desc,ord) rank,sum(part) over(partition by rate) parts_total,round(sum(gross) over(partition by rate)::numeric*rate/(10000+rate))::bigint target_tax from shares)
   select jsonb_agg(jsonb_set(value,'{taxAmountMinor}',to_jsonb(part+case when rank<=target_tax-parts_total then 1 else 0 end)) order by ord) into components from ranked;
   select sum((value->>'taxAmountMinor')::bigint) into tax from jsonb_array_elements(components);
   snapshot:=(line->'selection_snapshot')||jsonb_build_object('taxComponents',components,'taxAmountMinor',tax);
   snapshot:=jsonb_set(snapshot,'{variant}',case when snapshot->'variant'='null'::jsonb then 'null'::jsonb else (snapshot->'variant')-'taxRateBasisPoints' end);
   select coalesce(jsonb_agg(value-'taxRateBasisPoints'),'[]') into cfg from jsonb_array_elements(snapshot->'options');
   snapshot:=jsonb_set(snapshot,'{options}',cfg);
   line:=jsonb_set(line,'{selection_snapshot}',snapshot);
  end if;
  output:=output||jsonb_build_array(line);
 end loop;
 return jsonb_set(priced,'{lines}',output);
end;$$;
revoke all on function private.price_menu_lines_without_tax(uuid,uuid,uuid,uuid,jsonb),private.price_menu_lines(uuid,uuid,uuid,uuid,jsonb),private.tax_component(text,uuid,bigint,integer) from public,anon,authenticated,service_role;

create table private.delivery_tax_declarations(
 policy_id uuid primary key,restaurant_id uuid not null,location_id uuid not null,
 declaration jsonb not null check(jsonb_typeof(declaration)='object'),
 actor_user_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(restaurant_id,location_id,policy_id) references public.delivery_policy_versions(restaurant_id,location_id,id)
);
alter table private.delivery_tax_declarations enable row level security;
revoke all on private.delivery_tax_declarations from public,anon,authenticated,service_role;
create trigger delivery_tax_declaration_immutable before update or delete on private.delivery_tax_declarations for each row execute function private.prevent_ordering_history_mutation();

create function private.build_tax_summary(lines jsonb,fee bigint,declaration jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare line jsonb;components jsonb:='[]';subtotal bigint:=0;unknown bigint:=0;buckets jsonb;line_gross bigint;total_tax bigint;known_net bigint;entry record;
begin
 for line in select value from jsonb_array_elements(lines) loop
  line_gross:=(line->>'line_amount_minor')::bigint;subtotal:=subtotal+line_gross;
  if line->'selection_snapshot' is null or line->'selection_snapshot'='null'::jsonb then unknown:=unknown+line_gross;
  elsif line->'selection_snapshot' ? 'taxComponents' then components:=components||(line->'selection_snapshot'->'taxComponents');
  else components:=components||jsonb_build_array(jsonb_build_object('grossAmountMinor',line_gross,'taxRateBasisPoints',line->'selection_snapshot'->'taxRateBasisPoints','taxAmountMinor',line->'selection_snapshot'->'taxAmountMinor'));end if;
 end loop;
 if fee>0 then
  if declaration->>'mode'='fixed' then components:=components||jsonb_build_array(private.tax_component('base',null,fee,(declaration->>'taxRateBasisPoints')::integer));
  elsif declaration->>'mode'='proportional' and unknown=0 and subtotal>0 then
   -- Largest remainder by gross weights; rate ascending breaks ties. Sum exactly equals fee.
   for entry in with weights as(select (value->>'taxRateBasisPoints')::integer rate,sum((value->>'grossAmountMinor')::bigint) gross from jsonb_array_elements(components) group by 1),
    parts as(select *,floor(fee::numeric*gross/subtotal)::bigint part,mod(fee::numeric*gross,subtotal) remainder from weights),
    ranked as(select *,row_number() over(order by remainder desc,rate) rank,sum(part) over() parts_total from parts)
    select rate,part+case when rank<=fee-parts_total then 1 else 0 end share from ranked order by rate loop
     components:=components||jsonb_build_array(private.tax_component('base',null,entry.share,entry.rate));
   end loop;
  else unknown:=unknown+fee;end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('taxRateBasisPoints',rate,'grossAmountMinor',gross,'netAmountMinor',gross-tax,'taxAmountMinor',tax) order by rate),'[]'),coalesce(sum(tax),0),coalesce(sum(gross-tax),0)
 into buckets,total_tax,known_net from(select (value->>'taxRateBasisPoints')::integer rate,sum((value->>'grossAmountMinor')::bigint) gross,sum((value->>'taxAmountMinor')::bigint) tax from jsonb_array_elements(components) group by 1) b;
 return jsonb_build_object('schemaVersion',1,'status',case when unknown=0 then 'complete' else 'partial' end,'subtotalAmountMinor',subtotal,'discountAmountMinor',0,'deliveryFeeAmountMinor',fee,'totalAmountMinor',subtotal+fee,'knownNetAmountMinor',known_net,'taxAmountMinor',total_tax,'undeclaredGrossAmountMinor',unknown,'buckets',buckets);
end;$$;
revoke all on function private.build_tax_summary(jsonb,bigint,jsonb) from public,anon,authenticated,service_role;
alter table public.orders add column tax_summary jsonb check(tax_summary is null or jsonb_typeof(tax_summary)='object');
create function private.protect_order_tax() returns trigger language plpgsql set search_path='' as $$
begin if new.tax_summary is distinct from old.tax_summary then raise exception 'order tax snapshot is immutable';end if;return new;end;$$;
create trigger a_order_tax_immutable before update on public.orders for each row execute function private.protect_order_tax();
revoke all on function private.protect_order_tax() from public,anon,authenticated,service_role;

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
  menu_clock_started_at timestamptz := statement_timestamp();
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
    item_count,
    tax_summary
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
    requested_item_count,
    private.build_tax_summary(priced->'lines',0,null)
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
  menu_clock_started_at timestamptz := statement_timestamp();
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
    item_count,
    tax_summary
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
    requested_item_count,
    private.build_tax_summary(priced->'lines',target_fee,(select declaration from private.delivery_tax_declarations where policy_id=target_policy_id and restaurant_id=target_restaurant_id and location_id=target_location_id))
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

alter function private.quote_public_cart(text,text,uuid,uuid,text,timestamptz,jsonb,text) rename to quote_public_cart_without_tax;
create function private.quote_public_cart(rs text,ls text,m uuid,v uuid,f text,t timestamptz,lines jsonb,postal text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;priced jsonb;declaration jsonb;fee bigint;
begin
 result:=private.quote_public_cart_without_tax(rs,ls,m,v,f,t,lines,postal);
 if result is null or result->>'status'='unavailable' then return result;end if;
 select jsonb_agg(jsonb_build_object('line_amount_minor',value->'lineAmountMinor','selection_snapshot',value->'selectionSnapshot')) into priced from jsonb_array_elements(result->'lines');
 fee:=coalesce((result->'deliveryQuote'->>'deliveryFeeAmountMinor')::bigint,0);
 select d.declaration into declaration from private.delivery_tax_declarations d join public.restaurants r on r.id=d.restaurant_id join public.locations l on l.restaurant_id=r.id and l.id=d.location_id where r.slug=rs and l.slug=ls and d.policy_id=(result->'deliveryQuote'->>'policyId')::uuid;
 return result||jsonb_build_object('taxSummary',private.build_tax_summary(priced,fee,declaration));
end;$$;
revoke all on function private.quote_public_cart_without_tax(text,text,uuid,uuid,text,timestamptz,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function private.quote_public_cart(text,text,uuid,uuid,text,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function private.quote_public_cart(text,text,uuid,uuid,text,timestamptz,jsonb,text) to service_role;

alter function private.read_dashboard_order(uuid,text,uuid,uuid,uuid) rename to read_dashboard_order_without_tax;
create function private.read_dashboard_order(actor uuid,aal text,r uuid,l uuid,o uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;summary jsonb;
begin result:=private.read_dashboard_order_without_tax(actor,aal,r,l,o);if result->>'outcome'<>'allowed' then return result;end if;
 select tax_summary into summary from public.orders where restaurant_id=r and location_id=l and id=o;
 return jsonb_set(result,'{data,taxSummary}',coalesce(summary,'null'::jsonb));end;$$;
revoke all on function private.read_dashboard_order_without_tax(uuid,text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.read_dashboard_order(uuid,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.read_dashboard_order(uuid,text,uuid,uuid,uuid) to service_role;

-- Imported versions are created and filled inside a single guarded transaction.
alter function private.menu_dashboard(uuid,text,uuid,uuid,jsonb) rename to menu_dashboard_without_tax_import;
create function private.menu_dashboard(actor uuid,aal text,r uuid,l uuid,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;policy uuid;new_policy uuid;declaration jsonb;draft uuid;x jsonb;action text;
begin
 result:=private.menu_dashboard_without_tax_import(actor,aal,r,l,null);
 if result->>'outcome'<>'allowed' then return result;end if;
 action:=command->>'action';
 if action='set_delivery_tax' then
  if command->'informationConfirmed' is distinct from 'true'::jsonb or (command->>'mode' is null or command->>'mode' not in ('fixed','proportional')) or (command->>'mode'='fixed' and (coalesce(command->>'taxRateBasisPoints','')!~'^[0-9]{1,5}$' or (command->>'taxRateBasisPoints')::integer>10000)) or coalesce(char_length(btrim(command->>'note')),0) not between 1 and 200 or (command->>'mode'='proportional' and command->'taxRateBasisPoints' is distinct from 'null'::jsonb) then return jsonb_build_object('outcome','invalid');end if;
  perform pg_advisory_xact_lock(hashtextextended('delivery-policy:'||l::text,0));
  select policy_id into policy from public.delivery_policy_publications where restaurant_id=r and location_id=l order by id desc limit 1;
  if policy is null or policy is distinct from (command->>'expectedPolicyId')::uuid then return jsonb_build_object('outcome','conflict');end if;
  select private.create_delivery_policy(actor,aal,r,l,zones) into new_policy from public.delivery_policy_versions where id=policy and restaurant_id=r and location_id=l;
  declaration:=jsonb_build_object('mode',command->>'mode','taxRateBasisPoints',command->'taxRateBasisPoints');
  insert into private.delivery_tax_declarations(policy_id,restaurant_id,location_id,declaration,actor_user_id) values(new_policy,r,l,declaration,actor);
  perform private.publish_delivery_policy(actor,aal,r,l,new_policy);
  insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(r,'delivery_policy',new_policy,'delivery.tax.declared',jsonb_build_object('previous_policy_id',policy,'declaration',declaration,'actor_user_id',actor,'note',command->>'note'),'delivery-tax:'||new_policy::text);
 elsif action='import_draft' then
  if not exists(select 1 from public.menus where restaurant_id=r and id=(command->>'menuId')::uuid and status='active') then return jsonb_build_object('outcome','forbidden');end if;
  if coalesce(command->'source'->>'sha256','')!~'^[a-f0-9]{64}$' or coalesce(char_length(command->'source'->>'name'),0) not between 1 and 200 or jsonb_typeof(command->'items')<>'array' or jsonb_array_length(command->'items') not between 1 and 200 then return jsonb_build_object('outcome','invalid');end if;
  for x in select value from jsonb_array_elements(command->'items') loop
   if x->'isActive'='true'::jsonb and (x->'configuration'='null'::jsonb or x->'configuration' is null or not private.valid_menu_configuration(x->'configuration')) then return jsonb_build_object('outcome','invalid');end if;
  end loop;
  draft:=private.create_menu_draft(r,(command->>'menuId')::uuid,null,actor,aal);
  result:=private.menu_dashboard_without_tax_import(actor,aal,r,l,jsonb_build_object('action','save_draft','menuId',command->'menuId','versionId',draft,'expectedRevision',0,'sections',command->'sections','items',command->'items'));
  if result->>'outcome'<>'allowed' then raise exception 'invalid atomic menu import';end if;
  insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(r,'menu', (command->>'menuId')::uuid,'menu.draft.imported',jsonb_build_object('version_id',draft,'source',command->'source','item_count',jsonb_array_length(command->'items'),'actor_user_id',actor),'menu-import:'||draft::text);
 elsif command is not null then result:=private.menu_dashboard_without_tax_import(actor,aal,r,l,command);end if;
 if result->>'outcome'<>'allowed' then return result;end if;
 select policy_id into policy from public.delivery_policy_publications where restaurant_id=r and location_id=l order by id desc limit 1;
 select d.declaration into declaration from private.delivery_tax_declarations d where d.policy_id=policy and d.restaurant_id=r and d.location_id=l;
 return jsonb_set(result,'{data,deliveryTax}',case when policy is null then 'null'::jsonb else jsonb_build_object('policyId',policy,'mode',coalesce(declaration->>'mode','undeclared'),'taxRateBasisPoints',declaration->'taxRateBasisPoints') end);
end;$$;
revoke all on function private.menu_dashboard_without_tax_import(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.menu_dashboard(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.menu_dashboard(uuid,text,uuid,uuid,jsonb) to service_role;

alter function private.read_public_guest_order_status(text,text,uuid,timestamptz) rename to read_public_guest_order_status_without_tax;
create function private.read_public_guest_order_status(rs text,ls text,o uuid,t timestamptz default statement_timestamp()) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;summary jsonb;
begin result:=private.read_public_guest_order_status_without_tax(rs,ls,o,t);if result is null then return null;end if;
 select ord.tax_summary into summary from public.orders ord join public.restaurants r on r.id=ord.restaurant_id join public.locations l on l.restaurant_id=r.id and l.id=ord.location_id where r.slug=rs and l.slug=ls and ord.id=o;
 return result||jsonb_build_object('taxSummary',summary);end;$$;
revoke all on function private.read_public_guest_order_status_without_tax(text,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.read_public_guest_order_status(text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.read_public_guest_order_status(text,text,uuid,timestamptz) to service_role;
-- The legacy pure validator remains needed inside the new invoker CHECK predicate.
grant execute on function private.valid_menu_configuration_without_choice_tax(jsonb) to service_role;
