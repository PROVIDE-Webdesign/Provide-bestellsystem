create function private.submit_priced_delivery_order(
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

  select
    count(*)::integer,
    count(distinct requested.menu_item_id)::integer,
    count(*) filter (
      where requested.menu_item_id is null
        or requested.quantity is null
        or requested.quantity <= 0
        or requested.quantity > 1000
    )::integer,
    coalesce(sum(requested.quantity), 0)::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'menu_item_id', requested.menu_item_id,
          'quantity', requested.quantity
        )
        order by requested.menu_item_id
      ),
      '[]'::jsonb
    )
  into
    requested_line_count,
    distinct_line_count,
    invalid_line_count,
    requested_item_count,
    canonical_lines
  from jsonb_to_recordset(target_lines) as requested(menu_item_id uuid, quantity integer);

  if requested_line_count < 1 or requested_line_count > 100 then
    raise exception using errcode = 'P0001', message = 'order line count is invalid';
  end if;

  if invalid_line_count > 0 or requested_item_count < 1 or requested_item_count > 1000 then
    raise exception using errcode = 'P0001', message = 'order item quantity is invalid';
  end if;

  if distinct_line_count <> requested_line_count then
    raise exception using errcode = 'P0001', message = 'order lines contain duplicate menu items';
  end if;

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

  if private.resolve_public_menu_version(
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_evaluated_at
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

  select
    count(*)::integer,
    coalesce(sum(version_item.price_amount_minor * requested.quantity::bigint), 0)
  into matched_line_count, subtotal
  from jsonb_to_recordset(canonical_lines) as requested(menu_item_id uuid, quantity integer)
  join public.menu_version_items as version_item
    on version_item.restaurant_id = target_restaurant_id
    and version_item.menu_id = target_menu_id
    and version_item.menu_version_id = target_menu_version_id
    and version_item.menu_item_id = requested.menu_item_id
    and version_item.is_active
  left join public.menu_item_location_availability as availability
    on availability.restaurant_id = target_restaurant_id
    and availability.location_id = target_location_id
    and availability.menu_id = target_menu_id
    and availability.menu_item_id = requested.menu_item_id
  where coalesce(availability.status, 'available') = 'available';

  if matched_line_count <> requested_line_count then
    raise exception using errcode = 'P0001', message = 'order contains unavailable menu items';
  end if;

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

  insert into public.order_lines (
    restaurant_id,
    location_id,
    order_id,
    line_number,
    menu_id,
    menu_version_id,
    menu_item_id,
    display_name,
    quantity,
    unit_price_amount_minor,
    line_amount_minor
  )
  select
    target_restaurant_id,
    target_location_id,
    created_order_id,
    row_number() over (order by requested.menu_item_id)::integer,
    target_menu_id,
    target_menu_version_id,
    requested.menu_item_id,
    version_item.display_name,
    requested.quantity,
    version_item.price_amount_minor,
    version_item.price_amount_minor * requested.quantity::bigint
  from jsonb_to_recordset(canonical_lines) as requested(menu_item_id uuid, quantity integer)
  join public.menu_version_items as version_item
    on version_item.restaurant_id = target_restaurant_id
    and version_item.menu_id = target_menu_id
    and version_item.menu_version_id = target_menu_version_id
    and version_item.menu_item_id = requested.menu_item_id
  order by requested.menu_item_id;

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


revoke all on function private.submit_priced_delivery_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz,uuid,bigint) from public,anon,authenticated,service_role;

create function private.submit_public_guest_delivery_order(
  restaurant_slug text, location_slug text, menu_id uuid, menu_version_id uuid,
  requested_for timestamptz, lines jsonb, submission_key text, customer jsonb,
  delivery jsonb, expected_quote jsonb, notice_version text, retention_days integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare restaurant uuid; location uuid; quote jsonb; result uuid; existing public.orders%rowtype;
  selected public.orders%rowtype;
begin
  if retention_days is null or retention_days not between 1 and 730
    or delivery->>'country_code' is distinct from 'DE'
    or delivery->>'postal_code' is null or delivery->>'postal_code' !~ '^[0-9]{5}$'
    or expected_quote is null or jsonb_typeof(expected_quote) <> 'object'
  then raise exception 'invalid delivery checkout'; end if;
  select r.id,l.id into restaurant,location from public.restaurants r
    join public.locations l on l.restaurant_id=r.id where r.slug=restaurant_slug and l.slug=location_slug;
  if location is null then raise exception 'delivery unavailable'; end if;
  -- Serialize publication and final quote verification. The order key lock is shared with all order entry points.
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('delivery-policy:' || location::text,0));
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended(restaurant::text || ':' || location::text || ':' || btrim(submission_key),0));
  select o.* into existing from public.orders o where o.restaurant_id=restaurant and o.location_id=location
    and o.submission_key=btrim(submit_public_guest_delivery_order.submission_key);
  if existing.id is null then
    quote := private.quote_public_delivery_order(restaurant_slug,location_slug,menu_id,menu_version_id,requested_for,lines,delivery->>'postal_code');
    if quote is distinct from expected_quote then raise exception 'delivery quote changed'; end if;
  else
    -- Recover a lost response even after policy, time or order status changed. The immutable payload and PII snapshot still have to match.
    if existing.fulfillment_type <> 'delivery' or existing.delivery_policy_id is null
      or existing.delivery_policy_id::text is distinct from expected_quote->>'policyId'
      or existing.delivery_fee_amount_minor is distinct from (expected_quote->>'deliveryFeeAmountMinor')::bigint
      or existing.subtotal_amount_minor is distinct from (expected_quote->>'subtotalAmountMinor')::bigint
      or existing.total_amount_minor is distinct from (expected_quote->>'totalAmountMinor')::bigint
      or existing.currency_code is distinct from expected_quote->>'currency'
    then raise exception 'delivery retry mismatch'; end if;
    select jsonb_build_object('policyId',existing.delivery_policy_id,
      'subtotalAmountMinor',existing.subtotal_amount_minor,
      'deliveryFeeAmountMinor',existing.delivery_fee_amount_minor,
      'totalAmountMinor',existing.total_amount_minor,
      'minimumAmountMinor',(z.value->>'minimumAmountMinor')::bigint,'currency',existing.currency_code)
    into quote from public.delivery_policy_versions v, lateral jsonb_array_elements(v.zones) z
    where v.id=existing.delivery_policy_id and z.value->'postalCodes' ? (delivery->>'postal_code');
    if quote is distinct from expected_quote then raise exception 'delivery retry mismatch'; end if;
  end if;
  result := private.submit_priced_delivery_order(restaurant,location,menu_id,menu_version_id,'delivery',
    requested_for,lines,submission_key,statement_timestamp(),(quote->>'policyId')::uuid,(quote->>'deliveryFeeAmountMinor')::bigint);
  perform private.initialize_order_payment(restaurant,location,result,'on_fulfillment');
  select o.* into selected from public.orders o where o.id=result;
  perform private.store_guest_checkout_snapshot(restaurant,location,result,customer,delivery,notice_version,
    selected.created_at+make_interval(days=>retention_days));
  return jsonb_build_object('orderId',result,'status','submitted','fulfillmentType','delivery',
    'paymentCollectionMode','on_fulfillment','requestedFor',to_char(selected.requested_for at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'currency',selected.currency_code,'subtotalAmountMinor',selected.subtotal_amount_minor,
    'deliveryFeeAmountMinor',selected.delivery_fee_amount_minor,'totalAmountMinor',selected.total_amount_minor,'itemCount',selected.item_count);
end;
$$;
revoke all on function private.submit_public_guest_delivery_order(text,text,uuid,uuid,timestamptz,jsonb,text,jsonb,jsonb,jsonb,text,integer)
  from public,anon,authenticated;
grant execute on function private.submit_public_guest_delivery_order(text,text,uuid,uuid,timestamptz,jsonb,text,jsonb,jsonb,jsonb,text,integer)
  to service_role;
