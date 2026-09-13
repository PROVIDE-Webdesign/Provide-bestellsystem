create table public.onboarding_check_definitions (
  key text primary key,
  scope text not null,
  description text not null,
  required_for_go_live boolean not null default true,
  created_at timestamptz not null default now(),
  constraint onboarding_check_definitions_key_format check (
    key ~ '^(restaurant|location)\.[a-z][a-z0-9_]*$'
  ),
  constraint onboarding_check_definitions_scope_allowed check (
    scope in ('restaurant', 'location')
  ),
  constraint onboarding_check_definitions_key_scope_match check (
    split_part(key, '.', 1) = scope
  ),
  constraint onboarding_check_definitions_description_not_blank check (
    btrim(description) <> ''
  )
);

create table public.restaurant_activation_states (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  onboarding_status text not null default 'not_started',
  go_live_status text not null default 'blocked',
  approved_by_user_id uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  went_live_at timestamptz,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_activation_onboarding_status_allowed check (
    onboarding_status in ('not_started', 'in_progress', 'ready_for_review', 'approved')
  ),
  constraint restaurant_activation_go_live_status_allowed check (
    go_live_status in ('blocked', 'ready', 'live', 'paused')
  ),
  constraint restaurant_activation_approval_audit check (
    (
      onboarding_status = 'approved'
      and approved_by_user_id is not null
      and approved_at is not null
    )
    or (
      onboarding_status <> 'approved'
      and approved_by_user_id is null
      and approved_at is null
    )
  ),
  constraint restaurant_activation_go_live_requires_approval check (
    go_live_status = 'blocked' or onboarding_status = 'approved'
  ),
  constraint restaurant_activation_live_timestamp check (
    go_live_status not in ('live', 'paused') or went_live_at is not null
  ),
  constraint restaurant_activation_pause_timestamp check (
    (go_live_status = 'paused') = (paused_at is not null)
  )
);

create table public.location_activation_states (
  restaurant_id uuid not null,
  location_id uuid not null,
  onboarding_status text not null default 'not_started',
  go_live_status text not null default 'blocked',
  approved_by_user_id uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  went_live_at timestamptz,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, location_id),
  constraint location_activation_location_fk
    foreign key (restaurant_id, location_id)
    references public.locations (restaurant_id, id)
    on delete cascade,
  constraint location_activation_onboarding_status_allowed check (
    onboarding_status in ('not_started', 'in_progress', 'ready_for_review', 'approved')
  ),
  constraint location_activation_go_live_status_allowed check (
    go_live_status in ('blocked', 'ready', 'live', 'paused')
  ),
  constraint location_activation_approval_audit check (
    (
      onboarding_status = 'approved'
      and approved_by_user_id is not null
      and approved_at is not null
    )
    or (
      onboarding_status <> 'approved'
      and approved_by_user_id is null
      and approved_at is null
    )
  ),
  constraint location_activation_go_live_requires_approval check (
    go_live_status = 'blocked' or onboarding_status = 'approved'
  ),
  constraint location_activation_live_timestamp check (
    go_live_status not in ('live', 'paused') or went_live_at is not null
  ),
  constraint location_activation_pause_timestamp check (
    (go_live_status = 'paused') = (paused_at is not null)
  )
);

create index location_activation_states_status_idx
  on public.location_activation_states (
    restaurant_id,
    onboarding_status,
    go_live_status,
    location_id
  );

create table public.onboarding_check_results (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  location_id uuid,
  check_key text not null references public.onboarding_check_definitions (key) on delete restrict,
  scope text not null,
  status text not null default 'pending',
  checked_by_user_id uuid references auth.users (id) on delete set null,
  checked_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_check_results_location_fk
    foreign key (restaurant_id, location_id)
    references public.locations (restaurant_id, id)
    on delete cascade,
  constraint onboarding_check_results_scope_allowed check (
    scope in ('restaurant', 'location')
  ),
  constraint onboarding_check_results_location_scope check (
    (scope = 'restaurant' and location_id is null)
    or (scope = 'location' and location_id is not null)
  ),
  constraint onboarding_check_results_key_scope_match check (
    split_part(check_key, '.', 1) = scope
  ),
  constraint onboarding_check_results_status_allowed check (
    status in ('pending', 'passed', 'failed')
  ),
  constraint onboarding_check_results_audit check (
    (
      status = 'pending'
      and checked_by_user_id is null
      and checked_at is null
    )
    or (
      status in ('passed', 'failed')
      and checked_by_user_id is not null
      and checked_at is not null
    )
  ),
  constraint onboarding_check_results_note_not_blank check (
    note is null or btrim(note) <> ''
  ),
  constraint onboarding_check_results_note_length check (
    note is null or char_length(note) <= 500
  )
);

create unique index onboarding_check_results_restaurant_unique
  on public.onboarding_check_results (restaurant_id, check_key)
  where location_id is null;

create unique index onboarding_check_results_location_unique
  on public.onboarding_check_results (restaurant_id, location_id, check_key)
  where location_id is not null;

create index onboarding_check_results_status_idx
  on public.onboarding_check_results (restaurant_id, scope, status, check_key);

create table public.onboarding_transitions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete restrict,
  location_id uuid,
  transition_kind text not null,
  from_status text not null,
  to_status text not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  authentication_assurance text not null,
  created_at timestamptz not null default now(),
  constraint onboarding_transitions_location_fk
    foreign key (restaurant_id, location_id)
    references public.locations (restaurant_id, id)
    on delete restrict,
  constraint onboarding_transitions_kind_allowed check (
    transition_kind in ('restaurant_onboarding', 'restaurant_go_live', 'location_onboarding', 'location_go_live')
  ),
  constraint onboarding_transitions_location_kind check (
    (
      transition_kind in ('restaurant_onboarding', 'restaurant_go_live')
      and location_id is null
    )
    or (
      transition_kind in ('location_onboarding', 'location_go_live')
      and location_id is not null
    )
  ),
  constraint onboarding_transitions_status_changed check (from_status <> to_status),
  constraint onboarding_transitions_status_not_blank check (
    btrim(from_status) <> '' and btrim(to_status) <> ''
  ),
  constraint onboarding_transitions_aal2 check (authentication_assurance = 'aal2')
);

create index onboarding_transitions_restaurant_history_idx
  on public.onboarding_transitions (restaurant_id, created_at desc, id);

create index onboarding_transitions_location_history_idx
  on public.onboarding_transitions (restaurant_id, location_id, created_at desc, id)
  where location_id is not null;

insert into public.onboarding_check_definitions (key, scope, description)
values
  ('restaurant.profile', 'restaurant', 'Restaurant name, timezone and currency are valid.'),
  ('restaurant.owner', 'restaurant', 'At least one active owner is assigned.'),
  ('restaurant.legal', 'restaurant', 'Required legal and operator information was reviewed.'),
  ('restaurant.operations', 'restaurant', 'Restaurant operations were reviewed for launch.'),
  ('location.profile', 'location', 'Location name and timezone are valid.'),
  ('location.address', 'location', 'Location address is complete.'),
  ('location.fulfillment', 'location', 'Location fulfillment setup was reviewed.'),
  ('location.operations', 'location', 'Location operations were reviewed for launch.');

insert into public.restaurant_activation_states (restaurant_id)
select restaurant.id
from public.restaurants as restaurant;

insert into public.location_activation_states (restaurant_id, location_id)
select location.restaurant_id, location.id
from public.locations as location;

insert into public.onboarding_check_results (restaurant_id, check_key, scope)
select restaurant.id, definition.key, definition.scope
from public.restaurants as restaurant
cross join public.onboarding_check_definitions as definition
where definition.scope = 'restaurant';

insert into public.onboarding_check_results (restaurant_id, location_id, check_key, scope)
select location.restaurant_id, location.id, definition.key, definition.scope
from public.locations as location
cross join public.onboarding_check_definitions as definition
where definition.scope = 'location';

create trigger restaurant_activation_states_set_updated_at
before update on public.restaurant_activation_states
for each row
execute function private.set_updated_at();

create trigger location_activation_states_set_updated_at
before update on public.location_activation_states
for each row
execute function private.set_updated_at();

create trigger onboarding_check_results_set_updated_at
before update on public.onboarding_check_results
for each row
execute function private.set_updated_at();

create function private.initialize_restaurant_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.restaurant_activation_states (restaurant_id)
  values (new.id);

  insert into public.onboarding_check_results (restaurant_id, check_key, scope)
  select new.id, definition.key, definition.scope
  from public.onboarding_check_definitions as definition
  where definition.scope = 'restaurant';

  return new;
end;
$$;

create trigger restaurants_initialize_activation
after insert on public.restaurants
for each row
execute function private.initialize_restaurant_activation();

create function private.initialize_location_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.location_activation_states (restaurant_id, location_id)
  values (new.restaurant_id, new.id);

  insert into public.onboarding_check_results (restaurant_id, location_id, check_key, scope)
  select new.restaurant_id, new.id, definition.key, definition.scope
  from public.onboarding_check_definitions as definition
  where definition.scope = 'location';

  return new;
end;
$$;

create trigger locations_initialize_activation
after insert on public.locations
for each row
execute function private.initialize_location_activation();

create function private.prevent_activation_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.restaurant_id is distinct from old.restaurant_id then
    raise exception using errcode = '23514', message = 'activation restaurant identity is immutable';
  end if;

  if tg_table_name = 'location_activation_states'
    and (to_jsonb(new) ->> 'location_id') is distinct from (to_jsonb(old) ->> 'location_id')
  then
    raise exception using errcode = '23514', message = 'activation location identity is immutable';
  end if;

  return new;
end;
$$;

create trigger restaurant_activation_states_protect_identity
before update on public.restaurant_activation_states
for each row
execute function private.prevent_activation_identity_change();

create trigger location_activation_states_protect_identity
before update on public.location_activation_states
for each row
execute function private.prevent_activation_identity_change();

create function private.prevent_onboarding_check_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.restaurant_id is distinct from old.restaurant_id
    or new.location_id is distinct from old.location_id
    or new.check_key is distinct from old.check_key
    or new.scope is distinct from old.scope
    or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '23514', message = 'onboarding check identity is immutable';
  end if;

  return new;
end;
$$;

create trigger onboarding_check_results_protect_identity
before update on public.onboarding_check_results
for each row
execute function private.prevent_onboarding_check_identity_change();

create function private.assert_onboarding_actor(
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
    raise exception using errcode = 'P0001', message = 'onboarding administration requires aal2';
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
      message = 'onboarding actor must be an active owner or manager';
  end if;

  if actor_role = 'manager'
    and target_location_id is not null
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
      message = 'manager is not assigned to the onboarding location';
  end if;
end;
$$;

create function private.restaurant_checks_passed(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.onboarding_check_definitions as definition
    left join public.onboarding_check_results as result
      on result.restaurant_id = target_restaurant_id
      and result.location_id is null
      and result.check_key = definition.key
    where definition.scope = 'restaurant'
      and definition.required_for_go_live
      and coalesce(result.status, 'pending') <> 'passed'
  );
$$;

create function private.location_checks_passed(
  target_restaurant_id uuid,
  target_location_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.onboarding_check_definitions as definition
    left join public.onboarding_check_results as result
      on result.restaurant_id = target_restaurant_id
      and result.location_id = target_location_id
      and result.check_key = definition.key
    where definition.scope = 'location'
      and definition.required_for_go_live
      and coalesce(result.status, 'pending') <> 'passed'
  );
$$;

create function private.location_profile_is_complete(
  target_restaurant_id uuid,
  target_location_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.locations as location
    where location.restaurant_id = target_restaurant_id
      and location.id = target_location_id
      and location.status = 'active'
      and nullif(btrim(location.address_line_1), '') is not null
      and nullif(btrim(location.postal_code), '') is not null
      and nullif(btrim(location.city), '') is not null
      and location.country_code ~ '^[A-Z]{2}$'
  );
$$;

create function private.location_go_live_requirements_met(
  target_restaurant_id uuid,
  target_location_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.restaurants as restaurant
      join public.restaurant_activation_states as activation
        on activation.restaurant_id = restaurant.id
      where restaurant.id = target_restaurant_id
        and restaurant.status = 'active'
        and activation.onboarding_status = 'approved'
    )
    and exists (
      select 1
      from public.location_activation_states as activation
      where activation.restaurant_id = target_restaurant_id
        and activation.location_id = target_location_id
        and activation.onboarding_status = 'approved'
    )
    and exists (
      select 1
      from public.restaurant_memberships as membership
      where membership.restaurant_id = target_restaurant_id
        and membership.role = 'owner'
        and membership.status = 'active'
    )
    and private.restaurant_checks_passed(target_restaurant_id)
    and private.location_checks_passed(target_restaurant_id, target_location_id)
    and private.location_profile_is_complete(target_restaurant_id, target_location_id);
$$;

create function private.restaurant_go_live_requirements_met(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.restaurants as restaurant
      join public.restaurant_activation_states as activation
        on activation.restaurant_id = restaurant.id
      where restaurant.id = target_restaurant_id
        and restaurant.status = 'active'
        and activation.onboarding_status = 'approved'
    )
    and exists (
      select 1
      from public.restaurant_memberships as membership
      where membership.restaurant_id = target_restaurant_id
        and membership.role = 'owner'
        and membership.status = 'active'
    )
    and private.restaurant_checks_passed(target_restaurant_id)
    and exists (
      select 1
      from public.location_activation_states as location_activation
      where location_activation.restaurant_id = target_restaurant_id
        and location_activation.onboarding_status = 'approved'
        and location_activation.go_live_status in ('ready', 'live')
        and private.location_go_live_requirements_met(
          location_activation.restaurant_id,
          location_activation.location_id
        )
    );
$$;

create function private.record_onboarding_transition(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_transition_kind text,
  target_from_status text,
  target_to_status text,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  transition_id uuid := gen_random_uuid();
begin
  insert into public.onboarding_transitions (
    id,
    restaurant_id,
    location_id,
    transition_kind,
    from_status,
    to_status,
    actor_user_id,
    authentication_assurance
  )
  values (
    transition_id,
    target_restaurant_id,
    target_location_id,
    target_transition_kind,
    target_from_status,
    target_to_status,
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
    target_transition_kind,
    coalesce(target_location_id, target_restaurant_id),
    replace(target_transition_kind, '_', '.') || '.status_changed',
    jsonb_build_object(
      'transition_id', transition_id,
      'location_id', target_location_id,
      'from_status', target_from_status,
      'to_status', target_to_status,
      'actor_user_id', target_actor_user_id
    ),
    'onboarding-transition:' || transition_id::text
  );
end;
$$;

create function private.update_onboarding_check(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_check_key text,
  target_status text,
  target_actor_user_id uuid,
  target_authentication_assurance text,
  target_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  definition_scope text;
  current_onboarding_status text;
begin
  perform private.assert_onboarding_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  if target_status not in ('pending', 'passed', 'failed') then
    raise exception using errcode = 'P0001', message = 'onboarding check status is invalid';
  end if;

  select definition.scope
  into definition_scope
  from public.onboarding_check_definitions as definition
  where definition.key = target_check_key;

  if definition_scope is null then
    raise exception using errcode = 'P0001', message = 'onboarding check is unknown';
  end if;

  if (definition_scope = 'restaurant' and target_location_id is not null)
    or (definition_scope = 'location' and target_location_id is null)
  then
    raise exception using errcode = 'P0001', message = 'onboarding check scope does not match';
  end if;

  if definition_scope = 'restaurant' then
    select activation.onboarding_status
    into current_onboarding_status
    from public.restaurant_activation_states as activation
    where activation.restaurant_id = target_restaurant_id
    for update;
  else
    select activation.onboarding_status
    into current_onboarding_status
    from public.location_activation_states as activation
    where activation.restaurant_id = target_restaurant_id
      and activation.location_id = target_location_id
    for update;
  end if;

  if current_onboarding_status is null then
    raise exception using errcode = 'P0001', message = 'onboarding state was not found';
  end if;

  if current_onboarding_status = 'approved' then
    raise exception using errcode = 'P0001', message = 'approved onboarding checks are immutable';
  end if;

  if target_status = 'passed' and target_check_key = 'restaurant.owner'
    and not exists (
      select 1
      from public.restaurant_memberships as membership
      where membership.restaurant_id = target_restaurant_id
        and membership.role = 'owner'
        and membership.status = 'active'
    )
  then
    raise exception using errcode = 'P0001', message = 'restaurant owner check is not satisfied';
  end if;

  if target_status = 'passed' and target_check_key = 'location.address'
    and not private.location_profile_is_complete(target_restaurant_id, target_location_id)
  then
    raise exception using errcode = 'P0001', message = 'location address check is not satisfied';
  end if;

  update public.onboarding_check_results
  set
    status = target_status,
    checked_by_user_id = case when target_status = 'pending' then null else target_actor_user_id end,
    checked_at = case when target_status = 'pending' then null else now() end,
    note = nullif(btrim(target_note), '')
  where restaurant_id = target_restaurant_id
    and location_id is not distinct from target_location_id
    and check_key = target_check_key;

  if not found then
    raise exception using errcode = 'P0001', message = 'onboarding check result was not found';
  end if;
end;
$$;

create function private.transition_restaurant_onboarding(
  target_restaurant_id uuid,
  target_status text,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  perform private.assert_onboarding_actor(
    target_restaurant_id,
    null,
    target_actor_user_id,
    target_authentication_assurance
  );

  select activation.onboarding_status
  into current_status
  from public.restaurant_activation_states as activation
  where activation.restaurant_id = target_restaurant_id
  for update;

  if current_status is null then
    raise exception using errcode = 'P0001', message = 'restaurant onboarding state was not found';
  end if;

  if not (
    (current_status = 'not_started' and target_status = 'in_progress')
    or (current_status = 'in_progress' and target_status = 'ready_for_review')
    or (current_status = 'ready_for_review' and target_status = 'approved')
  ) then
    raise exception using errcode = 'P0001', message = 'restaurant onboarding transition is invalid';
  end if;

  if target_status in ('ready_for_review', 'approved')
    and not private.restaurant_checks_passed(target_restaurant_id)
  then
    raise exception using errcode = 'P0001', message = 'restaurant onboarding checks are incomplete';
  end if;

  update public.restaurant_activation_states
  set
    onboarding_status = target_status,
    approved_by_user_id = case when target_status = 'approved' then target_actor_user_id else null end,
    approved_at = case when target_status = 'approved' then now() else null end
  where restaurant_id = target_restaurant_id;

  perform private.record_onboarding_transition(
    target_restaurant_id,
    null,
    'restaurant_onboarding',
    current_status,
    target_status,
    target_actor_user_id,
    target_authentication_assurance
  );
end;
$$;

create function private.transition_location_onboarding(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_status text,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  perform private.assert_onboarding_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  select activation.onboarding_status
  into current_status
  from public.location_activation_states as activation
  where activation.restaurant_id = target_restaurant_id
    and activation.location_id = target_location_id
  for update;

  if current_status is null then
    raise exception using errcode = 'P0001', message = 'location onboarding state was not found';
  end if;

  if not (
    (current_status = 'not_started' and target_status = 'in_progress')
    or (current_status = 'in_progress' and target_status = 'ready_for_review')
    or (current_status = 'ready_for_review' and target_status = 'approved')
  ) then
    raise exception using errcode = 'P0001', message = 'location onboarding transition is invalid';
  end if;

  if target_status in ('ready_for_review', 'approved')
    and (
      not private.location_checks_passed(target_restaurant_id, target_location_id)
      or not private.location_profile_is_complete(target_restaurant_id, target_location_id)
    )
  then
    raise exception using errcode = 'P0001', message = 'location onboarding checks are incomplete';
  end if;

  update public.location_activation_states
  set
    onboarding_status = target_status,
    approved_by_user_id = case when target_status = 'approved' then target_actor_user_id else null end,
    approved_at = case when target_status = 'approved' then now() else null end
  where restaurant_id = target_restaurant_id
    and location_id = target_location_id;

  perform private.record_onboarding_transition(
    target_restaurant_id,
    target_location_id,
    'location_onboarding',
    current_status,
    target_status,
    target_actor_user_id,
    target_authentication_assurance
  );
end;
$$;

create function private.transition_location_go_live(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_status text,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  perform private.assert_onboarding_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  select activation.go_live_status
  into current_status
  from public.location_activation_states as activation
  where activation.restaurant_id = target_restaurant_id
    and activation.location_id = target_location_id
  for update;

  if current_status is null then
    raise exception using errcode = 'P0001', message = 'location go-live state was not found';
  end if;

  if not (
    (current_status = 'blocked' and target_status = 'ready')
    or (current_status = 'ready' and target_status = 'live')
    or (current_status = 'live' and target_status = 'paused')
    or (current_status = 'paused' and target_status = 'ready')
  ) then
    raise exception using errcode = 'P0001', message = 'location go-live transition is invalid';
  end if;

  if target_status in ('ready', 'live')
    and not private.location_go_live_requirements_met(target_restaurant_id, target_location_id)
  then
    raise exception using errcode = 'P0001', message = 'location go-live requirements are not met';
  end if;

  if target_status = 'live'
    and not exists (
      select 1
      from public.restaurant_activation_states as activation
      where activation.restaurant_id = target_restaurant_id
        and activation.go_live_status = 'live'
    )
  then
    raise exception using errcode = 'P0001', message = 'restaurant must be live before its location';
  end if;

  update public.location_activation_states
  set
    go_live_status = target_status,
    went_live_at = case
      when target_status = 'live' then coalesce(went_live_at, now())
      else went_live_at
    end,
    paused_at = case when target_status = 'paused' then now() else null end
  where restaurant_id = target_restaurant_id
    and location_id = target_location_id;

  perform private.record_onboarding_transition(
    target_restaurant_id,
    target_location_id,
    'location_go_live',
    current_status,
    target_status,
    target_actor_user_id,
    target_authentication_assurance
  );
end;
$$;

create function private.transition_restaurant_go_live(
  target_restaurant_id uuid,
  target_status text,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  perform private.assert_onboarding_actor(
    target_restaurant_id,
    null,
    target_actor_user_id,
    target_authentication_assurance
  );

  select activation.go_live_status
  into current_status
  from public.restaurant_activation_states as activation
  where activation.restaurant_id = target_restaurant_id
  for update;

  if current_status is null then
    raise exception using errcode = 'P0001', message = 'restaurant go-live state was not found';
  end if;

  if not (
    (current_status = 'blocked' and target_status = 'ready')
    or (current_status = 'ready' and target_status = 'live')
    or (current_status = 'live' and target_status = 'paused')
    or (current_status = 'paused' and target_status = 'ready')
  ) then
    raise exception using errcode = 'P0001', message = 'restaurant go-live transition is invalid';
  end if;

  if target_status in ('ready', 'live')
    and not private.restaurant_go_live_requirements_met(target_restaurant_id)
  then
    raise exception using errcode = 'P0001', message = 'restaurant go-live requirements are not met';
  end if;

  update public.restaurant_activation_states
  set
    go_live_status = target_status,
    went_live_at = case
      when target_status = 'live' then coalesce(went_live_at, now())
      else went_live_at
    end,
    paused_at = case when target_status = 'paused' then now() else null end
  where restaurant_id = target_restaurant_id;

  perform private.record_onboarding_transition(
    target_restaurant_id,
    null,
    'restaurant_go_live',
    current_status,
    target_status,
    target_actor_user_id,
    target_authentication_assurance
  );
end;
$$;

create function private.is_restaurant_go_live(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.restaurant_activation_states as activation
      where activation.restaurant_id = target_restaurant_id
        and activation.go_live_status = 'live'
    )
    and private.restaurant_go_live_requirements_met(target_restaurant_id);
$$;

create function private.is_location_go_live(
  target_restaurant_id uuid,
  target_location_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_restaurant_go_live(target_restaurant_id)
    and exists (
      select 1
      from public.location_activation_states as activation
      where activation.restaurant_id = target_restaurant_id
        and activation.location_id = target_location_id
        and activation.go_live_status = 'live'
    )
    and private.location_go_live_requirements_met(target_restaurant_id, target_location_id);
$$;

alter table public.onboarding_check_definitions enable row level security;
alter table public.onboarding_check_definitions force row level security;
alter table public.restaurant_activation_states enable row level security;
alter table public.restaurant_activation_states force row level security;
alter table public.location_activation_states enable row level security;
alter table public.location_activation_states force row level security;
alter table public.onboarding_check_results enable row level security;
alter table public.onboarding_check_results force row level security;
alter table public.onboarding_transitions enable row level security;
alter table public.onboarding_transitions force row level security;

create policy restaurant_activation_states_select_administrators
on public.restaurant_activation_states
for select
to authenticated
using (private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[]));

create policy location_activation_states_select_administrators
on public.location_activation_states
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

create policy onboarding_check_results_select_administrators
on public.onboarding_check_results
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and (
    scope = 'restaurant'
    or private.can_access_location(restaurant_id, location_id)
  )
);

create policy onboarding_transitions_select_administrators
on public.onboarding_transitions
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and (
    location_id is null
    or private.can_access_location(restaurant_id, location_id)
  )
);

revoke all on table public.onboarding_check_definitions from public, anon, authenticated;
revoke all on table public.restaurant_activation_states from public, anon, authenticated;
revoke all on table public.location_activation_states from public, anon, authenticated;
revoke all on table public.onboarding_check_results from public, anon, authenticated;
revoke all on table public.onboarding_transitions from public, anon, authenticated;

grant select on table public.restaurant_activation_states to authenticated;
grant select on table public.location_activation_states to authenticated;
grant select on table public.onboarding_check_results to authenticated;
grant select on table public.onboarding_transitions to authenticated;

grant select on table public.onboarding_check_definitions to service_role;
grant select on table public.restaurant_activation_states to service_role;
grant select on table public.location_activation_states to service_role;
grant select on table public.onboarding_check_results to service_role;
grant select on table public.onboarding_transitions to service_role;

revoke all on function private.initialize_restaurant_activation() from public;
revoke all on function private.initialize_location_activation() from public;
revoke all on function private.prevent_activation_identity_change() from public;
revoke all on function private.prevent_onboarding_check_identity_change() from public;
revoke all on function private.assert_onboarding_actor(uuid, uuid, uuid, text) from public;
revoke all on function private.restaurant_checks_passed(uuid) from public;
revoke all on function private.location_checks_passed(uuid, uuid) from public;
revoke all on function private.location_profile_is_complete(uuid, uuid) from public;
revoke all on function private.location_go_live_requirements_met(uuid, uuid) from public;
revoke all on function private.restaurant_go_live_requirements_met(uuid) from public;
revoke all on function private.record_onboarding_transition(uuid, uuid, text, text, text, uuid, text)
  from public;
revoke all on function private.update_onboarding_check(uuid, uuid, text, text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function private.transition_restaurant_onboarding(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function private.transition_location_onboarding(uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function private.transition_restaurant_go_live(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function private.transition_location_go_live(uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function private.is_restaurant_go_live(uuid) from public, anon, authenticated;
revoke all on function private.is_location_go_live(uuid, uuid) from public, anon, authenticated;

grant execute on function private.update_onboarding_check(uuid, uuid, text, text, uuid, text, text)
  to service_role;
grant execute on function private.transition_restaurant_onboarding(uuid, text, uuid, text)
  to service_role;
grant execute on function private.transition_location_onboarding(uuid, uuid, text, uuid, text)
  to service_role;
grant execute on function private.transition_restaurant_go_live(uuid, text, uuid, text)
  to service_role;
grant execute on function private.transition_location_go_live(uuid, uuid, text, uuid, text)
  to service_role;
grant execute on function private.is_restaurant_go_live(uuid) to service_role;
grant execute on function private.is_location_go_live(uuid, uuid) to service_role;

comment on table public.restaurant_activation_states is
  'Restaurant onboarding and customer-facing go-live state, separate from operational status.';
comment on table public.location_activation_states is
  'Location onboarding and customer-facing go-live state within an immutable tenant boundary.';
comment on table public.onboarding_check_results is
  'Server-managed launch checklist results. Notes must never contain secrets or unnecessary personal data.';
comment on table public.onboarding_transitions is
  'Append-only audit history for assurance-protected onboarding and go-live transitions.';
comment on function private.is_restaurant_go_live(uuid) is
  'Fail-closed restaurant launch gate. Feature flags remain an additional independent requirement.';
comment on function private.is_location_go_live(uuid, uuid) is
  'Fail-closed location launch gate requiring both restaurant and location readiness.';
