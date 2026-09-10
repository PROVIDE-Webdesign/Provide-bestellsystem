alter table public.restaurant_memberships
  add column status text not null default 'active',
  add column suspended_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add constraint restaurant_memberships_status_allowed
    check (status in ('active', 'suspended')),
  add constraint restaurant_memberships_suspension_consistent
    check (
      (status = 'active' and suspended_at is null)
      or (status = 'suspended' and suspended_at is not null)
    );

create function private.enforce_restaurant_membership_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.restaurant_id <> old.restaurant_id or new.user_id <> old.user_id then
    raise exception using
      errcode = '23514',
      message = 'a restaurant membership cannot be reassigned';
  end if;

  if new.status = 'suspended' and old.status = 'active' then
    new.suspended_at = coalesce(new.suspended_at, now());
  elsif new.status = 'active' then
    new.suspended_at = null;
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create trigger restaurant_memberships_enforce_lifecycle
before update on public.restaurant_memberships
for each row
execute function private.enforce_restaurant_membership_lifecycle();

create table public.restaurant_invitations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  invited_user_id uuid not null references auth.users (id) on delete restrict,
  email text not null,
  role text not null,
  status text not null default 'pending',
  invited_by_user_id uuid not null references auth.users (id) on delete restrict,
  accepted_by_user_id uuid references auth.users (id) on delete restrict,
  revoked_by_user_id uuid references auth.users (id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_invitations_restaurant_id_id_unique unique (restaurant_id, id),
  constraint restaurant_invitations_email_normalized
    check (email = lower(btrim(email)) and email <> ''),
  constraint restaurant_invitations_role_allowed
    check (role in ('owner', 'manager', 'kitchen', 'driver')),
  constraint restaurant_invitations_status_allowed
    check (status in ('pending', 'accepted', 'revoked')),
  constraint restaurant_invitations_expiry_after_creation
    check (expires_at > created_at),
  constraint restaurant_invitations_lifecycle_consistent
    check (
      (
        status = 'pending'
        and accepted_by_user_id is null
        and accepted_at is null
        and revoked_by_user_id is null
        and revoked_at is null
      )
      or (
        status = 'accepted'
        and accepted_by_user_id = invited_user_id
        and accepted_at is not null
        and revoked_by_user_id is null
        and revoked_at is null
      )
      or (
        status = 'revoked'
        and accepted_by_user_id is null
        and accepted_at is null
        and revoked_by_user_id is not null
        and revoked_at is not null
      )
    )
);

create unique index restaurant_invitations_pending_email_unique
  on public.restaurant_invitations (restaurant_id, email)
  where status = 'pending';

create unique index restaurant_invitations_pending_user_unique
  on public.restaurant_invitations (restaurant_id, invited_user_id)
  where status = 'pending';

create index restaurant_invitations_invited_user_idx
  on public.restaurant_invitations (invited_user_id, restaurant_id, status);

create table public.restaurant_invitation_locations (
  restaurant_id uuid not null,
  invitation_id uuid not null,
  location_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, invitation_id, location_id),
  constraint restaurant_invitation_locations_invitation_fk
    foreign key (restaurant_id, invitation_id)
    references public.restaurant_invitations (restaurant_id, id)
    on delete cascade,
  constraint restaurant_invitation_locations_location_fk
    foreign key (restaurant_id, location_id)
    references public.locations (restaurant_id, id)
    on delete cascade
);

create index restaurant_invitation_locations_location_idx
  on public.restaurant_invitation_locations (restaurant_id, location_id, invitation_id);

create function private.validate_restaurant_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator_role text;
  provider_email text;
begin
  if tg_op = 'INSERT' and new.status <> 'pending' then
    raise exception using
      errcode = '23514',
      message = 'a restaurant invitation must start as pending';
  end if;

  if tg_op = 'UPDATE' then
    if old.status <> 'pending' then
      raise exception using
        errcode = '23514',
        message = 'a completed restaurant invitation is immutable';
    end if;

    if new.restaurant_id <> old.restaurant_id
      or new.invited_user_id <> old.invited_user_id
      or new.email <> old.email
      or new.role <> old.role
      or new.invited_by_user_id <> old.invited_by_user_id
      or new.expires_at <> old.expires_at
      or new.created_at <> old.created_at
    then
      raise exception using
        errcode = '23514',
        message = 'restaurant invitation identity cannot be changed';
    end if;
  end if;

  if tg_op = 'INSERT' then
    select lower(auth_user.email)
    into provider_email
    from auth.users as auth_user
    where auth_user.id = new.invited_user_id;

    if provider_email is null or provider_email <> new.email then
      raise exception using
        errcode = '23514',
        message = 'restaurant invitation email must match the invited auth user';
    end if;
  end if;

  select membership.role
  into creator_role
  from public.restaurant_memberships as membership
  where membership.restaurant_id = new.restaurant_id
    and membership.user_id = new.invited_by_user_id
    and membership.status = 'active';

  if creator_role is null then
    raise exception using
      errcode = '42501',
      message = 'only active restaurant personnel may create or revoke invitations';
  end if;

  if creator_role = 'manager' and new.role not in ('kitchen', 'driver') then
    raise exception using
      errcode = '42501',
      message = 'managers may invite only kitchen personnel or drivers';
  elsif creator_role <> 'owner' and creator_role <> 'manager' then
    raise exception using
      errcode = '42501',
      message = 'the restaurant role may not manage invitations';
  end if;

  if tg_op = 'INSERT' and exists (
    select 1
    from public.restaurant_memberships as membership
    where membership.restaurant_id = new.restaurant_id
      and membership.user_id = new.invited_user_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'the invited user already has a restaurant membership';
  end if;

  if tg_op = 'UPDATE' and new.status = 'accepted' then
    if new.accepted_by_user_id <> new.invited_user_id then
      raise exception using
        errcode = '23514',
        message = 'only the invited auth user may accept the invitation';
    end if;

    if not exists (
      select 1
      from public.restaurant_memberships as membership
      where membership.restaurant_id = new.restaurant_id
        and membership.user_id = new.invited_user_id
        and membership.role = new.role
        and membership.status = 'active'
    ) then
      raise exception using
        errcode = '23514',
        message = 'an accepted invitation requires its active membership';
    end if;

    if new.role <> 'owner' and not exists (
      select 1
      from public.restaurant_invitation_locations as invitation_assignment
      where invitation_assignment.restaurant_id = new.restaurant_id
        and invitation_assignment.invitation_id = new.id
    ) then
      raise exception using
        errcode = '23514',
        message = 'an accepted non-owner invitation requires a location assignment';
    end if;

    if exists (
      select 1
      from public.restaurant_invitation_locations as invitation_assignment
      where invitation_assignment.restaurant_id = new.restaurant_id
        and invitation_assignment.invitation_id = new.id
        and not exists (
          select 1
          from public.restaurant_membership_locations as membership_assignment
          where membership_assignment.restaurant_id = invitation_assignment.restaurant_id
            and membership_assignment.user_id = new.invited_user_id
            and membership_assignment.location_id = invitation_assignment.location_id
        )
    ) then
      raise exception using
        errcode = '23514',
        message = 'accepted invitation locations must be copied to the membership';
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'revoked' then
    select membership.role
    into creator_role
    from public.restaurant_memberships as membership
    where membership.restaurant_id = new.restaurant_id
      and membership.user_id = new.revoked_by_user_id
      and membership.status = 'active';

    if creator_role is null
      or (creator_role = 'manager' and new.role not in ('kitchen', 'driver'))
      or creator_role not in ('owner', 'manager')
    then
      raise exception using
        errcode = '42501',
        message = 'the selected restaurant user may not revoke this invitation';
    end if;
  end if;

  return new;
end;
$$;

create trigger restaurant_invitations_validate
before insert or update on public.restaurant_invitations
for each row
execute function private.validate_restaurant_invitation();

create trigger restaurant_invitations_set_updated_at
before update on public.restaurant_invitations
for each row
execute function private.set_updated_at();

create function private.validate_restaurant_invitation_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_row record;
  creator_role text;
  target_restaurant_id uuid;
  target_invitation_id uuid;
begin
  if tg_op = 'DELETE' then
    target_restaurant_id = old.restaurant_id;
    target_invitation_id = old.invitation_id;
  else
    target_restaurant_id = new.restaurant_id;
    target_invitation_id = new.invitation_id;
  end if;

  select invitation.role, invitation.status, invitation.invited_by_user_id
  into target_row
  from public.restaurant_invitations as invitation
  where invitation.restaurant_id = target_restaurant_id
    and invitation.id = target_invitation_id;

  if tg_op = 'DELETE' and target_row.status is null then
    return old;
  end if;

  if target_row.status is distinct from 'pending' then
    raise exception using
      errcode = '23514',
      message = 'locations can be changed only while an invitation is pending';
  end if;

  if tg_op = 'UPDATE' and (
    new.restaurant_id <> old.restaurant_id
    or new.invitation_id <> old.invitation_id
    or new.location_id <> old.location_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'an invitation location cannot be reassigned';
  end if;

  if target_row.role = 'owner' then
    raise exception using
      errcode = '23514',
      message = 'owner invitations must not contain location assignments';
  end if;

  select membership.role
  into creator_role
  from public.restaurant_memberships as membership
  where membership.restaurant_id = target_restaurant_id
    and membership.user_id = target_row.invited_by_user_id
    and membership.status = 'active';

  if creator_role = 'manager' and tg_op <> 'DELETE' and not exists (
    select 1
    from public.restaurant_membership_locations as assignment
    where assignment.restaurant_id = target_restaurant_id
      and assignment.user_id = target_row.invited_by_user_id
      and assignment.location_id = new.location_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'a manager may assign only locations they can access';
  elsif creator_role <> 'owner' and creator_role <> 'manager' then
    raise exception using
      errcode = '42501',
      message = 'the invitation creator may not manage location assignments';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger restaurant_invitation_locations_validate
before insert or update or delete on public.restaurant_invitation_locations
for each row
execute function private.validate_restaurant_invitation_location();

create function private.accept_restaurant_invitation(
  target_invitation_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_row public.restaurant_invitations%rowtype;
  creator_role text;
begin
  select *
  into invitation_row
  from public.restaurant_invitations as invitation
  where invitation.id = target_invitation_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'restaurant invitation not found';
  end if;

  if invitation_row.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'restaurant invitation is not pending';
  end if;

  if invitation_row.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'restaurant invitation is expired';
  end if;

  if invitation_row.invited_user_id <> target_user_id then
    raise exception using errcode = 'P0001', message = 'restaurant invitation user mismatch';
  end if;

  select membership.role
  into creator_role
  from public.restaurant_memberships as membership
  where membership.restaurant_id = invitation_row.restaurant_id
    and membership.user_id = invitation_row.invited_by_user_id
    and membership.status = 'active';

  if creator_role is null
    or creator_role not in ('owner', 'manager')
    or (creator_role = 'manager' and invitation_row.role not in ('kitchen', 'driver'))
  then
    raise exception using
      errcode = 'P0001',
      message = 'restaurant invitation creator is no longer authorized';
  end if;

  if invitation_row.role <> 'owner' and not exists (
    select 1
    from public.restaurant_invitation_locations as assignment
    where assignment.restaurant_id = invitation_row.restaurant_id
      and assignment.invitation_id = invitation_row.id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'restaurant invitation requires a location assignment';
  end if;

  if creator_role = 'manager' and exists (
    select 1
    from public.restaurant_invitation_locations as invitation_assignment
    where invitation_assignment.restaurant_id = invitation_row.restaurant_id
      and invitation_assignment.invitation_id = invitation_row.id
      and not exists (
        select 1
        from public.restaurant_membership_locations as manager_assignment
        where manager_assignment.restaurant_id = invitation_assignment.restaurant_id
          and manager_assignment.user_id = invitation_row.invited_by_user_id
          and manager_assignment.location_id = invitation_assignment.location_id
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'restaurant invitation contains a location outside the manager scope';
  end if;

  insert into public.restaurant_memberships (restaurant_id, user_id, role, status)
  values (
    invitation_row.restaurant_id,
    invitation_row.invited_user_id,
    invitation_row.role,
    'active'
  );

  insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
  select
    assignment.restaurant_id,
    invitation_row.invited_user_id,
    assignment.location_id
  from public.restaurant_invitation_locations as assignment
  where assignment.restaurant_id = invitation_row.restaurant_id
    and assignment.invitation_id = invitation_row.id;

  update public.restaurant_invitations
  set
    status = 'accepted',
    accepted_by_user_id = invitation_row.invited_user_id,
    accepted_at = now()
  where id = invitation_row.id;
end;
$$;

create or replace function private.is_restaurant_member(target_restaurant_id uuid)
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
      and membership.status = 'active'
  );
$$;

create or replace function private.has_restaurant_role(
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
      and membership.status = 'active'
      and membership.role = any (allowed_roles)
  );
$$;

create or replace function private.can_access_location(
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
      and membership.status = 'active'
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

drop policy membership_locations_select_own on public.restaurant_membership_locations;

create policy membership_locations_select_own_active
on public.restaurant_membership_locations
for select
to authenticated
using (
  user_id = (select auth.uid())
  and private.is_restaurant_member(restaurant_id)
);

alter table public.restaurant_invitations enable row level security;
alter table public.restaurant_invitations force row level security;
alter table public.restaurant_invitation_locations enable row level security;
alter table public.restaurant_invitation_locations force row level security;

revoke all on table public.restaurant_invitations from public, anon, authenticated;
revoke all on table public.restaurant_invitation_locations from public, anon, authenticated;
grant select, insert, update, delete on table public.restaurant_invitations to service_role;
grant select, insert, update, delete on table public.restaurant_invitation_locations to service_role;

revoke all on function private.enforce_restaurant_membership_lifecycle() from public;
revoke all on function private.validate_restaurant_invitation() from public;
revoke all on function private.validate_restaurant_invitation_location() from public;
revoke all on function private.accept_restaurant_invitation(uuid, uuid) from public;
revoke all on function private.accept_restaurant_invitation(uuid, uuid) from anon, authenticated;
grant execute on function private.accept_restaurant_invitation(uuid, uuid) to service_role;

comment on column public.restaurant_memberships.status is
  'Active memberships authorize access; suspended memberships remain recorded but authorize nothing.';
comment on table public.restaurant_invitations is
  'Server-managed restaurant invitation metadata; provider invitation secrets are never stored here.';
comment on table public.restaurant_invitation_locations is
  'Tenant-safe location scope copied to a non-owner membership when its invitation is accepted.';
comment on function private.accept_restaurant_invitation(uuid, uuid) is
  'Server-only atomic transition from a valid provider-backed invitation to an active membership.';
