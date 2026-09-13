alter table public.restaurant_invitations
  add column accepted_at_aal text,
  add constraint restaurant_invitations_accepted_at_aal_allowed
    check (accepted_at_aal is null or accepted_at_aal in ('aal1', 'aal2'));

create function private.validate_restaurant_invitation_auth_assurance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status = 'pending' then
    if new.accepted_at_aal not in ('aal1', 'aal2') then
      raise exception using
        errcode = '23514',
        message = 'accepted invitations require a verified authentication assurance level';
    end if;

    if new.role in ('owner', 'manager') and new.accepted_at_aal <> 'aal2' then
      raise exception using
        errcode = '42501',
        message = 'privileged restaurant invitations require aal2';
    end if;
  elsif new.status <> 'accepted' and new.accepted_at_aal is not null then
    raise exception using
      errcode = '23514',
      message = 'only accepted invitations may record an authentication assurance level';
  end if;

  return new;
end;
$$;

create trigger restaurant_invitations_validate_auth_assurance
before update on public.restaurant_invitations
for each row
execute function private.validate_restaurant_invitation_auth_assurance();

create function private.authentication_assurance_allows_role(target_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target_role in ('owner', 'manager') then
      (select auth.jwt() ->> 'aal') = 'aal2'
    when target_role in ('kitchen', 'driver') then
      coalesce((select auth.jwt() ->> 'aal'), 'aal1') in ('aal1', 'aal2')
    else false
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
      and private.authentication_assurance_allows_role(membership.role)
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
      and private.authentication_assurance_allows_role(membership.role)
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
      and private.authentication_assurance_allows_role(membership.role)
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

revoke all on function private.accept_restaurant_invitation(uuid, uuid) from public;
revoke all on function private.accept_restaurant_invitation(uuid, uuid) from anon, authenticated;
revoke all on function private.accept_restaurant_invitation(uuid, uuid) from service_role;
drop function private.accept_restaurant_invitation(uuid, uuid);

create function private.accept_restaurant_invitation(
  target_invitation_id uuid,
  target_user_id uuid,
  target_authentication_assurance text
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
  if target_authentication_assurance not in ('aal1', 'aal2') then
    raise exception using
      errcode = 'P0001',
      message = 'authentication assurance level is invalid';
  end if;

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

  if invitation_row.role in ('owner', 'manager')
    and target_authentication_assurance <> 'aal2'
  then
    raise exception using
      errcode = 'P0001',
      message = 'privileged restaurant invitations require aal2';
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
    accepted_at = now(),
    accepted_at_aal = target_authentication_assurance
  where id = invitation_row.id;
end;
$$;

revoke all on function private.validate_restaurant_invitation_auth_assurance() from public;
revoke all on function private.authentication_assurance_allows_role(text) from public;
revoke all on function private.authentication_assurance_allows_role(text) from anon, authenticated;
revoke all on function private.accept_restaurant_invitation(uuid, uuid, text) from public;
revoke all on function private.accept_restaurant_invitation(uuid, uuid, text)
  from anon, authenticated;
grant execute on function private.accept_restaurant_invitation(uuid, uuid, text) to service_role;

comment on column public.restaurant_invitations.accepted_at_aal is
  'Verified Supabase Auth assurance level supplied by the server when the invitation is accepted.';
comment on function private.authentication_assurance_allows_role(text) is
  'Requires aal2 for owner and manager access; kitchen and driver accept aal1 or aal2.';
comment on function private.accept_restaurant_invitation(uuid, uuid, text) is
  'Server-only atomic acceptance after verifying the target user and their Supabase Auth AAL.';
