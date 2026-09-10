begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(79);

select has_table('public', 'restaurant_invitations', 'restaurant invitations table exists');
select has_table(
  'public',
  'restaurant_invitation_locations',
  'restaurant invitation location table exists'
);
select has_column(
  'public',
  'restaurant_memberships',
  'status',
  'memberships have a lifecycle status'
);
select has_column(
  'public',
  'restaurant_memberships',
  'suspended_at',
  'memberships record their suspension time'
);
select has_column(
  'public',
  'restaurant_memberships',
  'updated_at',
  'memberships record their update time'
);
select has_column('public', 'restaurant_invitations', 'id', 'invitations have an id');
select has_column(
  'public',
  'restaurant_invitations',
  'restaurant_id',
  'invitations belong to a restaurant'
);
select has_column(
  'public',
  'restaurant_invitations',
  'invited_user_id',
  'invitations reference the provider auth user'
);
select has_column('public', 'restaurant_invitations', 'email', 'invitations record the email');
select has_column('public', 'restaurant_invitations', 'role', 'invitations record the target role');
select has_column(
  'public',
  'restaurant_invitations',
  'status',
  'invitations have a lifecycle status'
);
select has_column(
  'public',
  'restaurant_invitations',
  'invited_by_user_id',
  'invitations record their creator'
);
select has_column(
  'public',
  'restaurant_invitations',
  'expires_at',
  'invitations have an expiry time'
);
select has_column(
  'public',
  'restaurant_invitations',
  'accepted_at',
  'invitations record acceptance time'
);
select has_column(
  'public',
  'restaurant_invitations',
  'revoked_at',
  'invitations record revocation time'
);
select has_column(
  'public',
  'restaurant_invitation_locations',
  'restaurant_id',
  'invitation location scopes carry the restaurant id'
);
select has_column(
  'public',
  'restaurant_invitation_locations',
  'invitation_id',
  'invitation location scopes reference an invitation'
);
select has_column(
  'public',
  'restaurant_invitation_locations',
  'location_id',
  'invitation location scopes reference a location'
);
select has_trigger(
  'public',
  'restaurant_memberships',
  'restaurant_memberships_enforce_lifecycle',
  'membership lifecycle is enforced by a trigger'
);
select has_trigger(
  'public',
  'restaurant_invitations',
  'restaurant_invitations_validate',
  'invitation lifecycle is enforced by a trigger'
);
select has_trigger(
  'public',
  'restaurant_invitation_locations',
  'restaurant_invitation_locations_validate',
  'invitation location scope is enforced by a trigger'
);

select ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'restaurant_invitations'
  ),
  'restaurant invitations enable and force row level security'
);
select ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'restaurant_invitation_locations'
  ),
  'restaurant invitation locations enable and force row level security'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'restaurant_invitations'
  ),
  0,
  'restaurant invitations expose no browser policy'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'restaurant_invitation_locations'
  ),
  0,
  'restaurant invitation locations expose no browser policy'
);
select ok(
  not has_table_privilege('anon', 'public.restaurant_invitations', 'select,insert,update,delete'),
  'anonymous users have no invitation privileges'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.restaurant_invitations',
    'select,insert,update,delete'
  ),
  'authenticated browser users have no invitation table privileges'
);
select ok(
  has_table_privilege(
    'service_role',
    'public.restaurant_invitations',
    'select,insert,update,delete'
  ),
  'the server role can manage invitations'
);
select ok(
  not has_table_privilege(
    'anon',
    'public.restaurant_invitation_locations',
    'select,insert,update,delete'
  ),
  'anonymous users have no invitation location privileges'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.restaurant_invitation_locations',
    'select,insert,update,delete'
  ),
  'authenticated browser users have no invitation location privileges'
);
select ok(
  has_table_privilege(
    'service_role',
    'public.restaurant_invitation_locations',
    'select,insert,update,delete'
  ),
  'the server role can manage invitation locations'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.accept_restaurant_invitation(uuid,uuid)',
    'execute'
  ),
  'the server role may accept a validated invitation atomically'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.accept_restaurant_invitation(uuid,uuid)',
    'execute'
  ),
  'authenticated browser users cannot call the acceptance function directly'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.accept_restaurant_invitation(uuid,uuid)',
    'execute'
  ),
  'anonymous users cannot call the acceptance function'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'restaurant_invitations'
      and indexname = 'restaurant_invitations_pending_email_unique'
      and indexdef like '%UNIQUE%'
      and indexdef like '%status%'
      and indexdef like '%pending%'
  ),
  'only one pending invitation per restaurant and normalized email is allowed'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_definition
    join pg_catalog.pg_class as relation on relation.oid = constraint_definition.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'restaurant_memberships'
      and constraint_definition.conname = 'restaurant_memberships_status_allowed'
  ),
  'membership lifecycle values are constrained'
);

insert into auth.users (id, email)
values
  ('71000000-0000-0000-0000-000000000001', 'owner-a@example.invalid'),
  ('71000000-0000-0000-0000-000000000002', 'manager-a@example.invalid'),
  ('71000000-0000-0000-0000-000000000003', 'suspended-a@example.invalid'),
  ('71000000-0000-0000-0000-000000000004', 'kitchen-invitee@example.invalid'),
  ('71000000-0000-0000-0000-000000000005', 'driver-invitee@example.invalid'),
  ('71000000-0000-0000-0000-000000000006', 'owner-invitee@example.invalid'),
  ('71000000-0000-0000-0000-000000000007', 'expired-invitee@example.invalid'),
  ('71000000-0000-0000-0000-000000000008', 'no-location@example.invalid'),
  ('71000000-0000-0000-0000-000000000009', 'revoked-invitee@example.invalid'),
  ('71000000-0000-0000-0000-000000000010', 'wrong-user@example.invalid'),
  ('71000000-0000-0000-0000-000000000011', 'owner-b@example.invalid'),
  ('71000000-0000-0000-0000-000000000012', 'manager-target@example.invalid'),
  ('71000000-0000-0000-0000-000000000013', 'other-invitee@example.invalid');

insert into public.restaurants (id, slug, display_name)
values
  ('72000000-0000-0000-0000-000000000001', 'invitation-restaurant-a', 'Invitation A'),
  ('72000000-0000-0000-0000-000000000002', 'invitation-restaurant-b', 'Invitation B');

insert into public.restaurant_memberships (
  restaurant_id,
  user_id,
  role,
  status,
  suspended_at
)
values
  (
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000001',
    'owner',
    'active',
    null
  ),
  (
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000002',
    'manager',
    'active',
    null
  ),
  (
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000003',
    'manager',
    'suspended',
    now()
  ),
  (
    '72000000-0000-0000-0000-000000000002',
    '71000000-0000-0000-0000-000000000011',
    'owner',
    'active',
    null
  );

insert into public.locations (id, restaurant_id, slug, display_name)
values
  (
    '73000000-0000-0000-0000-000000000001',
    '72000000-0000-0000-0000-000000000001',
    'aachen-mitte',
    'Aachen Mitte'
  ),
  (
    '73000000-0000-0000-0000-000000000002',
    '72000000-0000-0000-0000-000000000001',
    'aachen-sued',
    'Aachen Sued'
  ),
  (
    '73000000-0000-0000-0000-000000000003',
    '72000000-0000-0000-0000-000000000002',
    'koeln-mitte',
    'Koeln Mitte'
  );

insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
values
  (
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000002',
    '73000000-0000-0000-0000-000000000001'
  ),
  (
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000003',
    '73000000-0000-0000-0000-000000000001'
  );

select throws_ok(
  $$
    insert into public.restaurant_memberships (restaurant_id, user_id, role, status)
    values (
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000013',
      'driver',
      'disabled'
    )
  $$,
  '23514',
  null,
  'unknown membership lifecycle values are rejected'
);

select throws_ok(
  $$
    insert into public.restaurant_invitations (
      restaurant_id,
      invited_user_id,
      email,
      role,
      invited_by_user_id,
      expires_at
    ) values (
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000004',
      'Kitchen-Invitee@example.invalid',
      'kitchen',
      '71000000-0000-0000-0000-000000000001',
      now() + interval '7 days'
    )
  $$,
  '23514',
  null,
  'invitation emails must be normalized'
);

select throws_ok(
  $$
    insert into public.restaurant_invitations (
      restaurant_id,
      invited_user_id,
      email,
      role,
      invited_by_user_id,
      expires_at
    ) values (
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000004',
      'wrong-address@example.invalid',
      'kitchen',
      '71000000-0000-0000-0000-000000000001',
      now() + interval '7 days'
    )
  $$,
  '23514',
  'restaurant invitation email must match the invited auth user',
  'invitation email must match the provider auth identity'
);

select throws_ok(
  $$
    insert into public.restaurant_invitations (
      restaurant_id,
      invited_user_id,
      email,
      role,
      invited_by_user_id,
      expires_at
    ) values (
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000002',
      'manager-a@example.invalid',
      'manager',
      '71000000-0000-0000-0000-000000000001',
      now() + interval '7 days'
    )
  $$,
  '23505',
  'the invited user already has a restaurant membership',
  'existing restaurant members cannot be invited again'
);

select throws_ok(
  $$
    insert into public.restaurant_invitations (
      restaurant_id,
      invited_user_id,
      email,
      role,
      invited_by_user_id,
      expires_at
    ) values (
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000013',
      'other-invitee@example.invalid',
      'driver',
      '71000000-0000-0000-0000-000000000003',
      now() + interval '7 days'
    )
  $$,
  '42501',
  'only active restaurant personnel may create or revoke invitations',
  'suspended personnel cannot create invitations'
);

select throws_ok(
  $$
    insert into public.restaurant_invitations (
      restaurant_id,
      invited_user_id,
      email,
      role,
      invited_by_user_id,
      expires_at
    ) values (
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000013',
      'other-invitee@example.invalid',
      'driver',
      '71000000-0000-0000-0000-000000000011',
      now() + interval '7 days'
    )
  $$,
  '42501',
  'only active restaurant personnel may create or revoke invitations',
  'personnel from another tenant cannot create invitations'
);

select throws_ok(
  $$
    insert into public.restaurant_invitations (
      restaurant_id,
      invited_user_id,
      email,
      role,
      invited_by_user_id,
      expires_at
    ) values (
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000012',
      'manager-target@example.invalid',
      'manager',
      '71000000-0000-0000-0000-000000000002',
      now() + interval '7 days'
    )
  $$,
  '42501',
  'managers may invite only kitchen personnel or drivers',
  'managers cannot invite privileged roles'
);

select throws_ok(
  $$
    insert into public.restaurant_invitations (
      restaurant_id,
      invited_user_id,
      email,
      role,
      status,
      invited_by_user_id,
      accepted_by_user_id,
      expires_at,
      accepted_at
    ) values (
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000013',
      'other-invitee@example.invalid',
      'driver',
      'accepted',
      '71000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000013',
      now() + interval '7 days',
      now()
    )
  $$,
  '23514',
  'a restaurant invitation must start as pending',
  'invitations cannot be inserted as already accepted'
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
    '74000000-0000-0000-0000-000000000001',
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000004',
    'kitchen-invitee@example.invalid',
    'kitchen',
    '71000000-0000-0000-0000-000000000001',
    now() + interval '7 days'
  ),
  (
    '74000000-0000-0000-0000-000000000002',
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000005',
    'driver-invitee@example.invalid',
    'driver',
    '71000000-0000-0000-0000-000000000002',
    now() + interval '7 days'
  ),
  (
    '74000000-0000-0000-0000-000000000003',
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000006',
    'owner-invitee@example.invalid',
    'owner',
    '71000000-0000-0000-0000-000000000001',
    now() + interval '7 days'
  ),
  (
    '74000000-0000-0000-0000-000000000005',
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000008',
    'no-location@example.invalid',
    'driver',
    '71000000-0000-0000-0000-000000000001',
    now() + interval '7 days'
  ),
  (
    '74000000-0000-0000-0000-000000000006',
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000009',
    'revoked-invitee@example.invalid',
    'kitchen',
    '71000000-0000-0000-0000-000000000001',
    now() + interval '7 days'
  );

insert into public.restaurant_invitations (
  id,
  restaurant_id,
  invited_user_id,
  email,
  role,
  invited_by_user_id,
  expires_at,
  created_at
)
values (
  '74000000-0000-0000-0000-000000000004',
  '72000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000007',
  'expired-invitee@example.invalid',
  'driver',
  '71000000-0000-0000-0000-000000000001',
  now() - interval '1 day',
  now() - interval '2 days'
);

select is(
  (
    select status
    from public.restaurant_invitations
    where id = '74000000-0000-0000-0000-000000000001'
  ),
  'pending',
  'new invitations start pending'
);

select throws_ok(
  $$
    insert into public.restaurant_invitations (
      restaurant_id,
      invited_user_id,
      email,
      role,
      invited_by_user_id,
      expires_at
    ) values (
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000004',
      'kitchen-invitee@example.invalid',
      'driver',
      '71000000-0000-0000-0000-000000000001',
      now() + interval '7 days'
    )
  $$,
  '23505',
  null,
  'a restaurant cannot have duplicate pending invitations for one email'
);

insert into public.restaurant_invitation_locations (restaurant_id, invitation_id, location_id)
values
  (
    '72000000-0000-0000-0000-000000000001',
    '74000000-0000-0000-0000-000000000001',
    '73000000-0000-0000-0000-000000000002'
  ),
  (
    '72000000-0000-0000-0000-000000000001',
    '74000000-0000-0000-0000-000000000002',
    '73000000-0000-0000-0000-000000000001'
  ),
  (
    '72000000-0000-0000-0000-000000000001',
    '74000000-0000-0000-0000-000000000004',
    '73000000-0000-0000-0000-000000000001'
  ),
  (
    '72000000-0000-0000-0000-000000000001',
    '74000000-0000-0000-0000-000000000006',
    '73000000-0000-0000-0000-000000000002'
  );

select throws_ok(
  $$
    insert into public.restaurant_invitation_locations (restaurant_id, invitation_id, location_id)
    values (
      '72000000-0000-0000-0000-000000000001',
      '74000000-0000-0000-0000-000000000003',
      '73000000-0000-0000-0000-000000000001'
    )
  $$,
  '23514',
  'owner invitations must not contain location assignments',
  'owner invitations cannot be restricted to individual locations'
);

select throws_ok(
  $$
    insert into public.restaurant_invitation_locations (restaurant_id, invitation_id, location_id)
    values (
      '72000000-0000-0000-0000-000000000001',
      '74000000-0000-0000-0000-000000000002',
      '73000000-0000-0000-0000-000000000002'
    )
  $$,
  '42501',
  'a manager may assign only locations they can access',
  'managers cannot invite personnel into unassigned locations'
);

select throws_ok(
  $$
    insert into public.restaurant_invitation_locations (restaurant_id, invitation_id, location_id)
    values (
      '72000000-0000-0000-0000-000000000001',
      '74000000-0000-0000-0000-000000000001',
      '73000000-0000-0000-0000-000000000003'
    )
  $$,
  '23503',
  null,
  'invitation locations cannot cross the restaurant boundary'
);

set local role anon;

select throws_ok(
  $$select * from public.restaurant_invitations$$,
  '42501',
  null,
  'anonymous users cannot read invitations'
);

set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000004';

select throws_ok(
  $$select * from public.restaurant_invitations$$,
  '42501',
  null,
  'authenticated browser users cannot read invitations'
);
select throws_ok(
  $$
    select private.accept_restaurant_invitation(
      '74000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000004'
    )
  $$,
  '42501',
  null,
  'authenticated browser users cannot execute invitation acceptance directly'
);

reset role;
set local role service_role;

select throws_ok(
  $$
    select private.accept_restaurant_invitation(
      '74000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000010'
    )
  $$,
  'P0001',
  'restaurant invitation user mismatch',
  'an invitation cannot be accepted for another auth user'
);
select throws_ok(
  $$
    select private.accept_restaurant_invitation(
      '74000000-0000-0000-0000-000000000004',
      '71000000-0000-0000-0000-000000000007'
    )
  $$,
  'P0001',
  'restaurant invitation is expired',
  'expired invitations cannot be accepted'
);
select throws_ok(
  $$
    select private.accept_restaurant_invitation(
      '74000000-0000-0000-0000-000000000005',
      '71000000-0000-0000-0000-000000000008'
    )
  $$,
  'P0001',
  'restaurant invitation requires a location assignment',
  'non-owner invitations require at least one location'
);

select lives_ok(
  $$
    select private.accept_restaurant_invitation(
      '74000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000004'
    )
  $$,
  'the server accepts a valid owner-created invitation atomically'
);
select is(
  (
    select role
    from public.restaurant_memberships
    where restaurant_id = '72000000-0000-0000-0000-000000000001'
      and user_id = '71000000-0000-0000-0000-000000000004'
  ),
  'kitchen',
  'acceptance creates the intended restaurant membership role'
);
select is(
  (
    select status
    from public.restaurant_memberships
    where restaurant_id = '72000000-0000-0000-0000-000000000001'
      and user_id = '71000000-0000-0000-0000-000000000004'
  ),
  'active',
  'accepted memberships start active'
);
select results_eq(
  $$
    select location_id
    from public.restaurant_membership_locations
    where restaurant_id = '72000000-0000-0000-0000-000000000001'
      and user_id = '71000000-0000-0000-0000-000000000004'
  $$,
  array['73000000-0000-0000-0000-000000000002'::uuid],
  'acceptance copies the invitation location scope'
);
select is(
  (
    select status
    from public.restaurant_invitations
    where id = '74000000-0000-0000-0000-000000000001'
  ),
  'accepted',
  'accepted invitations reach their terminal status'
);
select throws_ok(
  $$
    select private.accept_restaurant_invitation(
      '74000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000004'
    )
  $$,
  'P0001',
  'restaurant invitation is not pending',
  'accepted invitations cannot be reused'
);

select lives_ok(
  $$
    select private.accept_restaurant_invitation(
      '74000000-0000-0000-0000-000000000002',
      '71000000-0000-0000-0000-000000000005'
    )
  $$,
  'a manager invitation works inside the manager location scope'
);
select results_eq(
  $$
    select location_id
    from public.restaurant_membership_locations
    where restaurant_id = '72000000-0000-0000-0000-000000000001'
      and user_id = '71000000-0000-0000-0000-000000000005'
  $$,
  array['73000000-0000-0000-0000-000000000001'::uuid],
  'manager invitation acceptance copies only the authorized location'
);
select lives_ok(
  $$
    select private.accept_restaurant_invitation(
      '74000000-0000-0000-0000-000000000003',
      '71000000-0000-0000-0000-000000000006'
    )
  $$,
  'an owner invitation needs no individual location assignment'
);

reset role;

update public.restaurant_invitations
set
  status = 'revoked',
  revoked_by_user_id = '71000000-0000-0000-0000-000000000001',
  revoked_at = now()
where id = '74000000-0000-0000-0000-000000000006';

select is(
  (
    select status
    from public.restaurant_invitations
    where id = '74000000-0000-0000-0000-000000000006'
  ),
  'revoked',
  'an authorized owner can revoke a pending invitation'
);

set local role service_role;

select throws_ok(
  $$
    select private.accept_restaurant_invitation(
      '74000000-0000-0000-0000-000000000006',
      '71000000-0000-0000-0000-000000000009'
    )
  $$,
  'P0001',
  'restaurant invitation is not pending',
  'revoked invitations cannot be accepted'
);

reset role;

select throws_ok(
  $$
    update public.restaurant_invitations
    set email = 'changed@example.invalid'
    where id = '74000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'a completed restaurant invitation is immutable',
  'completed invitation records cannot be rewritten'
);

set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000002';

select ok(
  private.is_restaurant_member('72000000-0000-0000-0000-000000000001'),
  'an active manager is an authorized restaurant member'
);
select ok(
  private.can_access_location(
    '72000000-0000-0000-0000-000000000001',
    '73000000-0000-0000-0000-000000000001'
  ),
  'an active manager can access their assigned location'
);

reset role;

update public.restaurant_memberships
set status = 'suspended'
where restaurant_id = '72000000-0000-0000-0000-000000000001'
  and user_id = '71000000-0000-0000-0000-000000000002';

select ok(
  (
    select suspended_at is not null
    from public.restaurant_memberships
    where restaurant_id = '72000000-0000-0000-0000-000000000001'
      and user_id = '71000000-0000-0000-0000-000000000002'
  ),
  'suspension automatically records its timestamp'
);

set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000002';

select ok(
  not private.is_restaurant_member('72000000-0000-0000-0000-000000000001'),
  'a suspended manager is no longer an authorized restaurant member'
);
select ok(
  not private.has_restaurant_role(
    '72000000-0000-0000-0000-000000000001',
    array['manager']::text[]
  ),
  'a suspended manager no longer satisfies role checks'
);
select ok(
  not private.can_access_location(
    '72000000-0000-0000-0000-000000000001',
    '73000000-0000-0000-0000-000000000001'
  ),
  'a suspended manager immediately loses location access'
);
select is_empty(
  $$select id from public.restaurants$$,
  'a suspended manager cannot read their restaurant'
);
select is_empty(
  $$select id from public.locations$$,
  'a suspended manager cannot read assigned locations'
);
select is_empty(
  $$select location_id from public.restaurant_membership_locations$$,
  'a suspended manager cannot read former location assignments'
);
select results_eq(
  $$select status from public.restaurant_memberships$$,
  array['suspended'::text],
  'a suspended user may still read their own lifecycle state'
);

reset role;

update public.restaurant_memberships
set status = 'active'
where restaurant_id = '72000000-0000-0000-0000-000000000001'
  and user_id = '71000000-0000-0000-0000-000000000002';

select ok(
  (
    select suspended_at is null
    from public.restaurant_memberships
    where restaurant_id = '72000000-0000-0000-0000-000000000001'
      and user_id = '71000000-0000-0000-0000-000000000002'
  ),
  'reactivation clears the suspension timestamp'
);

set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000002';

select ok(
  private.can_access_location(
    '72000000-0000-0000-0000-000000000001',
    '73000000-0000-0000-0000-000000000001'
  ),
  'reactivation restores the existing location scope'
);

select * from finish();

rollback;
