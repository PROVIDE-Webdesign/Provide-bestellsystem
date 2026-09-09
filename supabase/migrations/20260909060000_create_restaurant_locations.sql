create table public.locations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete restrict,
  slug text not null,
  display_name text not null,
  status text not null default 'setup',
  timezone text not null default 'Europe/Berlin',
  address_line_1 text,
  address_line_2 text,
  postal_code text,
  city text,
  country_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint locations_slug_length check (char_length(slug) between 2 and 63),
  constraint locations_display_name_not_blank check (btrim(display_name) <> ''),
  constraint locations_status_allowed check (status in ('setup', 'active', 'suspended')),
  constraint locations_timezone_not_blank check (btrim(timezone) <> ''),
  constraint locations_address_line_1_not_blank check (
    address_line_1 is null or btrim(address_line_1) <> ''
  ),
  constraint locations_address_line_2_not_blank check (
    address_line_2 is null or btrim(address_line_2) <> ''
  ),
  constraint locations_postal_code_not_blank check (
    postal_code is null or btrim(postal_code) <> ''
  ),
  constraint locations_city_not_blank check (city is null or btrim(city) <> ''),
  constraint locations_country_code_format check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  ),
  constraint locations_restaurant_slug_unique unique (restaurant_id, slug),
  constraint locations_restaurant_id_id_unique unique (restaurant_id, id)
);

create index locations_restaurant_status_idx
  on public.locations (restaurant_id, status, display_name, id);

create function private.prevent_location_restaurant_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.restaurant_id is distinct from old.restaurant_id then
    raise exception using
      errcode = '23514',
      message = 'a location cannot be reassigned to another restaurant';
  end if;

  return new;
end;
$$;

create trigger locations_prevent_restaurant_change
before update of restaurant_id on public.locations
for each row
execute function private.prevent_location_restaurant_change();

create trigger locations_set_updated_at
before update on public.locations
for each row
execute function private.set_updated_at();

alter table public.locations enable row level security;
alter table public.locations force row level security;

create policy locations_select_for_restaurant_members
on public.locations
for select
to authenticated
using (private.is_restaurant_member(restaurant_id));

revoke all on table public.locations from public, anon, authenticated;
grant select on table public.locations to authenticated;
grant select, insert, update, delete on table public.locations to service_role;

revoke all on function private.prevent_location_restaurant_change() from public;
revoke all on function private.prevent_location_restaurant_change() from anon, authenticated;
grant execute on function private.prevent_location_restaurant_change() to service_role;

comment on table public.locations is
  'Restaurant-owned operating locations. Every row is protected by its restaurant boundary.';
comment on constraint locations_restaurant_id_id_unique on public.locations is
  'Composite tenant key for later foreign keys that must bind restaurant and location together.';
comment on function private.prevent_location_restaurant_change() is
  'Prevents a location and its future child records from moving across tenant boundaries.';
