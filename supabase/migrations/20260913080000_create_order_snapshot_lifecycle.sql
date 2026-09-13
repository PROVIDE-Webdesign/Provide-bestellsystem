create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  menu_id uuid not null,
  menu_version_id uuid not null,
  schedule_version_id uuid not null,
  capacity_claim_id uuid not null,
  submission_key text not null,
  submission_payload jsonb not null,
  fulfillment_type text not null,
  requested_for timestamptz not null,
  status text not null default 'submitted',
  currency_code text not null,
  subtotal_amount_minor bigint not null,
  total_amount_minor bigint not null,
  item_count integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_location_fk
    foreign key (restaurant_id, location_id)
    references public.locations (restaurant_id, id)
    on delete restrict,
  constraint orders_menu_version_fk
    foreign key (restaurant_id, menu_id, menu_version_id)
    references public.menu_versions (restaurant_id, menu_id, id)
    on delete restrict,
  constraint orders_schedule_version_fk
    foreign key (restaurant_id, location_id, schedule_version_id)
    references public.availability_schedule_versions (restaurant_id, location_id, id)
    on delete restrict,
  constraint orders_capacity_claim_fk
    foreign key (restaurant_id, location_id, fulfillment_type, capacity_claim_id)
    references public.ordering_capacity_claims (restaurant_id, location_id, fulfillment_type, id)
    on delete restrict,
  constraint orders_restaurant_id_unique unique (restaurant_id, id),
  constraint orders_restaurant_location_id_unique unique (restaurant_id, location_id, id),
  constraint orders_capacity_claim_unique unique (capacity_claim_id),
  constraint orders_submission_unique unique (restaurant_id, location_id, submission_key),
  constraint orders_submission_key_not_blank check (btrim(submission_key) <> ''),
  constraint orders_submission_key_length check (char_length(submission_key) between 8 and 128),
  constraint orders_submission_payload_object check (jsonb_typeof(submission_payload) = 'object'),
  constraint orders_fulfillment_allowed check (fulfillment_type in ('pickup', 'delivery')),
  constraint orders_status_allowed check (
    status in ('submitted', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled')
  ),
  constraint orders_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint orders_subtotal_range check (subtotal_amount_minor between 0 and 1000000000000),
  constraint orders_total_range check (total_amount_minor between 0 and 1000000000000),
  constraint orders_total_matches_subtotal check (total_amount_minor = subtotal_amount_minor),
  constraint orders_item_count_range check (item_count between 1 and 1000)
);

create index orders_location_created_idx
  on public.orders (restaurant_id, location_id, created_at desc, id desc);

create index orders_location_status_idx
  on public.orders (restaurant_id, location_id, status, requested_for, id);

create table public.order_lines (
  restaurant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  line_number integer not null,
  menu_id uuid not null,
  menu_version_id uuid not null,
  menu_item_id uuid not null,
  display_name text not null,
  quantity integer not null,
  unit_price_amount_minor bigint not null,
  line_amount_minor bigint not null,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, order_id, line_number),
  constraint order_lines_order_fk
    foreign key (restaurant_id, location_id, order_id)
    references public.orders (restaurant_id, location_id, id)
    on delete restrict,
  constraint order_lines_menu_version_item_fk
    foreign key (restaurant_id, menu_id, menu_version_id, menu_item_id)
    references public.menu_version_items (restaurant_id, menu_id, menu_version_id, menu_item_id)
    on delete restrict,
  constraint order_lines_number_positive check (line_number > 0),
  constraint order_lines_display_name_not_blank check (btrim(display_name) <> ''),
  constraint order_lines_display_name_length check (char_length(display_name) <= 300),
  constraint order_lines_quantity_range check (quantity between 1 and 1000),
  constraint order_lines_unit_price_range check (unit_price_amount_minor between 0 and 1000000000),
  constraint order_lines_amount_range check (line_amount_minor between 0 and 1000000000000),
  constraint order_lines_amount_matches check (
    line_amount_minor = unit_price_amount_minor * quantity::bigint
  )
);

create index order_lines_order_idx
  on public.order_lines (restaurant_id, location_id, order_id, line_number);

create table public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  event_sequence integer not null,
  from_status text,
  to_status text not null,
  actor_kind text not null,
  actor_user_id uuid references auth.users (id) on delete restrict,
  authentication_assurance text,
  created_at timestamptz not null default now(),
  constraint order_status_events_order_fk
    foreign key (restaurant_id, location_id, order_id)
    references public.orders (restaurant_id, location_id, id)
    on delete restrict,
  constraint order_status_events_order_sequence_unique
    unique (restaurant_id, order_id, event_sequence),
  constraint order_status_events_sequence_positive check (event_sequence > 0),
  constraint order_status_events_from_allowed check (
    from_status is null
    or from_status in ('submitted', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled')
  ),
  constraint order_status_events_to_allowed check (
    to_status in ('submitted', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled')
  ),
  constraint order_status_events_changed check (from_status is null or from_status <> to_status),
  constraint order_status_events_actor_kind_allowed check (actor_kind in ('system', 'personnel')),
  constraint order_status_events_actor_matches_kind check (
    (
      actor_kind = 'system'
      and actor_user_id is null
      and authentication_assurance is null
    )
    or (
      actor_kind = 'personnel'
      and actor_user_id is not null
      and authentication_assurance in ('aal1', 'aal2')
    )
  )
);

create index order_status_events_history_idx
  on public.order_status_events (restaurant_id, location_id, order_id, event_sequence);

create trigger orders_set_updated_at
before update on public.orders
for each row
execute function private.set_updated_at();

create function private.protect_order_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.restaurant_id is distinct from old.restaurant_id
    or new.location_id is distinct from old.location_id
    or new.menu_id is distinct from old.menu_id
    or new.menu_version_id is distinct from old.menu_version_id
    or new.schedule_version_id is distinct from old.schedule_version_id
    or new.capacity_claim_id is distinct from old.capacity_claim_id
    or new.submission_key is distinct from old.submission_key
    or new.submission_payload is distinct from old.submission_payload
    or new.fulfillment_type is distinct from old.fulfillment_type
    or new.requested_for is distinct from old.requested_for
    or new.currency_code is distinct from old.currency_code
    or new.subtotal_amount_minor is distinct from old.subtotal_amount_minor
    or new.total_amount_minor is distinct from old.total_amount_minor
    or new.item_count is distinct from old.item_count
    or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '23514', message = 'order snapshot is immutable';
  end if;

  if new.status is not distinct from old.status then
    raise exception using errcode = '23514', message = 'order update requires a status transition';
  end if;

  if not (
    (old.status = 'submitted' and new.status in ('accepted', 'rejected', 'cancelled'))
    or (old.status = 'accepted' and new.status in ('preparing', 'cancelled'))
    or (old.status = 'preparing' and new.status in ('ready', 'cancelled'))
    or (old.status = 'ready' and new.status = 'completed')
  ) then
    raise exception using errcode = '23514', message = 'order status transition is invalid';
  end if;

  return new;
end;
$$;

create trigger orders_protect_snapshot
before update on public.orders
for each row
execute function private.protect_order_update();

create function private.prevent_order_record_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'order records are append-only';
end;
$$;

create trigger orders_prevent_delete
before delete on public.orders
for each row
execute function private.prevent_order_record_mutation();

create trigger order_lines_append_only
before update or delete on public.order_lines
for each row
execute function private.prevent_order_record_mutation();

create trigger order_status_events_append_only
before update or delete on public.order_status_events
for each row
execute function private.prevent_order_record_mutation();

create function private.assert_order_actor(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text;
begin
  select membership.role
  into actor_role
  from public.restaurant_memberships as membership
  where membership.restaurant_id = target_restaurant_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active';

  if actor_role is null or actor_role not in ('owner', 'manager', 'kitchen') then
    raise exception using
      errcode = 'P0001',
      message = 'order actor must be an active owner, manager or kitchen member';
  end if;

  if actor_role in ('owner', 'manager')
    and target_authentication_assurance is distinct from 'aal2'
  then
    raise exception using errcode = 'P0001', message = 'order administration requires aal2';
  end if;

  if actor_role = 'kitchen'
    and (
      target_authentication_assurance is null
      or target_authentication_assurance not in ('aal1', 'aal2')
    )
  then
    raise exception using errcode = 'P0001', message = 'order kitchen access requires aal1 or aal2';
  end if;

  if actor_role <> 'owner'
    and not exists (
      select 1
      from public.restaurant_membership_locations as assignment
      where assignment.restaurant_id = target_restaurant_id
        and assignment.user_id = target_actor_user_id
        and assignment.location_id = target_location_id
    )
  then
    raise exception using errcode = 'P0001', message = 'order actor is not assigned to the location';
  end if;

  return actor_role;
end;
$$;

create function private.submit_order(
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
      'total_amount_minor', subtotal,
      'item_count', requested_item_count
    ),
    'order-submitted:' || created_order_id::text
  );

  return created_order_id;
end;
$$;

create function private.transition_order_status(
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

  if not (
    (current_order.status = 'submitted' and target_status in ('accepted', 'rejected', 'cancelled'))
    or (current_order.status = 'accepted' and target_status in ('preparing', 'cancelled'))
    or (current_order.status = 'preparing' and target_status in ('ready', 'cancelled'))
    or (current_order.status = 'ready' and target_status = 'completed')
  ) then
    raise exception using errcode = 'P0001', message = 'order status transition is invalid';
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

alter table public.orders enable row level security;
alter table public.orders force row level security;
alter table public.order_lines enable row level security;
alter table public.order_lines force row level security;
alter table public.order_status_events enable row level security;
alter table public.order_status_events force row level security;

create policy orders_select_personnel
on public.orders
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager', 'kitchen']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

create policy order_lines_select_personnel
on public.order_lines
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager', 'kitchen']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

create policy order_status_events_select_personnel
on public.order_status_events
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager', 'kitchen']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

revoke all on table public.orders from public, anon, authenticated, service_role;
revoke all on table public.order_lines from public, anon, authenticated, service_role;
revoke all on table public.order_status_events from public, anon, authenticated, service_role;

grant select on table public.orders to authenticated, service_role;
grant select on table public.order_lines to authenticated, service_role;
grant select on table public.order_status_events to authenticated, service_role;

revoke all on function private.protect_order_update() from public;
revoke all on function private.prevent_order_record_mutation() from public;
revoke all on function private.assert_order_actor(uuid, uuid, uuid, text) from public;
revoke all on function private.submit_order(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  jsonb,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function private.transition_order_status(uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;

grant execute on function private.submit_order(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  jsonb,
  text,
  timestamptz
) to service_role;
grant execute on function private.transition_order_status(uuid, uuid, uuid, text, uuid, text)
  to service_role;

comment on table public.orders is
  'Tenant-bound immutable order snapshots with a controlled status lifecycle and no customer or payment data.';
comment on table public.order_lines is
  'Immutable order-line snapshots copied from the exact published menu version at submission time.';
comment on table public.order_status_events is
  'Append-only order status history written only through controlled server functions.';
comment on function private.submit_order(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  jsonb,
  text,
  timestamptz
) is
  'Atomically validates a public menu, reserves slot capacity and stores an idempotent order snapshot.';
comment on function private.transition_order_status(uuid, uuid, uuid, text, uuid, text) is
  'Applies an authorized order transition, appends history and releases capacity on rejection or cancellation.';
