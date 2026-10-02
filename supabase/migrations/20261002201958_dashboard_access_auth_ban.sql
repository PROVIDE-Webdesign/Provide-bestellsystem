-- R20-01: a still-valid JWT must not expose access profiles for an Auth-banned user.
-- Keep the existing valid empty-context contract, membership data, role/AAL gates and ACLs.
create or replace function private.read_dashboard_access_context(
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  memberships jsonb;
begin
  if target_actor_user_id is null
    or target_authentication_assurance not in ('aal1', 'aal2')
  then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'restaurantId', membership.restaurant_id,
        'role', membership.role,
        'status', membership.status,
        'access', case
          when membership.status = 'suspended' then 'suspended'
          when membership.role in ('owner', 'manager')
            and target_authentication_assurance <> 'aal2' then 'mfa_required'
          else 'allowed'
        end,
        'restaurant', case
          when membership.status = 'active'
            and (
              membership.role in ('kitchen', 'driver', 'viewer')
              or target_authentication_assurance = 'aal2'
            )
          then jsonb_build_object(
            'slug', restaurant.slug,
            'displayName', left(btrim(restaurant.display_name), 160)
          )
          else 'null'::jsonb
        end,
        'locations', case
          when membership.status = 'active'
            and (
              membership.role in ('kitchen', 'driver', 'viewer')
              or target_authentication_assurance = 'aal2'
            )
          then coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id', location.id,
                  'slug', location.slug,
                  'displayName', left(btrim(location.display_name), 160)
                )
                order by location.display_name, location.id
              )
              from public.locations as location
              where location.restaurant_id = membership.restaurant_id
                and (
                  membership.role = 'owner'
                  or exists (
                    select 1
                    from public.restaurant_membership_locations as assignment
                    where assignment.restaurant_id = membership.restaurant_id
                      and assignment.user_id = membership.user_id
                      and assignment.location_id = location.id
                  )
                )
            ),
            '[]'::jsonb
          )
          else '[]'::jsonb
        end
      )
      order by membership.restaurant_id
    ),
    '[]'::jsonb
  )
  into memberships
  from public.restaurant_memberships as membership
  join public.restaurants as restaurant on restaurant.id = membership.restaurant_id
  join auth.users as actor on actor.id = membership.user_id
  where membership.user_id = target_actor_user_id
    and (actor.banned_until is null or actor.banned_until <= statement_timestamp());

  return jsonb_build_object(
    'aal', target_authentication_assurance,
    'memberships', memberships
  );
end;
$$;
