-- Server-only public pickup submission boundary. The HTTP feature gate remains disabled by default.
create function private.submit_public_guest_pickup_order(
  target_restaurant_slug text,
  target_location_slug text,
  target_menu_id uuid,
  target_menu_version_id uuid,
  target_requested_for timestamptz,
  target_lines jsonb,
  target_submission_key text,
  target_customer jsonb,
  target_privacy_notice_version text,
  target_retention_days integer,
  target_evaluated_at timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_restaurant_id uuid;
  selected_location_id uuid;
  created_order_id uuid;
  existing_order_id uuid;
  selected_order public.orders%rowtype;
  selected_payment public.order_payments%rowtype;
begin
  if target_retention_days is null or target_retention_days not between 1 and 730 then
    raise exception using errcode = '22023', message = 'pickup checkout retention is invalid';
  end if;

  if target_evaluated_at is null or not isfinite(target_evaluated_at) then
    raise exception using errcode = '22023', message = 'pickup checkout evaluation time is invalid';
  end if;

  select restaurant.id, location.id
  into selected_restaurant_id, selected_location_id
  from public.restaurants as restaurant
  join public.locations as location
    on location.restaurant_id = restaurant.id
  where restaurant.slug = target_restaurant_slug
    and location.slug = target_location_slug;

  if selected_location_id is null then
    raise exception using errcode = 'P0001', message = 'public pickup checkout is unavailable';
  end if;

  select order_record.id
  into existing_order_id
  from public.orders as order_record
  where order_record.restaurant_id = selected_restaurant_id
    and order_record.location_id = selected_location_id
    and order_record.submission_key = btrim(target_submission_key);

  -- New writes need the exact public visibility gate. A matching retry may finish after visibility
  -- changed, so a lost success response remains safely recoverable through the existing idempotency
  -- and payload checks.
  if existing_order_id is null
    and private.read_storefront_catalog(target_restaurant_slug, target_location_slug) is null
  then
    raise exception using errcode = 'P0001', message = 'public pickup checkout is unavailable';
  end if;

  created_order_id := private.submit_order_with_payment(
    selected_restaurant_id,
    selected_location_id,
    target_menu_id,
    target_menu_version_id,
    'pickup',
    target_requested_for,
    target_lines,
    target_submission_key,
    target_evaluated_at,
    'on_fulfillment'
  );

  select order_record.*
  into selected_order
  from public.orders as order_record
  where order_record.restaurant_id = selected_restaurant_id
    and order_record.location_id = selected_location_id
    and order_record.id = created_order_id;

  perform private.store_guest_checkout_snapshot(
    selected_restaurant_id,
    selected_location_id,
    created_order_id,
    target_customer,
    null,
    target_privacy_notice_version,
    selected_order.created_at + make_interval(days => target_retention_days)
  );

  select payment.*
  into selected_payment
  from public.order_payments as payment
  where payment.restaurant_id = selected_restaurant_id
    and payment.location_id = selected_location_id
    and payment.order_id = created_order_id;

  if selected_order.id is null
    or selected_payment.id is null
    or selected_order.status <> 'submitted'
    or selected_order.fulfillment_type <> 'pickup'
    or selected_payment.collection_mode <> 'on_fulfillment'
    or selected_payment.status <> 'not_required'
  then
    raise exception using errcode = 'P0001', message = 'public pickup checkout result is invalid';
  end if;

  return jsonb_build_object(
    'orderId', selected_order.id,
    'status', selected_order.status,
    'fulfillmentType', selected_order.fulfillment_type,
    'paymentCollectionMode', selected_payment.collection_mode,
    'requestedFor', to_char(
      selected_order.requested_for at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'currency', selected_order.currency_code,
    'totalAmountMinor', selected_order.total_amount_minor,
    'itemCount', selected_order.item_count
  );
end;
$$;

revoke all on function private.submit_public_guest_pickup_order(
  text,
  text,
  uuid,
  uuid,
  timestamptz,
  jsonb,
  text,
  jsonb,
  text,
  integer,
  timestamptz
) from public, anon, authenticated;

grant execute on function private.submit_public_guest_pickup_order(
  text,
  text,
  uuid,
  uuid,
  timestamptz,
  jsonb,
  text,
  jsonb,
  text,
  integer,
  timestamptz
) to service_role;

comment on function private.submit_public_guest_pickup_order(
  text,
  text,
  uuid,
  uuid,
  timestamptz,
  jsonb,
  text,
  jsonb,
  text,
  integer,
  timestamptz
) is
  'Server-only pickup checkout boundary with public scope resolution, fixed on-fulfillment payment and deterministic retention.';
