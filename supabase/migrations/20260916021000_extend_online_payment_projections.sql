create function private.online_payment_view(target_order uuid) returns text language sql stable security definer set search_path='' as $$
 select case when j.last_error='manual_review' then 'review' when j.refund_state='succeeded' then 'refunded'
 when j.refund_state='failed' then 'refund_failed' when j.refund_state in ('requested','pending') then 'refund_pending'
 when j.close_requested is not null and not j.provider_terminal then 'cancelling'
 when p.status='captured' then 'paid' when p.status in ('expired','cancelled','failed') then 'expired'
 when j.last_error is not null or j.deadline<=statement_timestamp() then 'checking' else 'open' end
 from public.order_payments p join public.online_payment_jobs j on j.order_id=p.order_id where p.order_id=target_order;
$$;
revoke all on function private.online_payment_view(uuid) from public,anon,authenticated,service_role;


create or replace function private.read_dashboard_orders(
  target_actor_user_id uuid,
  target_authentication_assurance text,
  target_restaurant_id uuid,
  target_location_id uuid,
  target_status text default null,
  cursor_requested_for timestamptz default null,
  cursor_order_id uuid default null,
  page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text;
  order_rows jsonb;
  next_cursor text;
begin
  if page_size not between 1 and 50
    or (target_status is not null and target_status not in (
      'submitted', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled'
    ))
    or ((cursor_requested_for is null) <> (cursor_order_id is null))
  then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  actor_role := private.dashboard_order_actor_role(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );
  if actor_role is null then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  with selected as (
    select
      order_record.*,
      payment.collection_mode,
      row_number() over (order by order_record.requested_for, order_record.id) as row_number
    from public.orders as order_record
    join public.order_payments as payment
      on payment.restaurant_id = order_record.restaurant_id
      and payment.location_id = order_record.location_id
      and payment.order_id = order_record.id
    where order_record.restaurant_id = target_restaurant_id
      and order_record.location_id = target_location_id
      and order_record.fulfillment_type in ('pickup','delivery')
      and payment.collection_mode in ('on_fulfillment','online')
      and (target_status is null or order_record.status = target_status)
      and (
        cursor_requested_for is null
        or (order_record.requested_for, order_record.id) > (cursor_requested_for, cursor_order_id)
      )
    order by order_record.requested_for, order_record.id
    limit page_size + 1
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'orderId', selected.id,
          'status', selected.status,
          'fulfillmentType', selected.fulfillment_type,
          'paymentCollectionMode', selected.collection_mode,
          'paymentState', case when actor_role in ('owner','manager') then private.online_payment_view(selected.id) else null end,
          'requestedFor', to_char(
            selected.requested_for at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'currency', selected.currency_code,
          'totalAmountMinor', selected.total_amount_minor,
          'itemCount', selected.item_count,
          'updatedAt', to_char(
            selected.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'allowedTransitions', case when exists(select 1 from public.online_payment_jobs j join public.order_payments p on p.order_id=j.order_id where j.order_id=selected.id and (j.close_requested is not null or p.status<>'captured')) then case when actor_role in ('owner','manager') and selected.status='submitted' then '["rejected","cancelled"]'::jsonb else '[]'::jsonb end else private.dashboard_order_allowed_transitions(selected.status, actor_role) end
        )
        order by selected.requested_for, selected.id
      ) filter (where selected.row_number <= page_size),
      '[]'::jsonb
    ),
    case when count(*) > page_size then (
      select to_char(
        cursor_row.requested_for at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) || '|' || cursor_row.id::text
      from selected as cursor_row
      where cursor_row.row_number = page_size
    ) end
  into order_rows, next_cursor
  from selected;

  return jsonb_build_object(
    'outcome', 'allowed',
    'data', jsonb_build_object(
      'restaurantId', target_restaurant_id,
      'locationId', target_location_id,
      'orders', order_rows,
      'nextCursor', next_cursor
    )
  );
end;
$$;

create or replace function private.read_dashboard_fulfillment_orders(
  target_actor_user_id uuid,
  target_authentication_assurance text,
  target_restaurant_id uuid,
  target_location_id uuid,
  target_status text default null,
  cursor_requested_for timestamptz default null,
  cursor_order_id uuid default null,
  page_size integer default 25,
  target_fulfillment text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text;
  order_rows jsonb;
  next_cursor text;
begin
  if (target_fulfillment is not null and target_fulfillment not in ('pickup','delivery')) or page_size not between 1 and 50
    or (target_status is not null and target_status not in (
      'submitted', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled'
    ))
    or ((cursor_requested_for is null) <> (cursor_order_id is null))
  then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  actor_role := private.dashboard_order_actor_role(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );
  if actor_role is null then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  with selected as (
    select
      order_record.*,
      payment.collection_mode,
      row_number() over (order by order_record.requested_for, order_record.id) as row_number
    from public.orders as order_record
    join public.order_payments as payment
      on payment.restaurant_id = order_record.restaurant_id
      and payment.location_id = order_record.location_id
      and payment.order_id = order_record.id
    where order_record.restaurant_id = target_restaurant_id
      and order_record.location_id = target_location_id
      and order_record.fulfillment_type in ('pickup','delivery')
      and payment.collection_mode in ('on_fulfillment','online')
      and (target_fulfillment is null or order_record.fulfillment_type=target_fulfillment)
      and (target_status is null or order_record.status = target_status)
      and (
        cursor_requested_for is null
        or (order_record.requested_for, order_record.id) > (cursor_requested_for, cursor_order_id)
      )
    order by order_record.requested_for, order_record.id
    limit page_size + 1
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'orderId', selected.id,
          'status', selected.status,
          'fulfillmentType', selected.fulfillment_type,
          'paymentCollectionMode', selected.collection_mode,
          'paymentState', case when actor_role in ('owner','manager') then private.online_payment_view(selected.id) else null end,
          'requestedFor', to_char(
            selected.requested_for at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'currency', selected.currency_code,
          'totalAmountMinor', selected.total_amount_minor,
          'itemCount', selected.item_count,
          'updatedAt', to_char(
            selected.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'allowedTransitions', case when exists(select 1 from public.online_payment_jobs j join public.order_payments p on p.order_id=j.order_id where j.order_id=selected.id and (j.close_requested is not null or p.status<>'captured')) then case when actor_role in ('owner','manager') and selected.status='submitted' then '["rejected","cancelled"]'::jsonb else '[]'::jsonb end else private.dashboard_order_allowed_transitions(selected.status, actor_role) end
        )
        order by selected.requested_for, selected.id
      ) filter (where selected.row_number <= page_size),
      '[]'::jsonb
    ),
    case when count(*) > page_size then (
      select to_char(
        cursor_row.requested_for at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) || '|' || cursor_row.id::text
      from selected as cursor_row
      where cursor_row.row_number = page_size
    ) end
  into order_rows, next_cursor
  from selected;

  return jsonb_build_object(
    'outcome', 'allowed',
    'data', jsonb_build_object(
      'restaurantId', target_restaurant_id,
      'locationId', target_location_id,
      'orders', order_rows,
      'nextCursor', next_cursor
    )
  );
end;
$$;

create or replace function private.read_dashboard_order(
  target_actor_user_id uuid,
  target_authentication_assurance text,
  target_restaurant_id uuid,
  target_location_id uuid,
  target_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text;
  order_data jsonb;
begin
  actor_role := private.dashboard_order_actor_role(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );
  if actor_role is null then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  select jsonb_build_object(
    'orderId', order_record.id,
    'restaurantId', order_record.restaurant_id,
    'locationId', order_record.location_id,
    'status', order_record.status,
    'fulfillmentType', order_record.fulfillment_type,
    'paymentCollectionMode', payment.collection_mode,
          'paymentState', case when actor_role in ('owner','manager') then private.online_payment_view(order_record.id) else null end,
    'requestedFor', to_char(
      order_record.requested_for at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'currency', order_record.currency_code,
    'totalAmountMinor', order_record.total_amount_minor,
    'itemCount', order_record.item_count,
    'updatedAt', to_char(
      order_record.updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'allowedTransitions', case when exists(select 1 from public.online_payment_jobs j join public.order_payments p on p.order_id=j.order_id where j.order_id=order_record.id and (j.close_requested is not null or p.status<>'captured')) then case when actor_role in ('owner','manager') and order_record.status='submitted' then '["rejected","cancelled"]'::jsonb else '[]'::jsonb end else private.dashboard_order_allowed_transitions(order_record.status, actor_role) end,
    'delivery', case when actor_role in ('owner','manager') and d.purged_at is null and d.order_id is not null then
      jsonb_build_object('recipientName',d.recipient_name,'phoneE164',d.phone_e164,
      'addressLine1',d.address_line_1,'addressLine2',d.address_line_2,'postalCode',d.postal_code,'city',d.city,'countryCode',d.country_code)
      else null end,
    'deliveryFeeAmountMinor', order_record.delivery_fee_amount_minor,
    'contactName', case
      when actor_role in ('owner', 'manager') and contact.purged_at is null then contact.contact_name
      else null
    end,
    'lines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'lineNumber', order_line.line_number,
          'displayName', btrim(order_line.display_name),
          'quantity', order_line.quantity,
          'unitPriceAmountMinor', order_line.unit_price_amount_minor,
          'lineAmountMinor', order_line.line_amount_minor
        ) order by order_line.line_number
      )
      from public.order_lines as order_line
      where order_line.restaurant_id = order_record.restaurant_id
        and order_line.location_id = order_record.location_id
        and order_line.order_id = order_record.id
    ), '[]'::jsonb)
  )
  into order_data
  from public.orders as order_record
  join public.order_payments as payment
    on payment.restaurant_id = order_record.restaurant_id
    and payment.location_id = order_record.location_id
    and payment.order_id = order_record.id
  left join public.order_customer_contacts as contact
    on contact.restaurant_id = order_record.restaurant_id
    and contact.location_id = order_record.location_id
    and contact.order_id = order_record.id
  left join public.order_delivery_details d on d.restaurant_id=order_record.restaurant_id
    and d.location_id=order_record.location_id and d.order_id=order_record.id
  where order_record.restaurant_id = target_restaurant_id
    and order_record.location_id = target_location_id
    and order_record.id = target_order_id
    and order_record.fulfillment_type in ('pickup','delivery')
    and payment.collection_mode in ('on_fulfillment','online');

  if order_data is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  return jsonb_build_object('outcome', 'allowed', 'data', order_data);
end;
$$;

create or replace function private.transition_dashboard_order_status(
  target_actor_user_id uuid,
  target_authentication_assurance text,
  target_restaurant_id uuid,
  target_location_id uuid,
  target_order_id uuid,
  expected_status text,
  target_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  current_order public.orders%rowtype;
begin
  actor_role := private.dashboard_order_actor_role(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );
  if actor_role is null then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  select order_record.*
  into current_order
  from public.orders as order_record
  where order_record.restaurant_id = target_restaurant_id
    and order_record.location_id = target_location_id
    and order_record.id = target_order_id
    and order_record.fulfillment_type in ('pickup','delivery')
    and exists (
      select 1
      from public.order_payments as payment
      where payment.restaurant_id = order_record.restaurant_id
        and payment.location_id = order_record.location_id
        and payment.order_id = order_record.id
        and payment.collection_mode in ('on_fulfillment','online')
    )
  for update;

  if current_order.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if current_order.status is distinct from expected_status then
    return jsonb_build_object('outcome', 'conflict');
  end if;
  if not (private.dashboard_order_allowed_transitions(current_order.status, actor_role) ? target_status) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if actor_role in ('owner','manager') and target_status in ('cancelled','rejected') and exists(
    select 1 from public.online_payment_jobs where order_id=target_order_id and not provider_terminal) then
    update public.online_payment_jobs set close_requested=target_status,next_at=statement_timestamp() where order_id=target_order_id;
    return jsonb_build_object('outcome','updated','data',jsonb_build_object('orderId',current_order.id,'status',current_order.status,
      'updatedAt',to_char(current_order.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end if;
  if target_status='accepted' and exists(select 1 from public.order_payments where order_id=target_order_id and collection_mode='online' and status<>'captured')
    then return jsonb_build_object('outcome','conflict'); end if;
  perform private.transition_order_status(
    target_restaurant_id,
    target_location_id,
    target_order_id,
    target_status,
    target_actor_user_id,
    target_authentication_assurance
  );
  select order_record.*
  into current_order
  from public.orders as order_record
  where order_record.restaurant_id = target_restaurant_id
    and order_record.location_id = target_location_id
    and order_record.id = target_order_id;

  return jsonb_build_object(
    'outcome', 'updated',
    'data', jsonb_build_object(
      'orderId', current_order.id,
      'status', current_order.status,
      'updatedAt', to_char(
        current_order.updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    )
  );
end;
$$;

create or replace function private.read_public_guest_order_status(
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
    and order_record.fulfillment_type in ('pickup','delivery');

  if selected_order.id is null then return null; end if;
  available_until := selected_order.requested_for + interval '48 hours';
  if target_evaluated_at >= available_until then return null; end if;

  select payment.*
  into selected_payment
  from public.order_payments as payment
  where payment.restaurant_id = selected_order.restaurant_id
    and payment.location_id = selected_order.location_id
    and payment.order_id = selected_order.id
    and payment.collection_mode in ('on_fulfillment','online');

  if selected_payment.id is null then return null; end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'orderId', selected_order.id,
    'status', selected_order.status,
    'fulfillmentType', selected_order.fulfillment_type,
    'paymentCollectionMode', selected_payment.collection_mode,
    'paymentState', private.online_payment_view(selected_order.id),
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
  ));
end;
$$;

create or replace function private.claim_notification_deliveries(
  target_lock_token uuid,
  target_batch_size integer,
  target_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  claimed jsonb := '[]'::jsonb;
begin
  if target_lock_token is null then
    raise exception using errcode = 'P0001', message = 'notification lock token is required';
  end if;
  if target_batch_size is null or target_batch_size < 1 or target_batch_size > 25 then
    raise exception using errcode = 'P0001', message = 'notification batch size is invalid';
  end if;
  if target_now is null then
    raise exception using errcode = 'P0001', message = 'notification dispatch time is required';
  end if;

  with expired as (
    select delivery.id
    from public.notification_deliveries as delivery
    where delivery.status = 'processing'
      and delivery.locked_at <= target_now - interval '5 minutes'
    order by delivery.locked_at, delivery.id
    limit target_batch_size
    for update skip locked
  )
  update public.notification_deliveries as delivery
  set
    status = case when delivery.attempt_count >= 6 then 'dead_letter' else 'retry' end,
    available_at = target_now,
    lock_token = null,
    locked_at = null,
    dead_letter_at = case when delivery.attempt_count >= 6 then target_now else null end,
    last_error_code = 'worker_timeout'
  from expired
  where delivery.id = expired.id;

  for candidate in
    select
      delivery.id,
      delivery.restaurant_id,
      delivery.location_id,
      delivery.order_id,
      delivery.template_key,
      delivery.template_version,
      delivery.target_status,
      order_record.status as current_status,
      order_record.fulfillment_type,
      order_record.requested_for,
      restaurant.display_name as restaurant_name,
      restaurant.status as restaurant_status,
      location.status as location_status,
      location.timezone as location_timezone,
      contact.phone_e164,
      contact.purged_at
    from public.notification_deliveries as delivery
    join public.orders as order_record
      on order_record.restaurant_id = delivery.restaurant_id
      and order_record.location_id = delivery.location_id
      and order_record.id = delivery.order_id
    join public.restaurants as restaurant on restaurant.id = delivery.restaurant_id
    join public.locations as location
      on location.restaurant_id = delivery.restaurant_id
      and location.id = delivery.location_id
    left join public.order_customer_contacts as contact
      on contact.restaurant_id = delivery.restaurant_id
      and contact.location_id = delivery.location_id
      and contact.order_id = delivery.order_id
    where delivery.status in ('queued', 'retry')
      and delivery.available_at <= target_now
    and not exists(select 1 from public.order_payments p where p.order_id=delivery.order_id and p.collection_mode='online' and p.status not in ('captured','refunded','partially_refunded') and order_record.status='submitted')
    order by delivery.available_at, delivery.created_at, delivery.id
    limit target_batch_size
    for update of delivery skip locked
  loop
    if candidate.phone_e164 is null or candidate.purged_at is not null then
      update public.notification_deliveries
      set
        status = 'suppressed',
        suppressed_at = target_now,
        last_error_code = 'contact_unavailable'
      where id = candidate.id;
    elsif candidate.current_status is distinct from candidate.target_status then
      update public.notification_deliveries
      set
        status = 'suppressed',
        suppressed_at = target_now,
        last_error_code = 'superseded'
      where id = candidate.id;
    elsif candidate.restaurant_status <> 'active'
      or candidate.location_status <> 'active'
      or not exists (
        select 1
        from pg_catalog.pg_timezone_names as timezone
        where timezone.name = candidate.location_timezone
      )
    then
      update public.notification_deliveries
      set
        status = 'suppressed',
        suppressed_at = target_now,
        last_error_code = 'scope_unavailable'
      where id = candidate.id;
    else
      update public.notification_deliveries
      set
        status = 'processing',
        attempt_count = attempt_count + 1,
        lock_token = target_lock_token,
        locked_at = target_now,
        last_error_code = null
      where id = candidate.id;

      claimed := claimed || jsonb_build_array(jsonb_build_object(
        'deliveryId', candidate.id,
        'lockToken', target_lock_token,
        'orderId', candidate.order_id,
        'channel', 'sms',
        'fulfillmentType', candidate.fulfillment_type,
        'templateKey', candidate.template_key,
        'templateVersion', candidate.template_version,
        'targetStatus', candidate.target_status,
        'restaurantName', left(btrim(candidate.restaurant_name), 160),
        'requestedFor', to_char(
          candidate.requested_for at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'locationTimezone', candidate.location_timezone,
        'phoneE164', candidate.phone_e164
      ));
    end if;
  end loop;

  return claimed;
end;
$$;

create function private.retry_online_refund(actor uuid,aal text,restaurant uuid,location uuid,target_order uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.online_payment_jobs%rowtype;
begin
 if coalesce(private.dashboard_order_actor_role(restaurant,location,actor,aal),'') not in ('owner','manager') then return jsonb_build_object('outcome','forbidden'); end if;
 perform 1 from public.orders where id=target_order and restaurant_id=restaurant and location_id=location for update;
 if not found then return jsonb_build_object('outcome','not_found'); end if;
 select * into j from public.online_payment_jobs where order_id=target_order for update;
 if j.id is null or j.refund_state<>'failed' or j.refund_id is null or j.lease_until>statement_timestamp()
   then return jsonb_build_object('outcome','conflict'); end if;
 insert into public.online_refund_retries(job_id,sequence,previous_refund,actor_id)
   values(j.id,j.refund_sequence+1,j.refund_id,actor);
 update public.online_payment_jobs set next_at=statement_timestamp(),last_error=null,refund_id=null,
   refund_sequence=refund_sequence+1,refund_state='requested',lease_token=null,lease_until=null where id=j.id;
 return jsonb_build_object('outcome','allowed');
end;
$$;
revoke all on function private.retry_online_refund(uuid,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.retry_online_refund(uuid,text,uuid,uuid,uuid) to service_role;
