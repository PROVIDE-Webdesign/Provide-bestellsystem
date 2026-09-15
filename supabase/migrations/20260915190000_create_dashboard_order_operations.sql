-- Server-only operational order projections and a stale-write-safe status command.
create function private.dashboard_order_actor_role(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select membership.role
  from public.restaurant_memberships as membership
  where membership.restaurant_id = target_restaurant_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active'
    and membership.role in ('owner', 'manager', 'kitchen')
    and (
      (membership.role in ('owner', 'manager') and target_authentication_assurance = 'aal2')
      or (membership.role = 'kitchen' and target_authentication_assurance in ('aal1', 'aal2'))
    )
    and (
      membership.role = 'owner'
      or exists (
        select 1
        from public.restaurant_membership_locations as assignment
        where assignment.restaurant_id = membership.restaurant_id
          and assignment.user_id = membership.user_id
          and assignment.location_id = target_location_id
      )
    )
$$;

create function private.dashboard_order_allowed_transitions(current_status text, actor_role text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when current_status = 'submitted' and actor_role = 'kitchen' then '["accepted"]'::jsonb
    when current_status = 'submitted' then '["accepted","rejected","cancelled"]'::jsonb
    when current_status = 'accepted' and actor_role = 'kitchen' then '["preparing"]'::jsonb
    when current_status = 'accepted' then '["preparing","cancelled"]'::jsonb
    when current_status = 'preparing' and actor_role = 'kitchen' then '["ready"]'::jsonb
    when current_status = 'preparing' then '["ready","cancelled"]'::jsonb
    when current_status = 'ready' and actor_role in ('owner', 'manager') then '["completed"]'::jsonb
    else '[]'::jsonb
  end
$$;

create function private.read_dashboard_orders(
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
      and order_record.fulfillment_type = 'pickup'
      and payment.collection_mode = 'on_fulfillment'
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
          'allowedTransitions', private.dashboard_order_allowed_transitions(selected.status, actor_role)
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

create function private.read_dashboard_order(
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
    'allowedTransitions', private.dashboard_order_allowed_transitions(order_record.status, actor_role),
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
  where order_record.restaurant_id = target_restaurant_id
    and order_record.location_id = target_location_id
    and order_record.id = target_order_id
    and order_record.fulfillment_type = 'pickup'
    and payment.collection_mode = 'on_fulfillment';

  if order_data is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  return jsonb_build_object('outcome', 'allowed', 'data', order_data);
end;
$$;

create function private.transition_dashboard_order_status(
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
    and order_record.fulfillment_type = 'pickup'
    and exists (
      select 1
      from public.order_payments as payment
      where payment.restaurant_id = order_record.restaurant_id
        and payment.location_id = order_record.location_id
        and payment.order_id = order_record.id
        and payment.collection_mode = 'on_fulfillment'
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

revoke all on function private.dashboard_order_actor_role(uuid, uuid, uuid, text) from public;
revoke all on function private.dashboard_order_allowed_transitions(text, text) from public;
revoke all on function private.read_dashboard_orders(uuid, text, uuid, uuid, text, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function private.read_dashboard_order(uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.transition_dashboard_order_status(uuid, text, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function private.read_dashboard_orders(uuid, text, uuid, uuid, text, timestamptz, uuid, integer)
  to service_role;
grant execute on function private.read_dashboard_order(uuid, text, uuid, uuid, uuid)
  to service_role;
grant execute on function private.transition_dashboard_order_status(uuid, text, uuid, uuid, uuid, text, text)
  to service_role;

comment on function private.read_dashboard_orders(uuid, text, uuid, uuid, text, timestamptz, uuid, integer) is
  'Bounded, server-only operational pickup queue after role, MFA and location authorization.';
comment on function private.read_dashboard_order(uuid, text, uuid, uuid, uuid) is
  'Minimal order detail; contact name is limited to management and all other contact fields remain hidden.';
comment on function private.transition_dashboard_order_status(uuid, text, uuid, uuid, uuid, text, text) is
  'Stale-write-safe dashboard command delegating the actual transition, history, capacity and outbox write.';
