create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  display_name text not null,
  status text not null default 'setup',
  timezone text not null default 'Europe/Berlin',
  currency_code text not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurants_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint restaurants_slug_length check (char_length(slug) between 3 and 63),
  constraint restaurants_display_name_not_blank check (btrim(display_name) <> ''),
  constraint restaurants_status_allowed check (status in ('setup', 'active', 'suspended')),
  constraint restaurants_timezone_not_blank check (btrim(timezone) <> ''),
  constraint restaurants_currency_code_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint restaurants_slug_unique unique (slug)
);

create table public.restaurant_memberships (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id),
  constraint restaurant_memberships_role_allowed check (role in ('owner', 'manager', 'staff'))
);

create index restaurant_memberships_user_id_idx
  on public.restaurant_memberships (user_id, restaurant_id);

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger restaurants_set_updated_at
before update on public.restaurants
for each row
execute function private.set_updated_at();

create function private.is_restaurant_member(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.restaurant_memberships as membership
    where membership.restaurant_id = target_restaurant_id
      and membership.user_id = (select auth.uid())
  );
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.is_restaurant_member(uuid) from public;
grant execute on function private.set_updated_at() to service_role;
grant execute on function private.is_restaurant_member(uuid) to authenticated, service_role;

alter table public.restaurants enable row level security;
alter table public.restaurants force row level security;
alter table public.restaurant_memberships enable row level security;
alter table public.restaurant_memberships force row level security;

create policy restaurants_select_for_members
on public.restaurants
for select
to authenticated
using (private.is_restaurant_member(id));

create policy memberships_select_own
on public.restaurant_memberships
for select
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.restaurants from anon, authenticated;
revoke all on table public.restaurant_memberships from anon, authenticated;
grant select on table public.restaurants to authenticated;
grant select on table public.restaurant_memberships to authenticated;
grant select, insert, update, delete on table public.restaurants to service_role;
grant select, insert, update, delete on table public.restaurant_memberships to service_role;

comment on table public.restaurants is
  'Tenant root. Every restaurant-owned record must reference a restaurant id.';
comment on table public.restaurant_memberships is
  'Links authenticated users to exactly the restaurants they may access.';
comment on function private.is_restaurant_member(uuid) is
  'Security-definer helper used by RLS without exposing membership rows.';
