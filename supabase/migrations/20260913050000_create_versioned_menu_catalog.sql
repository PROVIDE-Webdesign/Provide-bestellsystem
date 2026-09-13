insert into public.feature_definitions (key, description)
values ('catalog.public_menu', 'Allow a live location to expose its published menu.');

create table public.menus (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete restrict,
  slug text not null,
  display_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menus_restaurant_id_id_unique unique (restaurant_id, id),
  constraint menus_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint menus_slug_length check (char_length(slug) between 2 and 63),
  constraint menus_display_name_not_blank check (btrim(display_name) <> ''),
  constraint menus_status_allowed check (status in ('active', 'archived')),
  constraint menus_restaurant_slug_unique unique (restaurant_id, slug)
);

create table public.menu_versions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  menu_id uuid not null,
  version_number integer not null,
  status text not null default 'draft',
  currency_code text not null,
  source_version_id uuid,
  created_by_user_id uuid not null references auth.users (id) on delete restrict,
  published_by_user_id uuid references auth.users (id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_versions_menu_fk
    foreign key (restaurant_id, menu_id)
    references public.menus (restaurant_id, id)
    on delete restrict,
  constraint menu_versions_restaurant_menu_id_unique
    unique (restaurant_id, menu_id, id),
  constraint menu_versions_restaurant_menu_number_unique
    unique (restaurant_id, menu_id, version_number),
  constraint menu_versions_number_positive check (version_number > 0),
  constraint menu_versions_status_allowed check (status in ('draft', 'published')),
  constraint menu_versions_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint menu_versions_publication_audit check (
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

alter table public.menu_versions
  add constraint menu_versions_source_fk
  foreign key (restaurant_id, menu_id, source_version_id)
  references public.menu_versions (restaurant_id, menu_id, id)
  on delete restrict;

create index menu_versions_status_idx
  on public.menu_versions (restaurant_id, menu_id, status, version_number desc);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  menu_id uuid not null,
  slug text not null,
  created_at timestamptz not null default now(),
  constraint menu_items_menu_fk
    foreign key (restaurant_id, menu_id)
    references public.menus (restaurant_id, id)
    on delete restrict,
  constraint menu_items_restaurant_menu_id_unique
    unique (restaurant_id, menu_id, id),
  constraint menu_items_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint menu_items_slug_length check (char_length(slug) between 2 and 80),
  constraint menu_items_restaurant_menu_slug_unique unique (restaurant_id, menu_id, slug)
);

create table public.menu_version_sections (
  restaurant_id uuid not null,
  menu_id uuid not null,
  menu_version_id uuid not null,
  section_key text not null,
  display_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, menu_id, menu_version_id, section_key),
  constraint menu_version_sections_version_fk
    foreign key (restaurant_id, menu_id, menu_version_id)
    references public.menu_versions (restaurant_id, menu_id, id)
    on delete cascade,
  constraint menu_version_sections_key_format check (
    section_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint menu_version_sections_key_length check (char_length(section_key) between 2 and 80),
  constraint menu_version_sections_display_name_not_blank check (btrim(display_name) <> ''),
  constraint menu_version_sections_sort_order_nonnegative check (sort_order >= 0)
);

create table public.menu_version_items (
  restaurant_id uuid not null,
  menu_id uuid not null,
  menu_version_id uuid not null,
  menu_item_id uuid not null,
  section_key text not null,
  display_name text not null,
  description text,
  price_amount_minor bigint not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, menu_id, menu_version_id, menu_item_id),
  constraint menu_version_items_version_fk
    foreign key (restaurant_id, menu_id, menu_version_id)
    references public.menu_versions (restaurant_id, menu_id, id)
    on delete cascade,
  constraint menu_version_items_item_fk
    foreign key (restaurant_id, menu_id, menu_item_id)
    references public.menu_items (restaurant_id, menu_id, id)
    on delete restrict,
  constraint menu_version_items_section_fk
    foreign key (restaurant_id, menu_id, menu_version_id, section_key)
    references public.menu_version_sections (
      restaurant_id,
      menu_id,
      menu_version_id,
      section_key
    )
    on delete restrict,
  constraint menu_version_items_display_name_not_blank check (btrim(display_name) <> ''),
  constraint menu_version_items_description_not_blank check (
    description is null or btrim(description) <> ''
  ),
  constraint menu_version_items_description_length check (
    description is null or char_length(description) <= 1000
  ),
  constraint menu_version_items_price_range check (
    price_amount_minor between 0 and 1000000000
  ),
  constraint menu_version_items_sort_order_nonnegative check (sort_order >= 0)
);

create index menu_version_items_display_idx
  on public.menu_version_items (
    restaurant_id,
    menu_id,
    menu_version_id,
    section_key,
    sort_order,
    menu_item_id
  )
  where is_active;

create table public.menu_item_location_availability (
  restaurant_id uuid not null,
  location_id uuid not null,
  menu_id uuid not null,
  menu_item_id uuid not null,
  status text not null default 'available',
  updated_by_user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, location_id, menu_item_id),
  constraint menu_item_location_availability_location_fk
    foreign key (restaurant_id, location_id)
    references public.locations (restaurant_id, id)
    on delete cascade,
  constraint menu_item_location_availability_item_fk
    foreign key (restaurant_id, menu_id, menu_item_id)
    references public.menu_items (restaurant_id, menu_id, id)
    on delete cascade,
  constraint menu_item_location_availability_status_allowed check (
    status in ('available', 'sold_out', 'unavailable')
  )
);

create index menu_item_location_availability_status_idx
  on public.menu_item_location_availability (restaurant_id, location_id, status, menu_item_id);

create table public.menu_publications (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  menu_id uuid not null,
  menu_version_id uuid not null,
  publication_kind text not null,
  effective_at timestamptz not null,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  authentication_assurance text not null,
  created_at timestamptz not null default now(),
  constraint menu_publications_location_fk
    foreign key (restaurant_id, location_id)
    references public.locations (restaurant_id, id)
    on delete restrict,
  constraint menu_publications_version_fk
    foreign key (restaurant_id, menu_id, menu_version_id)
    references public.menu_versions (restaurant_id, menu_id, id)
    on delete restrict,
  constraint menu_publications_kind_allowed check (
    publication_kind in ('publish', 'rollback')
  ),
  constraint menu_publications_aal2 check (authentication_assurance = 'aal2'),
  constraint menu_publications_effective_unique
    unique (restaurant_id, location_id, menu_id, effective_at)
);

create index menu_publications_resolution_idx
  on public.menu_publications (
    restaurant_id,
    location_id,
    menu_id,
    effective_at desc,
    created_at desc,
    id desc
  );

create table public.menu_item_availability_transitions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  menu_id uuid not null,
  menu_item_id uuid not null,
  from_status text,
  to_status text not null,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  authentication_assurance text not null,
  created_at timestamptz not null default now(),
  constraint menu_item_availability_transitions_location_fk
    foreign key (restaurant_id, location_id)
    references public.locations (restaurant_id, id)
    on delete restrict,
  constraint menu_item_availability_transitions_item_fk
    foreign key (restaurant_id, menu_id, menu_item_id)
    references public.menu_items (restaurant_id, menu_id, id)
    on delete restrict,
  constraint menu_item_availability_transitions_from_allowed check (
    from_status is null or from_status in ('available', 'sold_out', 'unavailable')
  ),
  constraint menu_item_availability_transitions_to_allowed check (
    to_status in ('available', 'sold_out', 'unavailable')
  ),
  constraint menu_item_availability_transitions_changed check (
    from_status is null or from_status <> to_status
  ),
  constraint menu_item_availability_transitions_aal2 check (
    authentication_assurance = 'aal2'
  )
);

create index menu_item_availability_transitions_history_idx
  on public.menu_item_availability_transitions (
    restaurant_id,
    location_id,
    menu_item_id,
    created_at desc,
    id desc
  );

create trigger menus_set_updated_at
before update on public.menus
for each row
execute function private.set_updated_at();

create trigger menu_versions_set_updated_at
before update on public.menu_versions
for each row
execute function private.set_updated_at();

create trigger menu_version_sections_set_updated_at
before update on public.menu_version_sections
for each row
execute function private.set_updated_at();

create trigger menu_version_items_set_updated_at
before update on public.menu_version_items
for each row
execute function private.set_updated_at();

create trigger menu_item_location_availability_set_updated_at
before update on public.menu_item_location_availability
for each row
execute function private.set_updated_at();

create function private.protect_menu_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.restaurant_id is distinct from old.restaurant_id
    or new.menu_id is distinct from old.menu_id
    or new.version_number is distinct from old.version_number
    or new.currency_code is distinct from old.currency_code
    or new.source_version_id is distinct from old.source_version_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '23514', message = 'menu version identity is immutable';
  end if;

  if old.status = 'published' then
    raise exception using errcode = '23514', message = 'published menu versions are immutable';
  end if;

  return new;
end;
$$;

create trigger menu_versions_protect_identity
before update on public.menu_versions
for each row
execute function private.protect_menu_version();

create function private.assert_menu_version_content_mutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_restaurant_id uuid;
  target_menu_id uuid;
  target_menu_version_id uuid;
  version_status text;
begin
  if tg_op = 'DELETE' then
    target_restaurant_id := old.restaurant_id;
    target_menu_id := old.menu_id;
    target_menu_version_id := old.menu_version_id;
  else
    target_restaurant_id := new.restaurant_id;
    target_menu_id := new.menu_id;
    target_menu_version_id := new.menu_version_id;
  end if;

  if tg_op = 'UPDATE'
    and (
      new.restaurant_id is distinct from old.restaurant_id
      or new.menu_id is distinct from old.menu_id
      or new.menu_version_id is distinct from old.menu_version_id
    )
  then
    raise exception using errcode = '23514', message = 'menu version content identity is immutable';
  end if;

  if tg_op = 'UPDATE'
    and tg_table_name = 'menu_version_items'
    and (to_jsonb(new) ->> 'menu_item_id') is distinct from (to_jsonb(old) ->> 'menu_item_id')
  then
    raise exception using errcode = '23514', message = 'menu item identity is immutable';
  end if;

  select version.status
  into version_status
  from public.menu_versions as version
  where version.restaurant_id = target_restaurant_id
    and version.menu_id = target_menu_id
    and version.id = target_menu_version_id;

  if version_status is null then
    raise exception using errcode = '23503', message = 'menu version was not found';
  end if;

  if version_status <> 'draft' then
    raise exception using errcode = '23514', message = 'published menu content is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger menu_version_sections_require_draft
before insert or update or delete on public.menu_version_sections
for each row
execute function private.assert_menu_version_content_mutable();

create trigger menu_version_items_require_draft
before insert or update or delete on public.menu_version_items
for each row
execute function private.assert_menu_version_content_mutable();

create function private.prevent_menu_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'menu history is append-only';
end;
$$;

create trigger menu_publications_append_only
before update or delete on public.menu_publications
for each row
execute function private.prevent_menu_history_mutation();

create trigger menu_item_availability_transitions_append_only
before update or delete on public.menu_item_availability_transitions
for each row
execute function private.prevent_menu_history_mutation();

create function private.protect_menu_availability_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.restaurant_id is distinct from old.restaurant_id
    or new.location_id is distinct from old.location_id
    or new.menu_id is distinct from old.menu_id
    or new.menu_item_id is distinct from old.menu_item_id
    or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '23514', message = 'menu availability identity is immutable';
  end if;

  return new;
end;
$$;

create trigger menu_item_location_availability_protect_identity
before update on public.menu_item_location_availability
for each row
execute function private.protect_menu_availability_identity();

create function private.assert_menu_actor(
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
    raise exception using errcode = 'P0001', message = 'menu administration requires aal2';
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
      message = 'menu actor must be an active owner or manager';
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
    raise exception using errcode = 'P0001', message = 'manager is not assigned to the menu location';
  end if;
end;
$$;

create function private.create_menu(
  target_restaurant_id uuid,
  target_slug text,
  target_display_name text,
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_menu_id uuid := gen_random_uuid();
begin
  perform private.assert_menu_actor(
    target_restaurant_id,
    null,
    target_actor_user_id,
    target_authentication_assurance
  );

  insert into public.menus (id, restaurant_id, slug, display_name)
  values (
    created_menu_id,
    target_restaurant_id,
    lower(btrim(target_slug)),
    btrim(target_display_name)
  );

  return created_menu_id;
end;
$$;

create function private.create_menu_draft(
  target_restaurant_id uuid,
  target_menu_id uuid,
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
  restaurant_currency text;
begin
  perform private.assert_menu_actor(
    target_restaurant_id,
    null,
    target_actor_user_id,
    target_authentication_assurance
  );

  if not exists (
    select 1
    from public.menus as menu
    where menu.restaurant_id = target_restaurant_id
      and menu.id = target_menu_id
      and menu.status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'active menu was not found';
  end if;

  if target_source_version_id is not null
    and not exists (
      select 1
      from public.menu_versions as source_version
      where source_version.restaurant_id = target_restaurant_id
        and source_version.menu_id = target_menu_id
        and source_version.id = target_source_version_id
        and source_version.status = 'published'
    )
  then
    raise exception using errcode = 'P0001', message = 'published source menu version was not found';
  end if;

  select restaurant.currency_code
  into restaurant_currency
  from public.restaurants as restaurant
  where restaurant.id = target_restaurant_id;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_restaurant_id::text || ':' || target_menu_id::text, 0)
  );

  select coalesce(max(version.version_number), 0) + 1
  into created_version_number
  from public.menu_versions as version
  where version.restaurant_id = target_restaurant_id
    and version.menu_id = target_menu_id;

  insert into public.menu_versions (
    id,
    restaurant_id,
    menu_id,
    version_number,
    currency_code,
    source_version_id,
    created_by_user_id
  )
  values (
    created_version_id,
    target_restaurant_id,
    target_menu_id,
    created_version_number,
    restaurant_currency,
    target_source_version_id,
    target_actor_user_id
  );

  if target_source_version_id is not null then
    insert into public.menu_version_sections (
      restaurant_id,
      menu_id,
      menu_version_id,
      section_key,
      display_name,
      sort_order
    )
    select
      source_section.restaurant_id,
      source_section.menu_id,
      created_version_id,
      source_section.section_key,
      source_section.display_name,
      source_section.sort_order
    from public.menu_version_sections as source_section
    where source_section.restaurant_id = target_restaurant_id
      and source_section.menu_id = target_menu_id
      and source_section.menu_version_id = target_source_version_id;

    insert into public.menu_version_items (
      restaurant_id,
      menu_id,
      menu_version_id,
      menu_item_id,
      section_key,
      display_name,
      description,
      price_amount_minor,
      is_active,
      sort_order
    )
    select
      source_item.restaurant_id,
      source_item.menu_id,
      created_version_id,
      source_item.menu_item_id,
      source_item.section_key,
      source_item.display_name,
      source_item.description,
      source_item.price_amount_minor,
      source_item.is_active,
      source_item.sort_order
    from public.menu_version_items as source_item
    where source_item.restaurant_id = target_restaurant_id
      and source_item.menu_id = target_menu_id
      and source_item.menu_version_id = target_source_version_id;
  end if;

  return created_version_id;
end;
$$;

create function private.publish_menu_version(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_menu_id uuid,
  target_menu_version_id uuid,
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
  version_status text;
  version_currency text;
  restaurant_currency text;
  publication_event_type text;
begin
  perform private.assert_menu_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  if target_effective_at < now() - interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'menu publication cannot be backdated';
  end if;

  if not exists (
    select 1
    from public.locations as location
    where location.restaurant_id = target_restaurant_id
      and location.id = target_location_id
      and location.status <> 'suspended'
  ) then
    raise exception using errcode = 'P0001', message = 'menu publication location was not found';
  end if;

  select version.status, version.currency_code, restaurant.currency_code
  into version_status, version_currency, restaurant_currency
  from public.menu_versions as version
  join public.restaurants as restaurant
    on restaurant.id = version.restaurant_id
  join public.menus as menu
    on menu.restaurant_id = version.restaurant_id
    and menu.id = version.menu_id
  where version.restaurant_id = target_restaurant_id
    and version.menu_id = target_menu_id
    and version.id = target_menu_version_id
    and menu.status = 'active'
  for update of version;

  if version_status is null then
    raise exception using errcode = 'P0001', message = 'active menu version was not found';
  end if;

  if version_currency <> restaurant_currency then
    raise exception using errcode = 'P0001', message = 'menu version currency does not match restaurant';
  end if;

  if not exists (
    select 1
    from public.menu_version_items as item
    where item.restaurant_id = target_restaurant_id
      and item.menu_id = target_menu_id
      and item.menu_version_id = target_menu_version_id
      and item.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'menu version has no active item';
  end if;

  if version_status = 'draft' then
    update public.menu_versions
    set
      status = 'published',
      published_by_user_id = target_actor_user_id,
      published_at = now()
    where restaurant_id = target_restaurant_id
      and menu_id = target_menu_id
      and id = target_menu_version_id;
  end if;

  insert into public.menu_publications (
    id,
    restaurant_id,
    location_id,
    menu_id,
    menu_version_id,
    publication_kind,
    effective_at,
    actor_user_id,
    authentication_assurance
  )
  values (
    publication_id,
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_menu_version_id,
    'publish',
    target_effective_at,
    target_actor_user_id,
    target_authentication_assurance
  );

  publication_event_type := case
    when target_effective_at > now() then 'menu.version.scheduled'
    else 'menu.version.published'
  end;

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
    'menu',
    target_menu_id,
    publication_event_type,
    jsonb_build_object(
      'publication_id', publication_id,
      'location_id', target_location_id,
      'menu_version_id', target_menu_version_id,
      'effective_at', target_effective_at
    ),
    'menu-publication:' || publication_id::text
  );

  return publication_id;
end;
$$;

create function private.rollback_menu_version(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_menu_id uuid,
  target_menu_version_id uuid,
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
begin
  perform private.assert_menu_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  if target_effective_at < now() - interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'menu rollback cannot be backdated';
  end if;

  if not exists (
    select 1
    from public.menu_versions as version
    where version.restaurant_id = target_restaurant_id
      and version.menu_id = target_menu_id
      and version.id = target_menu_version_id
      and version.status = 'published'
  ) then
    raise exception using errcode = 'P0001', message = 'published rollback menu version was not found';
  end if;

  if not exists (
    select 1
    from public.menu_publications as publication
    where publication.restaurant_id = target_restaurant_id
      and publication.location_id = target_location_id
      and publication.menu_id = target_menu_id
      and publication.menu_version_id = target_menu_version_id
      and publication.effective_at <= now()
  ) then
    raise exception using errcode = 'P0001', message = 'rollback version was never active at this location';
  end if;

  insert into public.menu_publications (
    id,
    restaurant_id,
    location_id,
    menu_id,
    menu_version_id,
    publication_kind,
    effective_at,
    actor_user_id,
    authentication_assurance
  )
  values (
    publication_id,
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_menu_version_id,
    'rollback',
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
    'menu',
    target_menu_id,
    case
      when target_effective_at > now() then 'menu.version.rollback_scheduled'
      else 'menu.version.rolled_back'
    end,
    jsonb_build_object(
      'publication_id', publication_id,
      'location_id', target_location_id,
      'menu_version_id', target_menu_version_id,
      'effective_at', target_effective_at
    ),
    'menu-publication:' || publication_id::text
  );

  return publication_id;
end;
$$;

create function private.set_menu_item_availability(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_menu_id uuid,
  target_menu_item_id uuid,
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
  transition_id uuid := gen_random_uuid();
  previous_status text;
begin
  perform private.assert_menu_actor(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );

  if target_status not in ('available', 'sold_out', 'unavailable') then
    raise exception using errcode = 'P0001', message = 'menu item availability status is invalid';
  end if;

  if not exists (
    select 1
    from public.locations as location
    join public.menu_items as item
      on item.restaurant_id = location.restaurant_id
    where location.restaurant_id = target_restaurant_id
      and location.id = target_location_id
      and item.menu_id = target_menu_id
      and item.id = target_menu_item_id
  ) then
    raise exception using errcode = 'P0001', message = 'menu item location boundary is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_restaurant_id::text || ':' || target_location_id::text || ':' || target_menu_item_id::text,
      0
    )
  );

  select availability.status
  into previous_status
  from public.menu_item_location_availability as availability
  where availability.restaurant_id = target_restaurant_id
    and availability.location_id = target_location_id
    and availability.menu_id = target_menu_id
    and availability.menu_item_id = target_menu_item_id
  for update;

  if previous_status = target_status then
    raise exception using errcode = 'P0001', message = 'menu item availability status is unchanged';
  end if;

  insert into public.menu_item_location_availability (
    restaurant_id,
    location_id,
    menu_id,
    menu_item_id,
    status,
    updated_by_user_id
  )
  values (
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_menu_item_id,
    target_status,
    target_actor_user_id
  )
  on conflict (restaurant_id, location_id, menu_item_id)
  do update set
    status = excluded.status,
    updated_by_user_id = excluded.updated_by_user_id;

  insert into public.menu_item_availability_transitions (
    id,
    restaurant_id,
    location_id,
    menu_id,
    menu_item_id,
    from_status,
    to_status,
    actor_user_id,
    authentication_assurance
  )
  values (
    transition_id,
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_menu_item_id,
    previous_status,
    target_status,
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
    'menu_item',
    target_menu_item_id,
    'menu.item.availability_changed',
    jsonb_build_object(
      'transition_id', transition_id,
      'location_id', target_location_id,
      'menu_id', target_menu_id,
      'from_status', previous_status,
      'to_status', target_status
    ),
    'menu-availability:' || transition_id::text
  );

  return transition_id;
end;
$$;

create function private.resolve_public_menu_version(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_menu_id uuid,
  target_at timestamptz default now()
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_location_go_live(target_restaurant_id, target_location_id)
      and private.is_restaurant_feature_enabled(target_restaurant_id, 'catalog.public_menu')
    then (
      select publication.menu_version_id
      from public.menu_publications as publication
      join public.menu_versions as version
        on version.restaurant_id = publication.restaurant_id
        and version.menu_id = publication.menu_id
        and version.id = publication.menu_version_id
      join public.menus as menu
        on menu.restaurant_id = publication.restaurant_id
        and menu.id = publication.menu_id
      where publication.restaurant_id = target_restaurant_id
        and publication.location_id = target_location_id
        and publication.menu_id = target_menu_id
        and publication.effective_at <= target_at
        and version.status = 'published'
        and menu.status = 'active'
      order by publication.effective_at desc, publication.created_at desc, publication.id desc
      limit 1
    )
    else null
  end;
$$;

alter table public.menus enable row level security;
alter table public.menus force row level security;
alter table public.menu_versions enable row level security;
alter table public.menu_versions force row level security;
alter table public.menu_items enable row level security;
alter table public.menu_items force row level security;
alter table public.menu_version_sections enable row level security;
alter table public.menu_version_sections force row level security;
alter table public.menu_version_items enable row level security;
alter table public.menu_version_items force row level security;
alter table public.menu_item_location_availability enable row level security;
alter table public.menu_item_location_availability force row level security;
alter table public.menu_publications enable row level security;
alter table public.menu_publications force row level security;
alter table public.menu_item_availability_transitions enable row level security;
alter table public.menu_item_availability_transitions force row level security;

create policy menus_select_administrators
on public.menus
for select
to authenticated
using (private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[]));

create policy menu_versions_select_administrators
on public.menu_versions
for select
to authenticated
using (private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[]));

create policy menu_items_select_administrators
on public.menu_items
for select
to authenticated
using (private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[]));

create policy menu_version_sections_select_administrators
on public.menu_version_sections
for select
to authenticated
using (private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[]));

create policy menu_version_items_select_administrators
on public.menu_version_items
for select
to authenticated
using (private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[]));

create policy menu_item_location_availability_select_administrators
on public.menu_item_location_availability
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

create policy menu_publications_select_administrators
on public.menu_publications
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

create policy menu_item_availability_transitions_select_administrators
on public.menu_item_availability_transitions
for select
to authenticated
using (
  private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

revoke all on table public.menus from public, anon, authenticated;
revoke all on table public.menu_versions from public, anon, authenticated;
revoke all on table public.menu_items from public, anon, authenticated;
revoke all on table public.menu_version_sections from public, anon, authenticated;
revoke all on table public.menu_version_items from public, anon, authenticated;
revoke all on table public.menu_item_location_availability from public, anon, authenticated;
revoke all on table public.menu_publications from public, anon, authenticated;
revoke all on table public.menu_item_availability_transitions from public, anon, authenticated;

grant select on table public.menus to authenticated, service_role;
grant select on table public.menu_versions to authenticated, service_role;
grant select on table public.menu_items to authenticated, service_role;
grant select on table public.menu_version_sections to authenticated, service_role;
grant select on table public.menu_version_items to authenticated, service_role;
grant select on table public.menu_item_location_availability to authenticated, service_role;
grant select on table public.menu_publications to authenticated, service_role;
grant select on table public.menu_item_availability_transitions to authenticated, service_role;

grant insert on table public.menu_items to service_role;
grant insert, update, delete on table public.menu_version_sections to service_role;
grant insert, update, delete on table public.menu_version_items to service_role;

revoke all on function private.protect_menu_version() from public;
revoke all on function private.assert_menu_version_content_mutable() from public;
revoke all on function private.prevent_menu_history_mutation() from public;
revoke all on function private.protect_menu_availability_identity() from public;
revoke all on function private.assert_menu_actor(uuid, uuid, uuid, text) from public;
revoke all on function private.create_menu(uuid, text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function private.create_menu_draft(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function private.publish_menu_version(uuid, uuid, uuid, uuid, timestamptz, uuid, text)
  from public, anon, authenticated;
revoke all on function private.rollback_menu_version(uuid, uuid, uuid, uuid, timestamptz, uuid, text)
  from public, anon, authenticated;
revoke all on function private.set_menu_item_availability(uuid, uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function private.resolve_public_menu_version(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;

grant execute on function private.create_menu(uuid, text, text, uuid, text) to service_role;
grant execute on function private.create_menu_draft(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function private.publish_menu_version(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid,
  text
) to service_role;
grant execute on function private.rollback_menu_version(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid,
  text
) to service_role;
grant execute on function private.set_menu_item_availability(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text
) to service_role;
grant execute on function private.resolve_public_menu_version(uuid, uuid, uuid, timestamptz)
  to service_role;

comment on table public.menus is
  'Stable tenant-owned menu identity. Customer-visible content lives in immutable menu versions.';
comment on table public.menu_versions is
  'Draft or immutable published menu snapshot with restaurant currency and optional source version.';
comment on table public.menu_items is
  'Stable item identity shared by versioned menu snapshots and operational location availability.';
comment on table public.menu_version_items is
  'Versioned customer-facing item snapshot. Money is stored in minor currency units.';
comment on table public.menu_publications is
  'Append-only location publication timeline supporting scheduling and rollback.';
comment on table public.menu_item_location_availability is
  'Current operational item availability per location, separate from immutable menu content.';
comment on table public.menu_item_availability_transitions is
  'Append-only audit history for location item availability changes.';
comment on function private.resolve_public_menu_version(uuid, uuid, uuid, timestamptz) is
  'Fail-closed resolver requiring location go-live, catalog feature flag and an effective publication.';
