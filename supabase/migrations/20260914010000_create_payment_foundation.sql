create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  collection_mode text not null,
  status text not null,
  amount_due_minor bigint not null,
  currency_code text not null,
  captured_amount_minor bigint not null default 0,
  refunded_amount_minor bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_payments_order_fk
    foreign key (restaurant_id, location_id, order_id)
    references public.orders (restaurant_id, location_id, id)
    on delete restrict,
  constraint order_payments_tenant_id_unique unique (restaurant_id, location_id, id),
  constraint order_payments_order_unique unique (restaurant_id, order_id),
  constraint order_payments_order_payment_unique
    unique (restaurant_id, location_id, order_id, id),
  constraint order_payments_collection_mode_allowed check (
    collection_mode in ('online', 'on_fulfillment')
  ),
  constraint order_payments_status_allowed check (
    status in (
      'not_required',
      'created',
      'pending_customer',
      'authorized',
      'captured',
      'failed',
      'cancelled',
      'expired',
      'partially_refunded',
      'refunded'
    )
  ),
  constraint order_payments_amount_due_range check (
    amount_due_minor between 0 and 1000000000000
  ),
  constraint order_payments_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint order_payments_captured_range check (
    captured_amount_minor between 0 and amount_due_minor
  ),
  constraint order_payments_refunded_range check (
    refunded_amount_minor between 0 and captured_amount_minor
  ),
  constraint order_payments_mode_matches_status check (
    (
      collection_mode = 'on_fulfillment'
      and status = 'not_required'
      and captured_amount_minor = 0
      and refunded_amount_minor = 0
    )
    or (
      collection_mode = 'online'
      and status <> 'not_required'
    )
  ),
  constraint order_payments_amounts_match_status check (
    (
      status in ('not_required', 'created', 'pending_customer', 'authorized', 'failed', 'cancelled', 'expired')
      and captured_amount_minor = 0
      and refunded_amount_minor = 0
    )
    or (
      status = 'captured'
      and captured_amount_minor = amount_due_minor
      and refunded_amount_minor = 0
    )
    or (
      status = 'partially_refunded'
      and captured_amount_minor = amount_due_minor
      and refunded_amount_minor > 0
      and refunded_amount_minor < captured_amount_minor
    )
    or (
      status = 'refunded'
      and captured_amount_minor = amount_due_minor
      and refunded_amount_minor = captured_amount_minor
    )
  )
);

create index order_payments_location_status_idx
  on public.order_payments (restaurant_id, location_id, status, created_at desc, id desc);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  payment_id uuid not null,
  attempt_key text not null,
  provider_key text not null,
  provider_payment_reference text not null,
  created_at timestamptz not null default now(),
  constraint payment_attempts_payment_fk
    foreign key (restaurant_id, location_id, payment_id)
    references public.order_payments (restaurant_id, location_id, id)
    on delete restrict,
  constraint payment_attempts_tenant_id_unique
    unique (restaurant_id, location_id, payment_id, id),
  constraint payment_attempts_key_unique
    unique (restaurant_id, payment_id, attempt_key),
  constraint payment_attempts_provider_reference_unique
    unique (provider_key, provider_payment_reference),
  constraint payment_attempts_key_not_blank check (btrim(attempt_key) <> ''),
  constraint payment_attempts_key_length check (char_length(attempt_key) between 8 and 128),
  constraint payment_attempts_provider_key_format check (
    provider_key ~ '^[a-z][a-z0-9_]{1,31}$'
  ),
  constraint payment_attempts_provider_reference_not_blank check (
    btrim(provider_payment_reference) <> ''
  ),
  constraint payment_attempts_provider_reference_length check (
    char_length(provider_payment_reference) <= 255
  )
);

create table public.payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  payment_id uuid not null,
  attempt_id uuid not null,
  provider_key text not null,
  provider_event_id text not null,
  provider_event_type text not null,
  target_status text not null,
  reported_amount_minor bigint not null,
  currency_code text not null,
  payload_sha256 text not null,
  occurred_at timestamptz not null,
  processed_at timestamptz not null default now(),
  constraint payment_provider_events_attempt_fk
    foreign key (restaurant_id, location_id, payment_id, attempt_id)
    references public.payment_attempts (restaurant_id, location_id, payment_id, id)
    on delete restrict,
  constraint payment_provider_events_tenant_id_unique
    unique (restaurant_id, location_id, payment_id, attempt_id, id),
  constraint payment_provider_events_provider_id_unique
    unique (provider_key, provider_event_id),
  constraint payment_provider_events_provider_key_format check (
    provider_key ~ '^[a-z][a-z0-9_]{1,31}$'
  ),
  constraint payment_provider_events_event_id_not_blank check (
    btrim(provider_event_id) <> ''
  ),
  constraint payment_provider_events_event_id_length check (
    char_length(provider_event_id) <= 255
  ),
  constraint payment_provider_events_event_type_not_blank check (
    btrim(provider_event_type) <> ''
  ),
  constraint payment_provider_events_event_type_length check (
    char_length(provider_event_type) <= 120
  ),
  constraint payment_provider_events_target_status_allowed check (
    target_status in (
      'authorized',
      'captured',
      'failed',
      'cancelled',
      'expired',
      'partially_refunded',
      'refunded'
    )
  ),
  constraint payment_provider_events_amount_range check (
    reported_amount_minor between 0 and 1000000000000
  ),
  constraint payment_provider_events_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint payment_provider_events_payload_digest_format check (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create index payment_provider_events_payment_idx
  on public.payment_provider_events (
    restaurant_id,
    location_id,
    payment_id,
    occurred_at,
    id
  );

create table public.payment_status_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  payment_id uuid not null,
  event_sequence integer not null,
  from_status text,
  to_status text not null,
  source_kind text not null,
  attempt_id uuid,
  provider_event_id uuid,
  created_at timestamptz not null default now(),
  constraint payment_status_events_order_fk
    foreign key (restaurant_id, location_id, order_id)
    references public.orders (restaurant_id, location_id, id)
    on delete restrict,
  constraint payment_status_events_payment_fk
    foreign key (restaurant_id, location_id, payment_id)
    references public.order_payments (restaurant_id, location_id, id)
    on delete restrict,
  constraint payment_status_events_order_payment_fk
    foreign key (restaurant_id, location_id, order_id, payment_id)
    references public.order_payments (restaurant_id, location_id, order_id, id)
    on delete restrict,
  constraint payment_status_events_attempt_fk
    foreign key (restaurant_id, location_id, payment_id, attempt_id)
    references public.payment_attempts (restaurant_id, location_id, payment_id, id)
    on delete restrict,
  constraint payment_status_events_provider_event_fk
    foreign key (restaurant_id, location_id, payment_id, attempt_id, provider_event_id)
    references public.payment_provider_events (
      restaurant_id,
      location_id,
      payment_id,
      attempt_id,
      id
    )
    on delete restrict,
  constraint payment_status_events_sequence_unique
    unique (restaurant_id, payment_id, event_sequence),
  constraint payment_status_events_sequence_positive check (event_sequence > 0),
  constraint payment_status_events_source_allowed check (
    source_kind in ('system', 'verified_provider')
  ),
  constraint payment_status_events_from_allowed check (
    from_status is null
    or from_status in (
      'not_required',
      'created',
      'pending_customer',
      'authorized',
      'captured',
      'failed',
      'cancelled',
      'expired',
      'partially_refunded',
      'refunded'
    )
  ),
  constraint payment_status_events_to_allowed check (
    to_status in (
      'not_required',
      'created',
      'pending_customer',
      'authorized',
      'captured',
      'failed',
      'cancelled',
      'expired',
      'partially_refunded',
      'refunded'
    )
  ),
  constraint payment_status_events_source_references_match check (
    (
      source_kind = 'system'
      and provider_event_id is null
    )
    or (
      source_kind = 'verified_provider'
      and attempt_id is not null
      and provider_event_id is not null
    )
  ),
  constraint payment_status_events_changed check (
    from_status is null
    or from_status <> to_status
    or to_status = 'partially_refunded'
  )
);

create index payment_status_events_history_idx
  on public.payment_status_events (
    restaurant_id,
    location_id,
    payment_id,
    event_sequence
  );

create function private.prevent_payment_record_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'payment records are append-only';
end;
$$;

create function private.protect_order_payment_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.restaurant_id is distinct from old.restaurant_id
    or new.location_id is distinct from old.location_id
    or new.order_id is distinct from old.order_id
    or new.collection_mode is distinct from old.collection_mode
    or new.amount_due_minor is distinct from old.amount_due_minor
    or new.currency_code is distinct from old.currency_code
    or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '23514', message = 'payment obligation is immutable';
  end if;

  if not (
    (old.status = 'created' and new.status = 'pending_customer')
    or (
      old.status = 'pending_customer'
      and new.status in ('authorized', 'captured', 'failed', 'cancelled', 'expired')
    )
    or (
      old.status = 'authorized'
      and new.status in ('captured', 'failed', 'cancelled', 'expired')
    )
    or (
      old.status in ('failed', 'cancelled', 'expired')
      and new.status = 'pending_customer'
    )
    or (
      old.status = 'captured'
      and new.status in ('partially_refunded', 'refunded')
    )
    or (
      old.status = 'partially_refunded'
      and new.status in ('partially_refunded', 'refunded')
      and new.refunded_amount_minor > old.refunded_amount_minor
    )
  ) then
    raise exception using errcode = '23514', message = 'payment status transition is invalid';
  end if;

  return new;
end;
$$;

create trigger order_payments_set_updated_at
before update on public.order_payments
for each row
execute function private.set_updated_at();

create trigger order_payments_protect_update
before update on public.order_payments
for each row
execute function private.protect_order_payment_update();

create trigger order_payments_prevent_delete
before delete on public.order_payments
for each row
execute function private.prevent_payment_record_mutation();

create trigger payment_attempts_append_only
before update or delete on public.payment_attempts
for each row
execute function private.prevent_payment_record_mutation();

create trigger payment_provider_events_append_only
before update or delete on public.payment_provider_events
for each row
execute function private.prevent_payment_record_mutation();

create trigger payment_status_events_append_only
before update or delete on public.payment_status_events
for each row
execute function private.prevent_payment_record_mutation();

create function private.initialize_order_payment(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_order_id uuid,
  target_collection_mode text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_order public.orders%rowtype;
  existing_payment public.order_payments%rowtype;
  created_payment_id uuid := gen_random_uuid();
  initial_status text;
begin
  if target_collection_mode is null
    or target_collection_mode not in ('online', 'on_fulfillment')
  then
    raise exception using errcode = 'P0001', message = 'payment collection mode is invalid';
  end if;

  select order_record.*
  into selected_order
  from public.orders as order_record
  where order_record.restaurant_id = target_restaurant_id
    and order_record.location_id = target_location_id
    and order_record.id = target_order_id
  for update;

  if selected_order.id is null then
    raise exception using errcode = 'P0001', message = 'payment order was not found';
  end if;

  select payment.*
  into existing_payment
  from public.order_payments as payment
  where payment.restaurant_id = target_restaurant_id
    and payment.order_id = target_order_id;

  if existing_payment.id is not null then
    if existing_payment.location_id = target_location_id
      and existing_payment.collection_mode = target_collection_mode
      and existing_payment.amount_due_minor = selected_order.total_amount_minor
      and existing_payment.currency_code = selected_order.currency_code
    then
      return existing_payment.id;
    end if;

    raise exception using errcode = 'P0001', message = 'order payment requirement conflicts';
  end if;

  if target_collection_mode = 'online'
    and not private.is_restaurant_feature_enabled(target_restaurant_id, 'payment.online')
  then
    raise exception using errcode = 'P0001', message = 'online payment is not enabled';
  end if;

  initial_status := case
    when target_collection_mode = 'online' then 'created'
    else 'not_required'
  end;

  insert into public.order_payments (
    id,
    restaurant_id,
    location_id,
    order_id,
    collection_mode,
    status,
    amount_due_minor,
    currency_code
  )
  values (
    created_payment_id,
    target_restaurant_id,
    target_location_id,
    target_order_id,
    target_collection_mode,
    initial_status,
    selected_order.total_amount_minor,
    selected_order.currency_code
  );

  insert into public.payment_status_events (
    restaurant_id,
    location_id,
    order_id,
    payment_id,
    event_sequence,
    from_status,
    to_status,
    source_kind
  )
  values (
    target_restaurant_id,
    target_location_id,
    target_order_id,
    created_payment_id,
    1,
    null,
    initial_status,
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
    'payment',
    created_payment_id,
    'payment.requirement_created',
    jsonb_build_object(
      'payment_id', created_payment_id,
      'order_id', target_order_id,
      'location_id', target_location_id,
      'collection_mode', target_collection_mode,
      'status', initial_status,
      'amount_due_minor', selected_order.total_amount_minor,
      'currency_code', selected_order.currency_code
    ),
    'payment-requirement:' || created_payment_id::text
  );

  return created_payment_id;
end;
$$;

create function private.submit_order_with_payment(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_menu_id uuid,
  target_menu_version_id uuid,
  target_fulfillment_type text,
  target_requested_for timestamptz,
  target_lines jsonb,
  target_submission_key text,
  target_evaluated_at timestamptz default now(),
  target_payment_collection_mode text default 'on_fulfillment'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_order_id uuid;
begin
  if target_payment_collection_mode is null
    or target_payment_collection_mode not in ('online', 'on_fulfillment')
  then
    raise exception using errcode = 'P0001', message = 'payment collection mode is invalid';
  end if;

  created_order_id := private.submit_order(
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_menu_version_id,
    target_fulfillment_type,
    target_requested_for,
    target_lines,
    target_submission_key,
    target_evaluated_at
  );

  perform private.initialize_order_payment(
    target_restaurant_id,
    target_location_id,
    created_order_id,
    target_payment_collection_mode
  );

  return created_order_id;
end;
$$;

create function private.create_payment_attempt(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_order_id uuid,
  target_attempt_key text,
  target_provider_key text,
  target_provider_payment_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_attempt_key text := btrim(target_attempt_key);
  normalized_provider_key text := lower(btrim(target_provider_key));
  normalized_provider_reference text := btrim(target_provider_payment_reference);
  selected_payment public.order_payments%rowtype;
  existing_attempt public.payment_attempts%rowtype;
  created_attempt_id uuid := gen_random_uuid();
  next_event_sequence integer;
  previous_status text;
begin
  if normalized_attempt_key is null
    or char_length(normalized_attempt_key) < 8
    or char_length(normalized_attempt_key) > 128
  then
    raise exception using errcode = 'P0001', message = 'payment attempt key is invalid';
  end if;

  if normalized_provider_key is null
    or normalized_provider_key !~ '^[a-z][a-z0-9_]{1,31}$'
  then
    raise exception using errcode = 'P0001', message = 'payment provider key is invalid';
  end if;

  if normalized_provider_reference is null
    or normalized_provider_reference = ''
    or char_length(normalized_provider_reference) > 255
  then
    raise exception using errcode = 'P0001', message = 'payment provider reference is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_restaurant_id::text || ':' || target_order_id::text || ':' || normalized_attempt_key,
      0
    )
  );

  select payment.*
  into selected_payment
  from public.order_payments as payment
  where payment.restaurant_id = target_restaurant_id
    and payment.location_id = target_location_id
    and payment.order_id = target_order_id
  for update;

  if selected_payment.id is null then
    raise exception using errcode = 'P0001', message = 'online payment was not found';
  end if;

  if selected_payment.collection_mode <> 'online' then
    raise exception using errcode = 'P0001', message = 'order does not require online payment';
  end if;

  select attempt.*
  into existing_attempt
  from public.payment_attempts as attempt
  where attempt.restaurant_id = target_restaurant_id
    and attempt.payment_id = selected_payment.id
    and attempt.attempt_key = normalized_attempt_key;

  if existing_attempt.id is not null then
    if existing_attempt.location_id = target_location_id
      and existing_attempt.provider_key = normalized_provider_key
      and existing_attempt.provider_payment_reference = normalized_provider_reference
    then
      return existing_attempt.id;
    end if;

    raise exception using errcode = 'P0001', message = 'payment attempt key was reused with different values';
  end if;

  if selected_payment.status not in ('created', 'failed', 'cancelled', 'expired') then
    raise exception using errcode = 'P0001', message = 'payment does not allow a new attempt';
  end if;

  if not private.is_restaurant_feature_enabled(target_restaurant_id, 'payment.online') then
    raise exception using errcode = 'P0001', message = 'online payment is not enabled';
  end if;

  insert into public.payment_attempts (
    id,
    restaurant_id,
    location_id,
    payment_id,
    attempt_key,
    provider_key,
    provider_payment_reference
  )
  values (
    created_attempt_id,
    target_restaurant_id,
    target_location_id,
    selected_payment.id,
    normalized_attempt_key,
    normalized_provider_key,
    normalized_provider_reference
  );

  select coalesce(max(event.event_sequence), 0) + 1
  into next_event_sequence
  from public.payment_status_events as event
  where event.restaurant_id = target_restaurant_id
    and event.payment_id = selected_payment.id;

  previous_status := selected_payment.status;

  update public.order_payments
  set status = 'pending_customer'
  where id = selected_payment.id;

  insert into public.payment_status_events (
    restaurant_id,
    location_id,
    order_id,
    payment_id,
    event_sequence,
    from_status,
    to_status,
    source_kind,
    attempt_id
  )
  values (
    target_restaurant_id,
    target_location_id,
    target_order_id,
    selected_payment.id,
    next_event_sequence,
    previous_status,
    'pending_customer',
    'system',
    created_attempt_id
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
    'payment',
    selected_payment.id,
    'payment.attempt_created',
    jsonb_build_object(
      'payment_id', selected_payment.id,
      'order_id', target_order_id,
      'location_id', target_location_id,
      'attempt_id', created_attempt_id,
      'status', 'pending_customer'
    ),
    'payment-attempt:' || created_attempt_id::text
  );

  return created_attempt_id;
end;
$$;

create function private.apply_verified_payment_event(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_order_id uuid,
  target_provider_key text,
  target_provider_payment_reference text,
  target_provider_event_id text,
  target_provider_event_type text,
  target_status text,
  target_reported_amount_minor bigint,
  target_currency_code text,
  target_payload_sha256 text,
  target_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_provider_key text := lower(btrim(target_provider_key));
  normalized_provider_reference text := btrim(target_provider_payment_reference);
  normalized_provider_event_id text := btrim(target_provider_event_id);
  normalized_provider_event_type text := btrim(target_provider_event_type);
  normalized_currency_code text := upper(btrim(target_currency_code));
  normalized_payload_sha256 text := lower(btrim(target_payload_sha256));
  selected_payment public.order_payments%rowtype;
  selected_attempt public.payment_attempts%rowtype;
  existing_provider_event public.payment_provider_events%rowtype;
  created_provider_event_id uuid := gen_random_uuid();
  created_status_event_id uuid := gen_random_uuid();
  next_event_sequence integer;
  previous_status text;
  next_captured_amount bigint;
  next_refunded_amount bigint;
begin
  if normalized_provider_key is null
    or normalized_provider_key !~ '^[a-z][a-z0-9_]{1,31}$'
  then
    raise exception using errcode = 'P0001', message = 'payment provider key is invalid';
  end if;

  if normalized_provider_reference is null
    or normalized_provider_reference = ''
    or char_length(normalized_provider_reference) > 255
  then
    raise exception using errcode = 'P0001', message = 'payment provider reference is invalid';
  end if;

  if normalized_provider_event_id is null
    or normalized_provider_event_id = ''
    or char_length(normalized_provider_event_id) > 255
  then
    raise exception using errcode = 'P0001', message = 'payment provider event id is invalid';
  end if;

  if normalized_provider_event_type is null
    or normalized_provider_event_type = ''
    or char_length(normalized_provider_event_type) > 120
  then
    raise exception using errcode = 'P0001', message = 'payment provider event type is invalid';
  end if;

  if target_status is null
    or target_status not in (
      'authorized',
      'captured',
      'failed',
      'cancelled',
      'expired',
      'partially_refunded',
      'refunded'
    )
  then
    raise exception using errcode = 'P0001', message = 'payment provider status is invalid';
  end if;

  if target_reported_amount_minor is null or target_reported_amount_minor < 0 then
    raise exception using errcode = 'P0001', message = 'payment provider amount is invalid';
  end if;

  if normalized_currency_code is null or normalized_currency_code !~ '^[A-Z]{3}$' then
    raise exception using errcode = 'P0001', message = 'payment provider currency is invalid';
  end if;

  if normalized_payload_sha256 is null or normalized_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'payment payload digest is invalid';
  end if;

  if target_occurred_at is null then
    raise exception using errcode = 'P0001', message = 'payment provider event timestamp is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_provider_key || ':' || normalized_provider_event_id, 0)
  );

  select provider_event.*
  into existing_provider_event
  from public.payment_provider_events as provider_event
  where provider_event.provider_key = normalized_provider_key
    and provider_event.provider_event_id = normalized_provider_event_id;

  if existing_provider_event.id is not null then
    if existing_provider_event.restaurant_id = target_restaurant_id
      and existing_provider_event.location_id = target_location_id
      and exists (
        select 1
        from public.order_payments as existing_payment
        where existing_payment.id = existing_provider_event.payment_id
          and existing_payment.restaurant_id = target_restaurant_id
          and existing_payment.location_id = target_location_id
          and existing_payment.order_id = target_order_id
      )
      and existing_provider_event.provider_event_type = normalized_provider_event_type
      and existing_provider_event.target_status = target_status
      and existing_provider_event.reported_amount_minor = target_reported_amount_minor
      and existing_provider_event.currency_code = normalized_currency_code
      and existing_provider_event.payload_sha256 = normalized_payload_sha256
      and existing_provider_event.occurred_at = target_occurred_at
    then
      return existing_provider_event.id;
    end if;

    raise exception using errcode = 'P0001', message = 'payment provider event id was reused with different values';
  end if;

  select attempt.*
  into selected_attempt
  from public.payment_attempts as attempt
  where attempt.restaurant_id = target_restaurant_id
    and attempt.location_id = target_location_id
    and attempt.provider_key = normalized_provider_key
    and attempt.provider_payment_reference = normalized_provider_reference;

  if selected_attempt.id is not null then
    select payment.*
    into selected_payment
    from public.order_payments as payment
    where payment.restaurant_id = target_restaurant_id
      and payment.location_id = target_location_id
      and payment.order_id = target_order_id
      and payment.id = selected_attempt.payment_id
    for update;
  end if;

  if selected_payment.id is null or selected_attempt.id is null then
    raise exception using errcode = 'P0001', message = 'payment attempt was not found';
  end if;

  if normalized_currency_code <> selected_payment.currency_code then
    raise exception using errcode = 'P0001', message = 'payment provider currency does not match order';
  end if;

  if target_status in ('authorized', 'captured', 'failed', 'cancelled', 'expired')
    and target_reported_amount_minor <> selected_payment.amount_due_minor
  then
    raise exception using errcode = 'P0001', message = 'payment provider amount does not match order';
  end if;

  if target_status = 'partially_refunded'
    and (
      target_reported_amount_minor <= selected_payment.refunded_amount_minor
      or target_reported_amount_minor >= selected_payment.amount_due_minor
    )
  then
    raise exception using errcode = 'P0001', message = 'partial refund amount is invalid';
  end if;

  if target_status = 'refunded'
    and target_reported_amount_minor <> selected_payment.amount_due_minor
  then
    raise exception using errcode = 'P0001', message = 'full refund amount does not match capture';
  end if;

  previous_status := selected_payment.status;
  next_captured_amount := selected_payment.captured_amount_minor;
  next_refunded_amount := selected_payment.refunded_amount_minor;

  if target_status = 'captured' then
    next_captured_amount := selected_payment.amount_due_minor;
  elsif target_status in ('partially_refunded', 'refunded') then
    next_refunded_amount := target_reported_amount_minor;
  end if;

  insert into public.payment_provider_events (
    id,
    restaurant_id,
    location_id,
    payment_id,
    attempt_id,
    provider_key,
    provider_event_id,
    provider_event_type,
    target_status,
    reported_amount_minor,
    currency_code,
    payload_sha256,
    occurred_at
  )
  values (
    created_provider_event_id,
    target_restaurant_id,
    target_location_id,
    selected_payment.id,
    selected_attempt.id,
    normalized_provider_key,
    normalized_provider_event_id,
    normalized_provider_event_type,
    target_status,
    target_reported_amount_minor,
    normalized_currency_code,
    normalized_payload_sha256,
    target_occurred_at
  );

  update public.order_payments
  set
    status = target_status,
    captured_amount_minor = next_captured_amount,
    refunded_amount_minor = next_refunded_amount
  where id = selected_payment.id;

  select coalesce(max(event.event_sequence), 0) + 1
  into next_event_sequence
  from public.payment_status_events as event
  where event.restaurant_id = target_restaurant_id
    and event.payment_id = selected_payment.id;

  insert into public.payment_status_events (
    id,
    restaurant_id,
    location_id,
    order_id,
    payment_id,
    event_sequence,
    from_status,
    to_status,
    source_kind,
    attempt_id,
    provider_event_id
  )
  values (
    created_status_event_id,
    target_restaurant_id,
    target_location_id,
    target_order_id,
    selected_payment.id,
    next_event_sequence,
    previous_status,
    target_status,
    'verified_provider',
    selected_attempt.id,
    created_provider_event_id
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
    'payment',
    selected_payment.id,
    'payment.status_changed',
    jsonb_build_object(
      'payment_id', selected_payment.id,
      'order_id', target_order_id,
      'location_id', target_location_id,
      'from_status', previous_status,
      'to_status', target_status,
      'amount_due_minor', selected_payment.amount_due_minor,
      'captured_amount_minor', next_captured_amount,
      'refunded_amount_minor', next_refunded_amount,
      'currency_code', selected_payment.currency_code
    ),
    'payment-provider-event:' || created_provider_event_id::text
  );

  return created_provider_event_id;
end;
$$;

create or replace function private.transition_order_status(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_order_id uuid,
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
  current_order public.orders%rowtype;
  current_payment public.order_payments%rowtype;
  created_event_id uuid := gen_random_uuid();
  next_event_sequence integer;
  actor_role text;
begin
  actor_role := private.assert_order_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  if actor_role = 'kitchen' and target_status not in ('accepted', 'preparing', 'ready') then
    raise exception using
      errcode = 'P0001',
      message = 'kitchen personnel cannot apply this order status';
  end if;

  select order_record.*
  into current_order
  from public.orders as order_record
  where order_record.restaurant_id = target_restaurant_id
    and order_record.location_id = target_location_id
    and order_record.id = target_order_id
  for update;

  if current_order.id is null then
    raise exception using errcode = 'P0001', message = 'order was not found';
  end if;

  if target_status is null or not (
    (current_order.status = 'submitted' and target_status in ('accepted', 'rejected', 'cancelled'))
    or (current_order.status = 'accepted' and target_status in ('preparing', 'cancelled'))
    or (current_order.status = 'preparing' and target_status in ('ready', 'cancelled'))
    or (current_order.status = 'ready' and target_status = 'completed')
  ) then
    raise exception using errcode = 'P0001', message = 'order status transition is invalid';
  end if;

  if target_status = 'accepted' then
    select payment.*
    into current_payment
    from public.order_payments as payment
    where payment.restaurant_id = target_restaurant_id
      and payment.location_id = target_location_id
      and payment.order_id = target_order_id
    for update;

    if current_payment.id is null then
      raise exception using errcode = 'P0001', message = 'order payment requirement is missing';
    end if;

    if current_payment.collection_mode = 'online' and current_payment.status <> 'captured' then
      raise exception using errcode = 'P0001', message = 'order online payment is not captured';
    end if;
  end if;

  select coalesce(max(status_event.event_sequence), 0) + 1
  into next_event_sequence
  from public.order_status_events as status_event
  where status_event.restaurant_id = target_restaurant_id
    and status_event.order_id = target_order_id;

  update public.orders
  set status = target_status
  where restaurant_id = target_restaurant_id
    and location_id = target_location_id
    and id = target_order_id;

  insert into public.order_status_events (
    id,
    restaurant_id,
    location_id,
    order_id,
    event_sequence,
    from_status,
    to_status,
    actor_kind,
    actor_user_id,
    authentication_assurance
  )
  values (
    created_event_id,
    target_restaurant_id,
    target_location_id,
    target_order_id,
    next_event_sequence,
    current_order.status,
    target_status,
    'personnel',
    target_actor_user_id,
    target_authentication_assurance
  );

  if target_status in ('rejected', 'cancelled')
    and not private.release_ordering_capacity(
      target_restaurant_id,
      target_location_id,
      current_order.fulfillment_type,
      'order:' || target_order_id::text
    )
  then
    raise exception using errcode = 'P0001', message = 'order capacity release failed';
  end if;

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
    target_order_id,
    'order.status_changed',
    jsonb_build_object(
      'event_id', created_event_id,
      'order_id', target_order_id,
      'location_id', target_location_id,
      'from_status', current_order.status,
      'to_status', target_status
    ),
    'order-status:' || created_event_id::text
  );

  return created_event_id;
end;
$$;

insert into public.order_payments (
  restaurant_id,
  location_id,
  order_id,
  collection_mode,
  status,
  amount_due_minor,
  currency_code
)
select
  order_record.restaurant_id,
  order_record.location_id,
  order_record.id,
  'on_fulfillment',
  'not_required',
  order_record.total_amount_minor,
  order_record.currency_code
from public.orders as order_record
on conflict (restaurant_id, order_id) do nothing;

insert into public.payment_status_events (
  restaurant_id,
  location_id,
  order_id,
  payment_id,
  event_sequence,
  from_status,
  to_status,
  source_kind
)
select
  payment.restaurant_id,
  payment.location_id,
  payment.order_id,
  payment.id,
  1,
  null,
  payment.status,
  'system'
from public.order_payments as payment
where not exists (
  select 1
  from public.payment_status_events as event
  where event.restaurant_id = payment.restaurant_id
    and event.payment_id = payment.id
);

alter table public.order_payments enable row level security;
alter table public.order_payments force row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_attempts force row level security;
alter table public.payment_provider_events enable row level security;
alter table public.payment_provider_events force row level security;
alter table public.payment_status_events enable row level security;
alter table public.payment_status_events force row level security;

create policy order_payments_select_finance_personnel
on public.order_payments
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

create policy payment_status_events_select_finance_personnel
on public.payment_status_events
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

revoke all on table public.order_payments from public, anon, authenticated, service_role;
revoke all on table public.payment_attempts from public, anon, authenticated, service_role;
revoke all on table public.payment_provider_events from public, anon, authenticated, service_role;
revoke all on table public.payment_status_events from public, anon, authenticated, service_role;

grant select on table public.order_payments to authenticated, service_role;
grant select on table public.payment_status_events to authenticated, service_role;
grant select on table public.payment_attempts to service_role;
grant select on table public.payment_provider_events to service_role;

revoke all on function private.prevent_payment_record_mutation() from public;
revoke all on function private.protect_order_payment_update() from public;
revoke all on function private.initialize_order_payment(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.submit_order_with_payment(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  jsonb,
  text,
  timestamptz,
  text
) from public, anon, authenticated;
revoke all on function private.create_payment_attempt(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function private.apply_verified_payment_event(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

revoke execute on function private.submit_order(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  jsonb,
  text,
  timestamptz
) from service_role;

grant execute on function private.submit_order_with_payment(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  jsonb,
  text,
  timestamptz,
  text
) to service_role;
grant execute on function private.create_payment_attempt(uuid, uuid, uuid, text, text, text)
  to service_role;
grant execute on function private.apply_verified_payment_event(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text,
  text,
  timestamptz
) to service_role;

comment on table public.order_payments is
  'Provider-neutral payment obligations copied from immutable order totals without payer or card data.';
comment on table public.payment_attempts is
  'Immutable server-created payment attempts containing only safe provider references.';
comment on table public.payment_provider_events is
  'Deduplicated metadata for API-verified provider events; raw webhook payloads are never stored.';
comment on table public.payment_status_events is
  'Append-only payment status history for system and verified-provider transitions.';
comment on function private.submit_order_with_payment(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  jsonb,
  text,
  timestamptz,
  text
) is
  'Atomically submits an order and creates its provider-neutral payment requirement.';
comment on function private.create_payment_attempt(uuid, uuid, uuid, text, text, text) is
  'Creates an idempotent online-payment attempt through the server-only boundary.';
comment on function private.apply_verified_payment_event(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text,
  text,
  timestamptz
) is
  'Applies metadata from an API-signature-verified provider event with database idempotency and amount checks.';
