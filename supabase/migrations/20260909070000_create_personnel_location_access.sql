do $$
begin
  if exists (
    select 1
    from public.restaurant_memberships
    where role = 'staff'
  ) then
    raise exception using
      errcode = '23514',
      message = 'legacy staff memberships require an explicit role assignment before migration';
  end if;
end;
$$;

alter table public.restaurant_memberships
  drop constraint restaurant_memberships_role_allowed;

alter table public.restaurant_memberships
  add constraint restaurant_memberships_role_allowed
  check (role in ('owner', 'manager', 'kitchen', 'driver'));

create table public.restaurant_membership_locations (
  restaurant_id uuid not null,
  user_id uuid not null,
  location_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id, location_id),
  constraint restaurant_membership_locations_membership_fk
    foreign key (restaurant_id, user_id)
    references public.restaurant_memberships (restaurant_id, user_id)
    on delete cascade,
  constraint restaurant_membership_locations_location_fk
    foreign key (restaurant_id, location_id)
    references public.locations (restaurant_id, id)
    on delete cascade
);

create index restaurant_membership_locations_user_idx
  on public.restaurant_membership_locations (user_id, restaurant_id, location_id);

create function private.has_restaurant_role(
  target_restaurant_id uuid,
  allowed_roles text[]
)
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
      and membership.role = any (allowed_roles)
  );
$$;

create function private.can_access_location(
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
    join public.restaurant_memberships as membership
      on membership.restaurant_id = location.restaurant_id
    where location.restaurant_id = target_restaurant_id
      and location.id = target_location_id
      and membership.user_id = (select auth.uid())
      and (
        membership.role = 'owner'
        or (
          membership.role in ('manager', 'kitchen', 'driver')
          and exists (
            select 1
            from public.restaurant_membership_locations as assignment
            where assignment.restaurant_id = membership.restaurant_id
              and assignment.user_id = membership.user_id
              and assignment.location_id = location.id
          )
        )
      )
  );
$$;

drop policy locations_select_for_restaurant_members on public.locations;

create policy locations_select_for_authorized_personnel
on public.locations
for select
to authenticated
using (private.can_access_location(restaurant_id, id));

alter table public.restaurant_membership_locations enable row level security;
alter table public.restaurant_membership_locations force row level security;

create policy membership_locations_select_own
on public.restaurant_membership_locations
for select
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.restaurant_membership_locations from public, anon, authenticated;
grant select on table public.restaurant_membership_locations to authenticated;
grant select, insert, update, delete on table public.restaurant_membership_locations to service_role;

revoke all on function private.has_restaurant_role(uuid, text[]) from public;
revoke all on function private.can_access_location(uuid, uuid) from public;
revoke all on function private.has_restaurant_role(uuid, text[]) from anon;
revoke all on function private.can_access_location(uuid, uuid) from anon;
grant execute on function private.has_restaurant_role(uuid, text[]) to authenticated, service_role;
grant execute on function private.can_access_location(uuid, uuid) to authenticated, service_role;

comment on table public.restaurant_membership_locations is
  'Explicit location access for non-owner restaurant personnel.';
comment on function private.has_restaurant_role(uuid, text[]) is
  'Checks the authenticated user role inside one restaurant without exposing other memberships.';
comment on function private.can_access_location(uuid, uuid) is
  'Allows owners restaurant-wide access and other personnel only explicitly assigned locations.';
