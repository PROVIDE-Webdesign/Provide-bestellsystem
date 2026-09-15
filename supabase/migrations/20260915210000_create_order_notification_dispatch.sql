create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  outbox_event_id uuid not null references public.outbox_events (id) on delete restrict,
  channel text not null,
  template_key text not null,
  template_version integer not null,
  target_status text not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  lock_token uuid,
  locked_at timestamptz,
  sent_at timestamptz,
  suppressed_at timestamptz,
  dead_letter_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_order_fk
    foreign key (restaurant_id, location_id, order_id)
    references public.orders (restaurant_id, location_id, id)
    on delete restrict,
  constraint notification_deliveries_channel_allowed check (channel = 'sms'),
  constraint notification_deliveries_template_key_format check (
    template_key ~ '^order_(submitted|accepted|rejected|ready|cancelled)$'
  ),
  constraint notification_deliveries_template_version_positive check (template_version > 0),
  constraint notification_deliveries_target_status_allowed check (
    target_status in ('submitted', 'accepted', 'rejected', 'ready', 'cancelled')
  ),
  constraint notification_deliveries_status_allowed check (
    status in ('queued', 'processing', 'retry', 'sent', 'suppressed', 'dead_letter')
  ),
  constraint notification_deliveries_attempt_count_range check (attempt_count between 0 and 6),
  constraint notification_deliveries_processing_lock check (
    (status = 'processing') = (lock_token is not null and locked_at is not null)
  ),
  constraint notification_deliveries_sent_timestamp check (
    (status = 'sent') = (sent_at is not null)
  ),
  constraint notification_deliveries_suppressed_timestamp check (
    (status = 'suppressed') = (suppressed_at is not null)
  ),
  constraint notification_deliveries_dead_letter_timestamp check (
    (status = 'dead_letter') = (dead_letter_at is not null)
  ),
  constraint notification_deliveries_error_code_allowed check (
    last_error_code is null or last_error_code in (
      'adapter_request_failed',
      'contact_unavailable',
      'content_rejected',
      'destination_invalid',
      'destination_rejected',
      'invalid_adapter_result',
      'provider_rate_limited',
      'provider_timeout',
      'provider_unavailable',
      'scope_unavailable',
      'superseded',
      'worker_timeout'
    )
  ),
  constraint notification_deliveries_outbox_channel_version_unique
    unique (outbox_event_id, channel, template_version)
);

create index notification_deliveries_dispatch_idx
  on public.notification_deliveries (available_at, created_at, id)
  where status in ('queued', 'retry');

create index notification_deliveries_order_history_idx
  on public.notification_deliveries (restaurant_id, order_id, created_at, id);

create trigger notification_deliveries_set_updated_at
before update on public.notification_deliveries
for each row
execute function private.set_updated_at();

create function private.enqueue_order_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_location_id uuid;
  selected_status text;
begin
  if new.event_version <> 1 or new.aggregate_type <> 'order' then
    return new;
  end if;

  if new.event_type = 'order.submitted' then
    selected_status := 'submitted';
  elsif new.event_type = 'order.status_changed'
    and new.payload ->> 'to_status' in ('accepted', 'rejected', 'ready', 'cancelled')
  then
    selected_status := new.payload ->> 'to_status';
  else
    return new;
  end if;

  select order_record.location_id
  into selected_location_id
  from public.orders as order_record
  where order_record.restaurant_id = new.restaurant_id
    and order_record.id = new.aggregate_id;

  if selected_location_id is null then
    raise exception using errcode = 'P0001', message = 'notification order scope is invalid';
  end if;

  insert into public.notification_deliveries (
    restaurant_id,
    location_id,
    order_id,
    outbox_event_id,
    channel,
    template_key,
    template_version,
    target_status
  )
  values (
    new.restaurant_id,
    selected_location_id,
    new.aggregate_id,
    new.id,
    'sms',
    'order_' || selected_status,
    1,
    selected_status
  )
  on conflict (outbox_event_id, channel, template_version) do nothing;

  return new;
end;
$$;

create trigger outbox_events_enqueue_order_notification
after insert on public.outbox_events
for each row
execute function private.enqueue_order_notification();

create function private.claim_notification_deliveries(
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

create function private.finish_notification_delivery(
  target_delivery_id uuid,
  target_lock_token uuid,
  target_result text,
  target_error_code text,
  target_now timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_delivery public.notification_deliveries%rowtype;
  retry_delay interval;
begin
  if target_delivery_id is null or target_lock_token is null or target_now is null then
    raise exception using errcode = 'P0001', message = 'notification completion scope is invalid';
  end if;
  if target_result not in ('accepted', 'temporary_failure', 'permanent_failure') then
    raise exception using errcode = 'P0001', message = 'notification completion result is invalid';
  end if;
  if target_result = 'accepted' and target_error_code is not null then
    raise exception using errcode = 'P0001', message = 'accepted notification cannot contain an error';
  end if;
  if target_result <> 'accepted'
    and (
      target_error_code is null
      or target_error_code not in (
        'adapter_request_failed',
        'content_rejected',
        'destination_invalid',
        'destination_rejected',
        'invalid_adapter_result',
        'provider_rate_limited',
        'provider_timeout',
        'provider_unavailable'
      )
    )
  then
    raise exception using errcode = 'P0001', message = 'notification error code is invalid';
  end if;

  select delivery.*
  into selected_delivery
  from public.notification_deliveries as delivery
  where delivery.id = target_delivery_id
  for update;

  if selected_delivery.id is null
    or selected_delivery.status <> 'processing'
    or selected_delivery.lock_token is distinct from target_lock_token
  then
    return 'conflict';
  end if;

  if target_result = 'accepted' then
    update public.notification_deliveries
    set
      status = 'sent',
      lock_token = null,
      locked_at = null,
      sent_at = target_now,
      last_error_code = null
    where id = target_delivery_id;
    return 'sent';
  end if;

  if target_result = 'permanent_failure' or selected_delivery.attempt_count >= 6 then
    update public.notification_deliveries
    set
      status = 'dead_letter',
      lock_token = null,
      locked_at = null,
      dead_letter_at = target_now,
      last_error_code = target_error_code
    where id = target_delivery_id;
    return 'dead_letter';
  end if;

  retry_delay := case selected_delivery.attempt_count
    when 1 then interval '30 seconds'
    when 2 then interval '2 minutes'
    when 3 then interval '10 minutes'
    when 4 then interval '30 minutes'
    else interval '2 hours'
  end;

  update public.notification_deliveries
  set
    status = 'retry',
    lock_token = null,
    locked_at = null,
    available_at = target_now + retry_delay,
    last_error_code = target_error_code
  where id = target_delivery_id;
  return 'retry';
end;
$$;

alter table public.notification_deliveries enable row level security;
alter table public.notification_deliveries force row level security;

revoke all on table public.notification_deliveries from public, anon, authenticated, service_role;
revoke all on function private.enqueue_order_notification() from public, anon, authenticated;
revoke all on function private.claim_notification_deliveries(uuid, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function private.finish_notification_delivery(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function private.enqueue_order_notification() to service_role;
grant execute on function private.claim_notification_deliveries(uuid, integer, timestamptz)
  to service_role;
grant execute on function private.finish_notification_delivery(uuid, uuid, text, text, timestamptz)
  to service_role;

comment on table public.notification_deliveries is
  'PII-free, tenant-bound delivery ledger derived transactionally from order outbox events.';
comment on function private.claim_notification_deliveries(uuid, integer, timestamptz) is
  'Claims a bounded SMS batch and releases the protected phone value only to the server worker.';
comment on function private.finish_notification_delivery(uuid, uuid, text, text, timestamptz) is
  'Completes an owned notification attempt with bounded retry and dead-letter handling.';
