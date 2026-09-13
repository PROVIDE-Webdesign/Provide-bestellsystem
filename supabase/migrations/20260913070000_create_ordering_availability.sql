create table public.availability_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  version_number integer not null,
  status text not null default 'draft',
  minimum_lead_minutes integer not null default 15,
  maximum_advance_days integer not null default 14,
  slot_interval_minutes integer not null default 15,
  default_order_capacity integer,
  default_item_capacity integer,
  source_version_id uuid,
  created_by_user_id uuid not null references auth.users (id) on delete restrict,
  published_by_user_id uuid references auth.users (id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_schedule_versions_location_fk
    foreign key (restaurant_id, location_id)
    references public.locations (restaurant_id, id)
    on delete restrict,
  constraint availability_schedule_versions_tenant_id_unique
    unique (restaurant_id, location_id, id),
  constraint availability_schedule_versions_number_unique
    unique (restaurant_id, location_id, version_number),
  constraint availability_schedule_versions_number_positive check (version_number > 0),
  constraint availability_schedule_versions_status_allowed check (
    status in ('draft', 'published')
  ),
  constraint availability_schedule_versions_lead_range check (
    minimum_lead_minutes between 0 and 10080
  ),
  constraint availability_schedule_versions_advance_range check (
    maximum_advance_days between 1 and 365
  ),
  constraint availability_schedule_versions_slot_interval check (
    slot_interval_minutes between 5 and 240
    and 1440 % slot_interval_minutes = 0
  ),
  constraint availability_schedule_versions_order_capacity_positive check (
    default_order_capacity is null or default_order_capacity > 0
  ),
  constraint availability_schedule_versions_item_capacity_positive check (
    default_item_capacity is null or default_item_capacity > 0
  ),
  constraint availability_schedule_versions_has_capacity check (
    default_order_capacity is not null or default_item_capacity is not null
  ),
  constraint availability_schedule_versions_publication_audit check (
    (
      status = 'draft'
      and published_by_user_id is null
      and published_at is null
    )
    or (
      status = 'published'
      and published_by_user_id is not null
      and published_at is not null
    )
  )
);

alter table public.availability_schedule_versions
  add constraint availability_schedule_versions_source_fk
  foreign key (restaurant_id, location_id, source_version_id)
  references public.availability_schedule_versions (restaurant_id, location_id, id)
  on delete restrict;

create index availability_schedule_versions_status_idx
  on public.availability_schedule_versions (
    restaurant_id,
    location_id,
    status,
    version_number desc
  );

create table public.availability_windows (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  schedule_version_id uuid not null,
  fulfillment_type text not null,
  weekday smallint not null,
  opens_at time not null,
  closes_at time not null,
  order_capacity integer,
  item_capacity integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_windows_schedule_fk
    foreign key (restaurant_id, location_id, schedule_version_id)
    references public.availability_schedule_versions (restaurant_id, location_id, id)
    on delete cascade,
  constraint availability_windows_fulfillment_allowed check (
    fulfillment_type in ('pickup', 'delivery')
  ),
  constraint availability_windows_weekday_range check (weekday between 0 and 6),
  constraint availability_windows_nonempty check (opens_at <> closes_at),
  constraint availability_windows_order_capacity_positive check (
    order_capacity is null or order_capacity > 0
  ),
  constraint availability_windows_item_capacity_positive check (
    item_capacity is null or item_capacity > 0
  ),
  constraint availability_windows_natural_unique unique (
    restaurant_id,
    location_id,
    schedule_version_id,
    fulfillment_type,
    weekday,
    opens_at
  )
);

create index availability_windows_lookup_idx
  on public.availability_windows (
    restaurant_id,
    location_id,
    schedule_version_id,
    fulfillment_type,
    weekday,
    opens_at
  );

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  schedule_version_id uuid not null,
  fulfillment_type text not null,
  local_date date not null,
  availability_status text not null,
  opens_at time,
  closes_at time,
  order_capacity integer,
  item_capacity integer,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_exceptions_schedule_fk
    foreign key (restaurant_id, location_id, schedule_version_id)
    references public.availability_schedule_versions (restaurant_id, location_id, id)
    on delete cascade,
  constraint availability_exceptions_fulfillment_allowed check (
    fulfillment_type in ('pickup', 'delivery')
  ),
  constraint availability_exceptions_status_allowed check (
    availability_status in ('closed', 'custom_hours')
  ),
  constraint availability_exceptions_hours_match_status check (
    (
      availability_status = 'closed'
      and opens_at is null
      and closes_at is null
    )
    or (
      availability_status = 'custom_hours'
      and opens_at is not null
      and closes_at is not null
      and opens_at < closes_at
    )
  ),
  constraint availability_exceptions_order_capacity_positive check (
    order_capacity is null or order_capacity > 0
  ),
  constraint availability_exceptions_item_capacity_positive check (
    item_capacity is null or item_capacity > 0
  ),
  constraint availability_exceptions_reason_not_blank check (
    reason is null or btrim(reason) <> ''
  ),
  constraint availability_exceptions_reason_length check (
    reason is null or char_length(reason) <= 300
  ),
  constraint availability_exceptions_natural_unique unique (
    restaurant_id,
    location_id,
    schedule_version_id,
    fulfillment_type,
    local_date
  )
);

create index availability_exceptions_lookup_idx
  on public.availability_exceptions (
    restaurant_id,
    location_id,
    schedule_version_id,
    fulfillment_type,
    local_date
  );

create table public.availability_publications (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  schedule_version_id uuid not null,
  effective_at timestamptz not null,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  authentication_assurance text not null,
  created_at timestamptz not null default now(),
  constraint availability_publications_schedule_fk
    foreign key (restaurant_id, location_id, schedule_version_id)
    references public.availability_schedule_versions (restaurant_id, location_id, id)
    on delete restrict,
  constraint availability_publications_aal2 check (authentication_assurance = 'aal2'),
  constraint availability_publications_effective_unique unique (
    restaurant_id,
    location_id,
    effective_at
  )
);

create index availability_publications_resolution_idx
  on public.availability_publications (
    restaurant_id,
    location_id,
    effective_at desc,
    created_at desc,
    id desc
  );

create table public.ordering_pause_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  restaurant_id uuid not null,
  location_id uuid not null,
  fulfillment_type text,
  event_kind text not null,
  pause_until timestamptz,
  reason text,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  authentication_assurance text not null,
  created_at timestamptz not null default now(),
  constraint ordering_pause_events_location_fk
    foreign key (restaurant_id, location_id)
    references public.locations (restaurant_id, id)
    on delete restrict,
  constraint ordering_pause_events_fulfillment_allowed check (
    fulfillment_type is null or fulfillment_type in ('pickup', 'delivery')
  ),
  constraint ordering_pause_events_kind_allowed check (event_kind in ('pause', 'resume')),
  constraint ordering_pause_events_until_matches_kind check (
    (event_kind = 'pause' and pause_until is not null)
    or (event_kind = 'resume' and pause_until is null)
  ),
  constraint ordering_pause_events_reason_not_blank check (
    reason is null or btrim(reason) <> ''
  ),
  constraint ordering_pause_events_reason_length check (
    reason is null or char_length(reason) <= 300
  ),
  constraint ordering_pause_events_aal2 check (authentication_assurance = 'aal2')
);

create index ordering_pause_events_resolution_idx
  on public.ordering_pause_events (
    restaurant_id,
    location_id,
    fulfillment_type,
    event_sequence desc
  );

create table public.ordering_capacity_claims (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  schedule_version_id uuid not null,
  fulfillment_type text not null,
  slot_start timestamptz not null,
  claim_key text not null,
  claim_kind text not null,
  order_count integer not null,
  item_count integer not null,
  related_claim_id uuid,
  created_at timestamptz not null default now(),
  constraint ordering_capacity_claims_schedule_fk
    foreign key (restaurant_id, location_id, schedule_version_id)
    references public.availability_schedule_versions (restaurant_id, location_id, id)
    on delete restrict,
  constraint ordering_capacity_claims_tenant_id_unique unique (
    restaurant_id,
    location_id,
    fulfillment_type,
    id
  ),
  constraint ordering_capacity_claims_fulfillment_allowed check (
    fulfillment_type in ('pickup', 'delivery')
  ),
  constraint ordering_capacity_claims_key_not_blank check (btrim(claim_key) <> ''),
  constraint ordering_capacity_claims_key_length check (char_length(claim_key) <= 128),
  constraint ordering_capacity_claims_kind_allowed check (
    claim_kind in ('reserve', 'release')
  ),
  constraint ordering_capacity_claims_counts_positive check (
    order_count > 0 and item_count > 0
  ),
  constraint ordering_capacity_claims_relation_matches_kind check (
    (claim_kind = 'reserve' and related_claim_id is null)
    or (claim_kind = 'release' and related_claim_id is not null)
  ),
  constraint ordering_capacity_claims_action_unique unique (
    restaurant_id,
    location_id,
    fulfillment_type,
    claim_key,
    claim_kind
  ),
  constraint ordering_capacity_claims_one_release unique (related_claim_id)
);

alter table public.ordering_capacity_claims
  add constraint ordering_capacity_claims_related_fk
  foreign key (restaurant_id, location_id, fulfillment_type, related_claim_id)
  references public.ordering_capacity_claims (
    restaurant_id,
    location_id,
    fulfillment_type,
    id
  )
  on delete restrict;

create index ordering_capacity_claims_usage_idx
  on public.ordering_capacity_claims (
    restaurant_id,
    location_id,
    schedule_version_id,
    fulfillment_type,
    slot_start,
    claim_kind
  );

create trigger availability_schedule_versions_set_updated_at
before update on public.availability_schedule_versions
for each row
execute function private.set_updated_at();

create trigger availability_windows_set_updated_at
before update on public.availability_windows
for each row
execute function private.set_updated_at();

create trigger availability_exceptions_set_updated_at
before update on public.availability_exceptions
for each row
execute function private.set_updated_at();

create function private.protect_availability_schedule_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'published' then
    raise exception using errcode = '23514', message = 'published availability schedules are immutable';
  end if;

  if new.id is distinct from old.id
    or new.restaurant_id is distinct from old.restaurant_id
    or new.location_id is distinct from old.location_id
    or new.version_number is distinct from old.version_number
    or new.source_version_id is distinct from old.source_version_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '23514', message = 'availability schedule identity is immutable';
  end if;

  return new;
end;
$$;

create trigger availability_schedule_versions_protect_identity
before update on public.availability_schedule_versions
for each row
execute function private.protect_availability_schedule_version();

create function private.assert_availability_content_mutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_status text;
  target_restaurant_id uuid;
  target_location_id uuid;
  target_schedule_version_id uuid;
begin
  if tg_op = 'DELETE' then
    target_restaurant_id := old.restaurant_id;
    target_location_id := old.location_id;
    target_schedule_version_id := old.schedule_version_id;
  else
    target_restaurant_id := new.restaurant_id;
    target_location_id := new.location_id;
    target_schedule_version_id := new.schedule_version_id;
  end if;

  select version.status
  into target_status
  from public.availability_schedule_versions as version
  where version.restaurant_id = target_restaurant_id
    and version.location_id = target_location_id
    and version.id = target_schedule_version_id;

  if target_status is distinct from 'draft' then
    raise exception using errcode = '23514', message = 'published availability schedule content is immutable';
  end if;

  if tg_op = 'UPDATE'
    and (
      new.id is distinct from old.id
      or new.restaurant_id is distinct from old.restaurant_id
      or new.location_id is distinct from old.location_id
      or new.schedule_version_id is distinct from old.schedule_version_id
      or new.created_at is distinct from old.created_at
    )
  then
    raise exception using errcode = '23514', message = 'availability content identity is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger availability_windows_require_draft
before insert or update or delete on public.availability_windows
for each row
execute function private.assert_availability_content_mutable();

create trigger availability_exceptions_require_draft
before insert or update or delete on public.availability_exceptions
for each row
execute function private.assert_availability_content_mutable();

create function private.prevent_ordering_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'ordering availability history is append-only';
end;
$$;

create trigger availability_publications_append_only
before update or delete on public.availability_publications
for each row
execute function private.prevent_ordering_history_mutation();

create trigger ordering_pause_events_append_only
before update or delete on public.ordering_pause_events
for each row
execute function private.prevent_ordering_history_mutation();

create trigger ordering_capacity_claims_append_only
before update or delete on public.ordering_capacity_claims
for each row
execute function private.prevent_ordering_history_mutation();

create function private.assert_availability_actor(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text;
begin
  if target_authentication_assurance <> 'aal2' then
    raise exception using errcode = 'P0001', message = 'availability administration requires aal2';
  end if;

  select membership.role
  into actor_role
  from public.restaurant_memberships as membership
  where membership.restaurant_id = target_restaurant_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active';

  if actor_role is null or actor_role not in ('owner', 'manager') then
    raise exception using
      errcode = 'P0001',
      message = 'availability actor must be an active owner or manager';
  end if;

  if actor_role = 'manager'
    and not exists (
      select 1
      from public.restaurant_membership_locations as assignment
      where assignment.restaurant_id = target_restaurant_id
        and assignment.user_id = target_actor_user_id
        and assignment.location_id = target_location_id
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'manager is not assigned to the availability location';
  end if;

  if not exists (
    select 1
    from public.locations as location
    where location.restaurant_id = target_restaurant_id
      and location.id = target_location_id
      and location.status <> 'suspended'
  ) then
    raise exception using errcode = 'P0001', message = 'availability location was not found';
  end if;
end;
$$;

create function private.create_availability_schedule_draft(
  target_restaurant_id uuid,
  target_location_id uuid,
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
  source_version public.availability_schedule_versions%rowtype;
begin
  perform private.assert_availability_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  perform pg_advisory_xact_lock(
    hashtextextended(target_restaurant_id::text || ':' || target_location_id::text, 0)
  );

  select coalesce(max(version.version_number), 0) + 1
  into created_version_number
  from public.availability_schedule_versions as version
  where version.restaurant_id = target_restaurant_id
    and version.location_id = target_location_id;

  if target_source_version_id is not null then
    select version.*
    into source_version
    from public.availability_schedule_versions as version
    where version.restaurant_id = target_restaurant_id
      and version.location_id = target_location_id
      and version.id = target_source_version_id
      and version.status = 'published';

    if source_version.id is null then
      raise exception using errcode = 'P0001', message = 'published availability source was not found';
    end if;
  end if;

  insert into public.availability_schedule_versions (
    id,
    restaurant_id,
    location_id,
    version_number,
    minimum_lead_minutes,
    maximum_advance_days,
    slot_interval_minutes,
    default_order_capacity,
    default_item_capacity,
    source_version_id,
    created_by_user_id
  )
  values (
    created_version_id,
    target_restaurant_id,
    target_location_id,
    created_version_number,
    coalesce(source_version.minimum_lead_minutes, 15),
    coalesce(source_version.maximum_advance_days, 14),
    coalesce(source_version.slot_interval_minutes, 15),
    case
      when target_source_version_id is null then 10
      else source_version.default_order_capacity
    end,
    case
      when target_source_version_id is null then 50
      else source_version.default_item_capacity
    end,
    target_source_version_id,
    target_actor_user_id
  );

  if target_source_version_id is not null then
    insert into public.availability_windows (
      restaurant_id,
      location_id,
      schedule_version_id,
      fulfillment_type,
      weekday,
      opens_at,
      closes_at,
      order_capacity,
      item_capacity
    )
    select
      source_window.restaurant_id,
      source_window.location_id,
      created_version_id,
      source_window.fulfillment_type,
      source_window.weekday,
      source_window.opens_at,
      source_window.closes_at,
      source_window.order_capacity,
      source_window.item_capacity
    from public.availability_windows as source_window
    where source_window.restaurant_id = target_restaurant_id
      and source_window.location_id = target_location_id
      and source_window.schedule_version_id = target_source_version_id;

    insert into public.availability_exceptions (
      restaurant_id,
      location_id,
      schedule_version_id,
      fulfillment_type,
      local_date,
      availability_status,
      opens_at,
      closes_at,
      order_capacity,
      item_capacity,
      reason
    )
    select
      source_exception.restaurant_id,
      source_exception.location_id,
      created_version_id,
      source_exception.fulfillment_type,
      source_exception.local_date,
      source_exception.availability_status,
      source_exception.opens_at,
      source_exception.closes_at,
      source_exception.order_capacity,
      source_exception.item_capacity,
      source_exception.reason
    from public.availability_exceptions as source_exception
    where source_exception.restaurant_id = target_restaurant_id
      and source_exception.location_id = target_location_id
      and source_exception.schedule_version_id = target_source_version_id;
  end if;

  return created_version_id;
end;
$$;

create function private.update_availability_schedule_draft(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_schedule_version_id uuid,
  target_minimum_lead_minutes integer,
  target_maximum_advance_days integer,
  target_slot_interval_minutes integer,
  target_default_order_capacity integer,
  target_default_item_capacity integer,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_availability_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  update public.availability_schedule_versions
  set
    minimum_lead_minutes = target_minimum_lead_minutes,
    maximum_advance_days = target_maximum_advance_days,
    slot_interval_minutes = target_slot_interval_minutes,
    default_order_capacity = target_default_order_capacity,
    default_item_capacity = target_default_item_capacity
  where restaurant_id = target_restaurant_id
    and location_id = target_location_id
    and id = target_schedule_version_id
    and status = 'draft';

  if not found then
    raise exception using errcode = 'P0001', message = 'draft availability schedule was not found';
  end if;
end;
$$;

create function private.publish_availability_schedule(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_schedule_version_id uuid,
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
  target_status text;
  target_timezone text;
begin
  perform private.assert_availability_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  if target_effective_at < now() - interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'availability publication cannot be backdated';
  end if;

  select version.status, location.timezone
  into target_status, target_timezone
  from public.availability_schedule_versions as version
  join public.locations as location
    on location.restaurant_id = version.restaurant_id
    and location.id = version.location_id
  where version.restaurant_id = target_restaurant_id
    and version.location_id = target_location_id
    and version.id = target_schedule_version_id
  for update of version;

  if target_status is null then
    raise exception using errcode = 'P0001', message = 'availability schedule was not found';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names as timezone
    where timezone.name = target_timezone
  ) then
    raise exception using errcode = 'P0001', message = 'location timezone is invalid';
  end if;

  if not exists (
    select 1
    from public.availability_windows as window
    where window.restaurant_id = target_restaurant_id
      and window.location_id = target_location_id
      and window.schedule_version_id = target_schedule_version_id
  ) then
    raise exception using errcode = 'P0001', message = 'availability schedule has no weekly windows';
  end if;

  if exists (
    with normalized_windows as (
      select
        window.id,
        window.fulfillment_type,
        window.weekday * 86400 + extract(epoch from window.opens_at) as starts_at_second,
        window.weekday * 86400 + extract(epoch from window.closes_at)
          + case when window.closes_at <= window.opens_at then 86400 else 0 end
          as ends_at_second
      from public.availability_windows as window
      where window.restaurant_id = target_restaurant_id
        and window.location_id = target_location_id
        and window.schedule_version_id = target_schedule_version_id
    )
    select 1
    from normalized_windows as first_window
    join normalized_windows as second_window
      on second_window.fulfillment_type = first_window.fulfillment_type
      and second_window.id > first_window.id
    cross join (values (-604800), (0), (604800)) as week_shift(seconds)
    where first_window.starts_at_second < second_window.ends_at_second + week_shift.seconds
      and second_window.starts_at_second + week_shift.seconds < first_window.ends_at_second
  ) then
    raise exception using errcode = 'P0001', message = 'availability schedule contains overlapping windows';
  end if;

  if target_status = 'draft' then
    update public.availability_schedule_versions
    set
      status = 'published',
      published_by_user_id = target_actor_user_id,
      published_at = now()
    where restaurant_id = target_restaurant_id
      and location_id = target_location_id
      and id = target_schedule_version_id;
  end if;

  insert into public.availability_publications (
    id,
    restaurant_id,
    location_id,
    schedule_version_id,
    effective_at,
    actor_user_id,
    authentication_assurance
  )
  values (
    publication_id,
    target_restaurant_id,
    target_location_id,
    target_schedule_version_id,
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
    'ordering_availability',
    target_location_id,
    case
      when target_effective_at > now() then 'ordering.availability.scheduled'
      else 'ordering.availability.published'
    end,
    jsonb_build_object(
      'publication_id', publication_id,
      'location_id', target_location_id,
      'schedule_version_id', target_schedule_version_id,
      'effective_at', target_effective_at
    ),
    'availability-publication:' || publication_id::text
  );

  return publication_id;
end;
$$;

create function private.set_ordering_pause(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_fulfillment_type text,
  target_pause_until timestamptz,
  target_reason text,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid := gen_random_uuid();
  event_kind text;
begin
  perform private.assert_availability_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  if target_fulfillment_type is not null
    and target_fulfillment_type not in ('pickup', 'delivery')
  then
    raise exception using errcode = 'P0001', message = 'fulfillment type is invalid';
  end if;

  if target_pause_until is not null and target_pause_until <= now() then
    raise exception using errcode = 'P0001', message = 'ordering pause must end in the future';
  end if;

  event_kind := case when target_pause_until is null then 'resume' else 'pause' end;

  insert into public.ordering_pause_events (
    id,
    restaurant_id,
    location_id,
    fulfillment_type,
    event_kind,
    pause_until,
    reason,
    actor_user_id,
    authentication_assurance
  )
  values (
    event_id,
    target_restaurant_id,
    target_location_id,
    target_fulfillment_type,
    event_kind,
    target_pause_until,
    nullif(btrim(target_reason), ''),
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
    'ordering_availability',
    target_location_id,
    case when event_kind = 'pause' then 'ordering.paused' else 'ordering.resumed' end,
    jsonb_build_object(
      'pause_event_id', event_id,
      'location_id', target_location_id,
      'fulfillment_type', target_fulfillment_type,
      'pause_until', target_pause_until
    ),
    'ordering-pause:' || event_id::text
  );

  return event_id;
end;
$$;

create function private.resolve_availability_schedule_version(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_at timestamptz default now()
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select publication.schedule_version_id
  from public.availability_publications as publication
  join public.availability_schedule_versions as version
    on version.restaurant_id = publication.restaurant_id
    and version.location_id = publication.location_id
    and version.id = publication.schedule_version_id
  where publication.restaurant_id = target_restaurant_id
    and publication.location_id = target_location_id
    and publication.effective_at <= target_at
    and version.status = 'published'
  order by publication.effective_at desc, publication.created_at desc, publication.id desc
  limit 1;
$$;

create function private.resolve_availability_window(
  target_schedule_version_id uuid,
  target_fulfillment_type text,
  target_local_timestamp timestamp
)
returns table (
  window_start_local timestamp,
  window_end_local timestamp,
  order_capacity integer,
  item_capacity integer,
  source_kind text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_date date := target_local_timestamp::date;
  target_time time := target_local_timestamp::time;
  schedule public.availability_schedule_versions%rowtype;
  exception_row public.availability_exceptions%rowtype;
begin
  select version.*
  into schedule
  from public.availability_schedule_versions as version
  where version.id = target_schedule_version_id
    and version.status = 'published';

  if schedule.id is null or target_fulfillment_type not in ('pickup', 'delivery') then
    return;
  end if;

  select exception.*
  into exception_row
  from public.availability_exceptions as exception
  where exception.restaurant_id = schedule.restaurant_id
    and exception.location_id = schedule.location_id
    and exception.schedule_version_id = schedule.id
    and exception.fulfillment_type = target_fulfillment_type
    and exception.local_date = target_date;

  if exception_row.id is not null then
    if exception_row.availability_status = 'closed'
      or target_time < exception_row.opens_at
      or target_time >= exception_row.closes_at
    then
      return;
    end if;

    return query
    select
      target_date + exception_row.opens_at,
      target_date + exception_row.closes_at,
      coalesce(exception_row.order_capacity, schedule.default_order_capacity),
      coalesce(exception_row.item_capacity, schedule.default_item_capacity),
      'exception'::text;
    return;
  end if;

  return query
  select
    case
      when window.opens_at < window.closes_at then target_date + window.opens_at
      when target_time >= window.opens_at then target_date + window.opens_at
      else (target_date - 1) + window.opens_at
    end,
    case
      when window.opens_at < window.closes_at then target_date + window.closes_at
      when target_time >= window.opens_at then (target_date + 1) + window.closes_at
      else target_date + window.closes_at
    end,
    coalesce(window.order_capacity, schedule.default_order_capacity),
    coalesce(window.item_capacity, schedule.default_item_capacity),
    'weekly'::text
  from public.availability_windows as window
  where window.restaurant_id = schedule.restaurant_id
    and window.location_id = schedule.location_id
    and window.schedule_version_id = schedule.id
    and window.fulfillment_type = target_fulfillment_type
    and (
      (
        window.opens_at < window.closes_at
        and window.weekday = extract(dow from target_date)::smallint
        and target_time >= window.opens_at
        and target_time < window.closes_at
      )
      or (
        window.opens_at > window.closes_at
        and (
          (
            window.weekday = extract(dow from target_date)::smallint
            and target_time >= window.opens_at
          )
          or (
            window.weekday = extract(dow from target_date - 1)::smallint
            and target_time < window.closes_at
          )
        )
      )
    )
  order by window.opens_at
  limit 1;
end;
$$;

create function private.resolve_ordering_availability(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_fulfillment_type text,
  target_requested_for timestamptz,
  target_requested_item_count integer default 1,
  target_evaluated_at timestamptz default now()
)
returns table (
  is_available boolean,
  reason_code text,
  schedule_version_id uuid,
  slot_start timestamptz,
  maximum_orders integer,
  maximum_items integer,
  reserved_orders integer,
  reserved_items integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  location_timezone text;
  resolved_schedule_id uuid;
  schedule public.availability_schedule_versions%rowtype;
  resolved_window record;
  local_requested_at timestamp;
  local_slot_start timestamp;
  resolved_slot_start timestamptz;
  latest_pause public.ordering_pause_events%rowtype;
  used_orders integer := 0;
  used_items integer := 0;
begin
  if target_fulfillment_type not in ('pickup', 'delivery') then
    return query select false, 'invalid_fulfillment'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if target_requested_item_count is null or target_requested_item_count <= 0 then
    return query select false, 'invalid_item_count'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  select location.timezone
  into location_timezone
  from public.locations as location
  where location.restaurant_id = target_restaurant_id
    and location.id = target_location_id
    and location.status = 'active';

  if location_timezone is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names as timezone
      where timezone.name = location_timezone
    )
  then
    return query select false, 'location_unavailable'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if not private.is_location_go_live(target_restaurant_id, target_location_id) then
    return query select false, 'go_live_closed'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if not private.is_restaurant_feature_enabled(target_restaurant_id, 'ordering.accept_orders') then
    return query select false, 'ordering_disabled'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if not private.is_restaurant_feature_enabled(
    target_restaurant_id,
    case
      when target_fulfillment_type = 'pickup' then 'fulfillment.pickup'
      else 'fulfillment.delivery'
    end
  ) then
    return query select false, 'fulfillment_disabled'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if not exists (
    select 1
    from public.menus as menu
    where menu.restaurant_id = target_restaurant_id
      and menu.status = 'active'
      and private.resolve_public_menu_version(
        target_restaurant_id,
        target_location_id,
        menu.id,
        target_evaluated_at
      ) is not null
  ) then
    return query select false, 'menu_unavailable'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  resolved_schedule_id := private.resolve_availability_schedule_version(
    target_restaurant_id,
    target_location_id,
    target_evaluated_at
  );

  if resolved_schedule_id is null then
    return query select false, 'schedule_unavailable'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  select version.*
  into schedule
  from public.availability_schedule_versions as version
  where version.id = resolved_schedule_id;

  if target_requested_for < target_evaluated_at + make_interval(mins => schedule.minimum_lead_minutes) then
    return query select false, 'lead_time'::text, resolved_schedule_id, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if target_requested_for > target_evaluated_at + make_interval(days => schedule.maximum_advance_days) then
    return query select false, 'advance_horizon'::text, resolved_schedule_id, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  select pause.*
  into latest_pause
  from public.ordering_pause_events as pause
  where pause.restaurant_id = target_restaurant_id
    and pause.location_id = target_location_id
    and (pause.fulfillment_type is null or pause.fulfillment_type = target_fulfillment_type)
    and pause.created_at <= target_evaluated_at
  order by pause.event_sequence desc
  limit 1;

  if latest_pause.event_kind = 'pause' and latest_pause.pause_until > target_evaluated_at then
    return query select false, 'manual_pause'::text, resolved_schedule_id, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  local_requested_at := target_requested_for at time zone location_timezone;

  select window.*
  into resolved_window
  from private.resolve_availability_window(
    resolved_schedule_id,
    target_fulfillment_type,
    local_requested_at
  ) as window;

  if resolved_window.window_start_local is null then
    return query select false, 'outside_window'::text, resolved_schedule_id, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  local_slot_start := resolved_window.window_start_local
    + make_interval(
      mins => (
        floor(
          extract(epoch from (local_requested_at - resolved_window.window_start_local))
          / 60
          / schedule.slot_interval_minutes
        )::integer * schedule.slot_interval_minutes
      )
    );
  resolved_slot_start := local_slot_start at time zone location_timezone;

  select
    coalesce(sum(case when claim.claim_kind = 'reserve' then claim.order_count else -claim.order_count end), 0)::integer,
    coalesce(sum(case when claim.claim_kind = 'reserve' then claim.item_count else -claim.item_count end), 0)::integer
  into used_orders, used_items
  from public.ordering_capacity_claims as claim
  where claim.restaurant_id = target_restaurant_id
    and claim.location_id = target_location_id
    and claim.schedule_version_id = resolved_schedule_id
    and claim.fulfillment_type = target_fulfillment_type
    and claim.slot_start = resolved_slot_start;

  if (
    resolved_window.order_capacity is not null
    and used_orders + 1 > resolved_window.order_capacity
  ) or (
    resolved_window.item_capacity is not null
    and used_items + target_requested_item_count > resolved_window.item_capacity
  ) then
    return query select false, 'capacity_exhausted'::text, resolved_schedule_id,
      resolved_slot_start, resolved_window.order_capacity, resolved_window.item_capacity,
      used_orders, used_items;
    return;
  end if;

  return query select true, 'available'::text, resolved_schedule_id,
    resolved_slot_start, resolved_window.order_capacity, resolved_window.item_capacity,
    used_orders, used_items;
end;
$$;

create function private.reserve_ordering_capacity(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_fulfillment_type text,
  target_requested_for timestamptz,
  target_requested_item_count integer,
  target_claim_key text,
  target_evaluated_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  availability record;
  existing_claim public.ordering_capacity_claims%rowtype;
  created_claim_id uuid := gen_random_uuid();
  normalized_claim_key text := btrim(target_claim_key);
begin
  if normalized_claim_key = '' or char_length(normalized_claim_key) > 128 then
    raise exception using errcode = 'P0001', message = 'capacity claim key is invalid';
  end if;

  select claim.*
  into existing_claim
  from public.ordering_capacity_claims as claim
  where claim.restaurant_id = target_restaurant_id
    and claim.location_id = target_location_id
    and claim.fulfillment_type = target_fulfillment_type
    and claim.claim_key = normalized_claim_key
    and claim.claim_kind = 'reserve';

  if existing_claim.id is not null then
    if existing_claim.item_count = target_requested_item_count then
      return true;
    end if;

    raise exception using errcode = 'P0001', message = 'capacity claim key was reused with different values';
  end if;

  select resolved.*
  into availability
  from private.resolve_ordering_availability(
    target_restaurant_id,
    target_location_id,
    target_fulfillment_type,
    target_requested_for,
    target_requested_item_count,
    target_evaluated_at
  ) as resolved;

  if not availability.is_available then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_restaurant_id::text || ':' || target_location_id::text || ':'
      || target_fulfillment_type || ':' || availability.slot_start::text,
      0
    )
  );

  select resolved.*
  into availability
  from private.resolve_ordering_availability(
    target_restaurant_id,
    target_location_id,
    target_fulfillment_type,
    target_requested_for,
    target_requested_item_count,
    target_evaluated_at
  ) as resolved;

  if not availability.is_available then
    return false;
  end if;

  insert into public.ordering_capacity_claims (
    id,
    restaurant_id,
    location_id,
    schedule_version_id,
    fulfillment_type,
    slot_start,
    claim_key,
    claim_kind,
    order_count,
    item_count
  )
  values (
    created_claim_id,
    target_restaurant_id,
    target_location_id,
    availability.schedule_version_id,
    target_fulfillment_type,
    availability.slot_start,
    normalized_claim_key,
    'reserve',
    1,
    target_requested_item_count
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
    'ordering_capacity',
    target_location_id,
    'ordering.capacity.reserved',
    jsonb_build_object(
      'claim_id', created_claim_id,
      'location_id', target_location_id,
      'fulfillment_type', target_fulfillment_type,
      'slot_start', availability.slot_start,
      'order_count', 1,
      'item_count', target_requested_item_count
    ),
    'ordering-capacity-reserve:' || created_claim_id::text
  );

  return true;
end;
$$;

create function private.release_ordering_capacity(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_fulfillment_type text,
  target_claim_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved_claim public.ordering_capacity_claims%rowtype;
  released_claim_id uuid := gen_random_uuid();
  normalized_claim_key text := btrim(target_claim_key);
begin
  select claim.*
  into reserved_claim
  from public.ordering_capacity_claims as claim
  where claim.restaurant_id = target_restaurant_id
    and claim.location_id = target_location_id
    and claim.fulfillment_type = target_fulfillment_type
    and claim.claim_key = normalized_claim_key
    and claim.claim_kind = 'reserve';

  if reserved_claim.id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_restaurant_id::text || ':' || target_location_id::text || ':'
      || target_fulfillment_type || ':' || reserved_claim.slot_start::text,
      0
    )
  );

  if exists (
    select 1
    from public.ordering_capacity_claims as claim
    where claim.related_claim_id = reserved_claim.id
      and claim.claim_kind = 'release'
  ) then
    return true;
  end if;

  insert into public.ordering_capacity_claims (
    id,
    restaurant_id,
    location_id,
    schedule_version_id,
    fulfillment_type,
    slot_start,
    claim_key,
    claim_kind,
    order_count,
    item_count,
    related_claim_id
  )
  values (
    released_claim_id,
    reserved_claim.restaurant_id,
    reserved_claim.location_id,
    reserved_claim.schedule_version_id,
    reserved_claim.fulfillment_type,
    reserved_claim.slot_start,
    reserved_claim.claim_key,
    'release',
    reserved_claim.order_count,
    reserved_claim.item_count,
    reserved_claim.id
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
    'ordering_capacity',
    target_location_id,
    'ordering.capacity.released',
    jsonb_build_object(
      'claim_id', released_claim_id,
      'reserved_claim_id', reserved_claim.id,
      'location_id', target_location_id,
      'fulfillment_type', target_fulfillment_type,
      'slot_start', reserved_claim.slot_start
    ),
    'ordering-capacity-release:' || reserved_claim.id::text
  );

  return true;
end;
$$;

alter table public.availability_schedule_versions enable row level security;
alter table public.availability_schedule_versions force row level security;
alter table public.availability_windows enable row level security;
alter table public.availability_windows force row level security;
alter table public.availability_exceptions enable row level security;
alter table public.availability_exceptions force row level security;
alter table public.availability_publications enable row level security;
alter table public.availability_publications force row level security;
alter table public.ordering_pause_events enable row level security;
alter table public.ordering_pause_events force row level security;
alter table public.ordering_capacity_claims enable row level security;
alter table public.ordering_capacity_claims force row level security;

create policy availability_schedule_versions_select_administrators
on public.availability_schedule_versions
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

create policy availability_windows_select_administrators
on public.availability_windows
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

create policy availability_exceptions_select_administrators
on public.availability_exceptions
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

create policy availability_publications_select_administrators
on public.availability_publications
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

create policy ordering_pause_events_select_administrators
on public.ordering_pause_events
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

create policy ordering_capacity_claims_select_administrators
on public.ordering_capacity_claims
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

revoke all on table public.availability_schedule_versions from public, anon, authenticated;
revoke all on table public.availability_windows from public, anon, authenticated;
revoke all on table public.availability_exceptions from public, anon, authenticated;
revoke all on table public.availability_publications from public, anon, authenticated;
revoke all on table public.ordering_pause_events from public, anon, authenticated;
revoke all on table public.ordering_capacity_claims from public, anon, authenticated;

grant select on table public.availability_schedule_versions to authenticated, service_role;
grant select on table public.availability_windows to authenticated, service_role;
grant select on table public.availability_exceptions to authenticated, service_role;
grant select on table public.availability_publications to authenticated, service_role;
grant select on table public.ordering_pause_events to authenticated, service_role;
grant select on table public.ordering_capacity_claims to authenticated, service_role;
grant insert, update, delete on table public.availability_windows to service_role;
grant insert, update, delete on table public.availability_exceptions to service_role;

revoke all on function private.protect_availability_schedule_version() from public;
revoke all on function private.assert_availability_content_mutable() from public;
revoke all on function private.prevent_ordering_history_mutation() from public;
revoke all on function private.assert_availability_actor(uuid, uuid, uuid, text) from public;
revoke all on function private.create_availability_schedule_draft(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function private.update_availability_schedule_draft(
  uuid,
  uuid,
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  text
) from public, anon, authenticated;
revoke all on function private.publish_availability_schedule(
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid,
  text
) from public, anon, authenticated;
revoke all on function private.set_ordering_pause(
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  uuid,
  text
) from public, anon, authenticated;
revoke all on function private.resolve_availability_schedule_version(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function private.resolve_availability_window(uuid, text, timestamp)
  from public, anon, authenticated;
revoke all on function private.resolve_ordering_availability(
  uuid,
  uuid,
  text,
  timestamptz,
  integer,
  timestamptz
) from public, anon, authenticated;
revoke all on function private.reserve_ordering_capacity(
  uuid,
  uuid,
  text,
  timestamptz,
  integer,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function private.release_ordering_capacity(uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function private.create_availability_schedule_draft(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function private.update_availability_schedule_draft(
  uuid,
  uuid,
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  text
) to service_role;
grant execute on function private.publish_availability_schedule(
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid,
  text
) to service_role;
grant execute on function private.set_ordering_pause(
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  uuid,
  text
) to service_role;
grant execute on function private.resolve_availability_schedule_version(uuid, uuid, timestamptz)
  to service_role;
grant execute on function private.resolve_availability_window(uuid, text, timestamp)
  to service_role;
grant execute on function private.resolve_ordering_availability(
  uuid,
  uuid,
  text,
  timestamptz,
  integer,
  timestamptz
) to service_role;
grant execute on function private.reserve_ordering_capacity(
  uuid,
  uuid,
  text,
  timestamptz,
  integer,
  text,
  timestamptz
) to service_role;
grant execute on function private.release_ordering_capacity(uuid, uuid, text, text)
  to service_role;

comment on table public.availability_schedule_versions is
  'Versioned ordering-time, lead-time and capacity settings for one restaurant location.';
comment on table public.availability_windows is
  'Draft-editable weekly pickup and delivery windows; overnight windows are supported.';
comment on table public.availability_exceptions is
  'Versioned full-day closures or replacement hours for one local calendar date.';
comment on table public.availability_publications is
  'Append-only effective timeline for published location availability schedules.';
comment on table public.ordering_pause_events is
  'Append-only operational pause and resume history, optionally scoped by fulfillment type.';
comment on table public.ordering_capacity_claims is
  'Append-only idempotent capacity reservations and releases serialized per location slot.';
comment on function private.resolve_ordering_availability(
  uuid,
  uuid,
  text,
  timestamptz,
  integer,
  timestamptz
) is
  'Fail-closed ordering decision combining go-live, features, menu, local windows, pauses and capacity.';
