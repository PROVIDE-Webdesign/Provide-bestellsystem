begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(56);

select has_column(
  'public',
  'restaurant_invitations',
  'accepted_at_aal',
  'accepted invitations record the verified authentication assurance level'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_definition
    join pg_catalog.pg_class as relation on relation.oid = constraint_definition.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'restaurant_invitations'
      and constraint_definition.conname = 'restaurant_invitations_accepted_at_aal_allowed'
  ),
  'recorded authentication assurance levels are constrained'
);
select has_trigger(
  'public',
  'restaurant_invitations',
  'restaurant_invitations_validate_auth_assurance',
  'invitation acceptance assurance is protected by a trigger'
);
select has_function(
  'private',
  'authentication_assurance_allows_role',
  array['text'],
  'restaurant role assurance helper exists'
);
select has_function(
  'private',
  'accept_restaurant_invitation',
  array['uuid', 'uuid', 'text'],
  'invitation acceptance requires a verified assurance level'
);
select ok(
  to_regprocedure('private.accept_restaurant_invitation(uuid,uuid)') is null,
  'the former acceptance function without assurance evidence is removed'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.accept_restaurant_invitation(uuid,uuid,text)',
    'execute'
  ),
  'the server role may execute assurance-aware invitation acceptance'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.accept_restaurant_invitation(uuid,uuid,text)',
    'execute'
  ),
  'authenticated browser users cannot execute invitation acceptance'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.accept_restaurant_invitation(uuid,uuid,text)',
    'execute'
  ),
  'anonymous users cannot execute invitation acceptance'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.authentication_assurance_allows_role(text)',
    'execute'
  ),
  'anonymous users cannot execute the internal assurance helper'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger as trigger_definition
    join pg_catalog.pg_class as relation on relation.oid = trigger_definition.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'restaurant_invitations'
      and trigger_definition.tgname = 'restaurant_invitations_validate_auth_assurance'
      and not trigger_definition.tgisinternal
  ),
  1,
  'exactly one assurance validation trigger protects invitations'
);

insert into auth.users (id, email)
values
  ('81000000-0000-0000-0000-000000000001', 'auth-owner-a@example.invalid'),
  ('81000000-0000-0000-0000-000000000002', 'auth-manager-a@example.invalid'),
  ('81000000-0000-0000-0000-000000000003', 'auth-kitchen-a@example.invalid'),
  ('81000000-0000-0000-0000-000000000004', 'auth-driver-a@example.invalid'),
  ('81000000-0000-0000-0000-000000000005', 'auth-suspended-owner@example.invalid'),
  ('81000000-0000-0000-0000-000000000006', 'auth-manager-b@example.invalid'),
  ('81000000-0000-0000-0000-000000000007', 'auth-invited-manager@example.invalid'),
  ('81000000-0000-0000-0000-000000000008', 'auth-invited-kitchen@example.invalid');

insert into public.restaurants (id, slug, display_name)
values
  ('82000000-0000-0000-0000-000000000001', 'auth-restaurant-a', 'Auth Restaurant A'),
  ('82000000-0000-0000-0000-000000000002', 'auth-restaurant-b', 'Auth Restaurant B');

insert into public.restaurant_memberships (
  restaurant_id,
  user_id,
  role,
  status,
  suspended_at
)
values
  (
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    'owner',
    'active',
    null
  ),
  (
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000002',
    'manager',
    'active',
    null
  ),
  (
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000003',
    'kitchen',
    'active',
    null
  ),
  (
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000004',
    'driver',
    'active',
    null
  ),
  (
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000005',
    'owner',
    'suspended',
    now()
  ),
  (
    '82000000-0000-0000-0000-000000000002',
    '81000000-0000-0000-0000-000000000006',
    'manager',
    'active',
    null
  );

insert into public.locations (id, restaurant_id, slug, display_name)
values
  (
    '83000000-0000-0000-0000-000000000001',
    '82000000-0000-0000-0000-000000000001',
    'auth-aachen-mitte',
    'Auth Aachen Mitte'
  ),
  (
    '83000000-0000-0000-0000-000000000002',
    '82000000-0000-0000-0000-000000000001',
    'auth-aachen-sued',
    'Auth Aachen Sued'
  ),
  (
    '83000000-0000-0000-0000-000000000003',
    '82000000-0000-0000-0000-000000000002',
    'auth-koeln-mitte',
    'Auth Koeln Mitte'
  );

insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
values
  (
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000002',
    '83000000-0000-0000-0000-000000000001'
  ),
  (
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000003',
    '83000000-0000-0000-0000-000000000002'
  ),
  (
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000004',
    '83000000-0000-0000-0000-000000000001'
  ),
  (
    '82000000-0000-0000-0000-000000000002',
    '81000000-0000-0000-0000-000000000006',
    '83000000-0000-0000-0000-000000000003'
  );

insert into public.restaurant_invitations (
  id,
  restaurant_id,
  invited_user_id,
  email,
  role,
  invited_by_user_id,
  expires_at
)
values
  (
    '84000000-0000-0000-0000-000000000001',
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000007',
    'auth-invited-manager@example.invalid',
    'manager',
    '81000000-0000-0000-0000-000000000001',
    now() + interval '7 days'
  ),
  (
    '84000000-0000-0000-0000-000000000002',
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000008',
    'auth-invited-kitchen@example.invalid',
    'kitchen',
    '81000000-0000-0000-0000-000000000001',
    now() + interval '7 days'
  );

insert into public.restaurant_invitation_locations (restaurant_id, invitation_id, location_id)
values
  (
    '82000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001'
  ),
  (
    '82000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000002',
    '83000000-0000-0000-0000-000000000002'
  );

select throws_ok(
  $$
    update public.restaurant_invitations
    set accepted_at_aal = 'aal1'
    where id = '84000000-0000-0000-0000-000000000002'
  $$,
  '23514',
  'only accepted invitations may record an authentication assurance level',
  'pending invitations cannot claim an acceptance assurance level'
);

set local role service_role;

select throws_ok(
  $$
    select private.accept_restaurant_invitation(
      '84000000-0000-0000-0000-000000000001',
      '81000000-0000-0000-0000-000000000007',
      'aal3'
    )
  $$,
  'P0001',
  'authentication assurance level is invalid',
  'unknown authentication assurance levels are rejected'
);
select throws_ok(
  $$
    select private.accept_restaurant_invitation(
      '84000000-0000-0000-0000-000000000001',
      '81000000-0000-0000-0000-000000000007',
      'aal1'
    )
  $$,
  'P0001',
  'privileged restaurant invitations require aal2',
  'manager invitations cannot be accepted after only primary authentication'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-0000-0000-000000000007';
set local request.jwt.claims = '{"sub":"81000000-0000-0000-0000-000000000007","aal":"aal2"}';

select throws_ok(
  $$
    select private.accept_restaurant_invitation(
      '84000000-0000-0000-0000-000000000001',
      '81000000-0000-0000-0000-000000000007',
      'aal2'
    )
  $$,
  '42501',
  null,
  'browser users cannot bypass server-side invitation acceptance'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    select private.accept_restaurant_invitation(
      '84000000-0000-0000-0000-000000000001',
      '81000000-0000-0000-0000-000000000007',
      'aal2'
    )
  $$,
  'the server accepts a privileged invitation only with aal2'
);
select is(
  (
    select role
    from public.restaurant_memberships
    where restaurant_id = '82000000-0000-0000-0000-000000000001'
      and user_id = '81000000-0000-0000-0000-000000000007'
  ),
  'manager',
  'privileged acceptance creates the intended manager membership'
);
select is(
  (
    select accepted_at_aal
    from public.restaurant_invitations
    where id = '84000000-0000-0000-0000-000000000001'
  ),
  'aal2',
  'privileged acceptance records aal2 evidence'
);
select lives_ok(
  $$
    select private.accept_restaurant_invitation(
      '84000000-0000-0000-0000-000000000002',
      '81000000-0000-0000-0000-000000000008',
      'aal1'
    )
  $$,
  'the server accepts a kitchen invitation with aal1'
);
select is(
  (
    select accepted_at_aal
    from public.restaurant_invitations
    where id = '84000000-0000-0000-0000-000000000002'
  ),
  'aal1',
  'non-privileged acceptance records aal1 evidence'
);
select results_eq(
  $$
    select location_id
    from public.restaurant_membership_locations
    where restaurant_id = '82000000-0000-0000-0000-000000000001'
      and user_id = '81000000-0000-0000-0000-000000000008'
  $$,
  array['83000000-0000-0000-0000-000000000002'::uuid],
  'non-privileged acceptance copies only its authorized location'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"81000000-0000-0000-0000-000000000001","aal":"aal1"}';

select ok(
  not private.is_restaurant_member('82000000-0000-0000-0000-000000000001'),
  'an owner with aal1 does not satisfy restaurant authorization'
);
select ok(
  not private.has_restaurant_role(
    '82000000-0000-0000-0000-000000000001',
    array['owner']::text[]
  ),
  'an owner with aal1 does not satisfy the owner role check'
);
select ok(
  not private.can_access_location(
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001'
  ),
  'an owner with aal1 cannot access a restaurant location'
);
select is_empty(
  $$select id from public.restaurants$$,
  'an owner with aal1 cannot read restaurant data'
);
select is_empty(
  $$select id from public.locations$$,
  'an owner with aal1 cannot read location data'
);
select is_empty(
  $$select location_id from public.restaurant_membership_locations$$,
  'an owner with aal1 cannot read location assignment data'
);
select results_eq(
  $$select role from public.restaurant_memberships$$,
  array['owner'::text],
  'an owner with aal1 can read only their own membership state for MFA routing'
);

set local request.jwt.claims = '{"sub":"81000000-0000-0000-0000-000000000001","aal":"aal2"}';

select ok(
  private.is_restaurant_member('82000000-0000-0000-0000-000000000001'),
  'an owner with aal2 satisfies restaurant authorization'
);
select ok(
  private.has_restaurant_role(
    '82000000-0000-0000-0000-000000000001',
    array['owner']::text[]
  ),
  'an owner with aal2 satisfies the owner role check'
);
select ok(
  private.can_access_location(
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001'
  ),
  'an owner with aal2 can access the first restaurant location'
);
select ok(
  private.can_access_location(
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000002'
  ),
  'an owner with aal2 can access every location in their restaurant'
);
select results_eq(
  $$select slug from public.restaurants$$,
  array['auth-restaurant-a'::text],
  'an owner with aal2 sees only their restaurant'
);
select results_eq(
  $$select display_name from public.locations order by display_name$$,
  array['Auth Aachen Mitte'::text, 'Auth Aachen Sued'::text],
  'an owner with aal2 sees every location in their restaurant'
);
select ok(
  not private.can_access_location(
    '82000000-0000-0000-0000-000000000002',
    '83000000-0000-0000-0000-000000000003'
  ),
  'aal2 never bypasses the restaurant boundary'
);

set local request.jwt.claim.sub = '81000000-0000-0000-0000-000000000002';
set local request.jwt.claims = '{"sub":"81000000-0000-0000-0000-000000000002","aal":"aal1"}';

select ok(
  not private.is_restaurant_member('82000000-0000-0000-0000-000000000001'),
  'a manager with aal1 does not satisfy restaurant authorization'
);
select is_empty(
  $$select id from public.locations$$,
  'a manager with aal1 cannot read assigned locations'
);

set local request.jwt.claims = '{"sub":"81000000-0000-0000-0000-000000000002","aal":"aal2"}';

select ok(
  private.is_restaurant_member('82000000-0000-0000-0000-000000000001'),
  'a manager with aal2 satisfies restaurant authorization'
);
select ok(
  private.has_restaurant_role(
    '82000000-0000-0000-0000-000000000001',
    array['manager']::text[]
  ),
  'a manager with aal2 satisfies the manager role check'
);
select ok(
  private.can_access_location(
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001'
  ),
  'a manager with aal2 can access an assigned location'
);
select ok(
  not private.can_access_location(
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000002'
  ),
  'a manager with aal2 cannot access an unassigned location'
);
select results_eq(
  $$select display_name from public.locations$$,
  array['Auth Aachen Mitte'::text],
  'a manager with aal2 sees only assigned locations'
);
select ok(
  not private.can_access_location(
    '82000000-0000-0000-0000-000000000002',
    '83000000-0000-0000-0000-000000000003'
  ),
  'a manager with aal2 cannot cross the tenant boundary'
);

set local request.jwt.claim.sub = '81000000-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"sub":"81000000-0000-0000-0000-000000000003","aal":"aal1"}';

select ok(
  private.is_restaurant_member('82000000-0000-0000-0000-000000000001'),
  'kitchen personnel may use their active membership with aal1'
);
select ok(
  private.can_access_location(
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000002'
  ),
  'kitchen personnel with aal1 can access their assigned location'
);
select ok(
  not private.can_access_location(
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001'
  ),
  'kitchen personnel with aal1 cannot access another location'
);
select results_eq(
  $$select display_name from public.locations$$,
  array['Auth Aachen Sued'::text],
  'kitchen personnel with aal1 see only their assigned location'
);

set local request.jwt.claim.sub = '81000000-0000-0000-0000-000000000004';
set local request.jwt.claims = '{"sub":"81000000-0000-0000-0000-000000000004"}';

select ok(
  private.is_restaurant_member('82000000-0000-0000-0000-000000000001'),
  'a missing aal claim is treated as aal1 for a driver'
);
select ok(
  private.can_access_location(
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001'
  ),
  'a driver without an aal claim keeps aal1 location access'
);

set local request.jwt.claims = '{"sub":"81000000-0000-0000-0000-000000000004","aal":"aal3"}';

select ok(
  not private.is_restaurant_member('82000000-0000-0000-0000-000000000001'),
  'an unknown aal claim grants no restaurant access'
);
select is_empty(
  $$select id from public.locations$$,
  'an unknown aal claim grants no location access'
);

set local request.jwt.claim.sub = '81000000-0000-0000-0000-000000000005';
set local request.jwt.claims = '{"sub":"81000000-0000-0000-0000-000000000005","aal":"aal2"}';

select ok(
  not private.is_restaurant_member('82000000-0000-0000-0000-000000000001'),
  'a suspended owner remains unauthorized with aal2'
);
select is_empty(
  $$select id from public.restaurants$$,
  'aal2 never bypasses a suspended membership'
);

set local request.jwt.claim.sub = '81000000-0000-0000-0000-000000000006';
set local request.jwt.claims = '{"sub":"81000000-0000-0000-0000-000000000006","aal":"aal2"}';

select results_eq(
  $$select display_name from public.locations$$,
  array['Auth Koeln Mitte'::text],
  'a second restaurant manager with aal2 sees only their assigned tenant location'
);
select ok(
  not private.can_access_location(
    '82000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001'
  ),
  'a second restaurant manager cannot cross into another tenant'
);

reset role;
set local role anon;

select throws_ok(
  $$select private.is_restaurant_member('82000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'anonymous users cannot execute restaurant authorization helpers'
);

select * from finish();

rollback;
