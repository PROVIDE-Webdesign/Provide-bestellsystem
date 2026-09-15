-- Capability verification remains in the API. This function exposes only a minimal, expiring view.
create function private.read_public_guest_order_status(
  target_restaurant_slug text,
  target_location_slug text,
  target_order_id uuid,
  target_evaluated_at timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_order public.orders%rowtype;
  selected_payment public.order_payments%rowtype;
  available_until timestamptz;
begin
  if target_restaurant_slug is null or target_location_slug is null or target_order_id is null
    or target_evaluated_at is null or not isfinite(target_evaluated_at)
    or char_length(target_restaurant_slug) not between 3 and 63
    or char_length(target_location_slug) not between 2 and 63
    or target_restaurant_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or target_location_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    return null;
  end if;

  select order_record.*
  into selected_order
  from public.orders as order_record
  join public.restaurants as restaurant
    on restaurant.id = order_record.restaurant_id
  join public.locations as location
    on location.restaurant_id = order_record.restaurant_id
    and location.id = order_record.location_id
  join public.order_customer_contacts as contact
    on contact.restaurant_id = order_record.restaurant_id
    and contact.location_id = order_record.location_id
    and contact.order_id = order_record.id
  where restaurant.slug = target_restaurant_slug
    and location.slug = target_location_slug
    and order_record.id = target_order_id
    and order_record.fulfillment_type = 'pickup';

  if selected_order.id is null then return null; end if;
  available_until := selected_order.requested_for + interval '48 hours';
  if target_evaluated_at >= available_until then return null; end if;

  select payment.*
  into selected_payment
  from public.order_payments as payment
  where payment.restaurant_id = selected_order.restaurant_id
    and payment.location_id = selected_order.location_id
    and payment.order_id = selected_order.id
    and payment.collection_mode = 'on_fulfillment';

  if selected_payment.id is null then return null; end if;

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
    'itemCount', selected_order.item_count,
    'updatedAt', to_char(
      selected_order.updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'statusAvailableUntil', to_char(
      available_until at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
end;
$$;

revoke all on function private.read_public_guest_order_status(text, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function private.read_public_guest_order_status(text, text, uuid, timestamptz)
  to service_role;

comment on function private.read_public_guest_order_status(text, text, uuid, timestamptz) is
  'Server-only expiring pickup status view. Capability verification occurs before this SQL boundary.';
