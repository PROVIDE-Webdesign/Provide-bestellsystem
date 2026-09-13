begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(51);

select has_table(
  'public',
  'restaurant_membership_locations',
  'personnel location assignment table exists'
);
select has_column(
  'public',
  'restaurant_membership_locations',
  'restaurant_id',
  'assignments have a restaurant id'
);
select has_column(
  'public',
  'restaurant_membership_locations',
  'user_id',
  'assignments have a user id'
);
select has_column(
  'public',
  'restaurant_membership_locations',
  'location_id',
  'assignments have a location id'
);
select has_column(
  'public',
  'restaurant_membership_locations',
  'created_at',
  'assignments have a creation timestamp'
);
select has_pk(
  'public',
  'restaurant_membership_locations',
  'assignments have a composite primary key'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_definition
    join pg_catalog.pg_class as relation
      on relation.oid = constraint_definition.conrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'restaurant_memberships'
      and constraint_definition.conname = 'restaurant_memberships_role_allowed'
      and pg_get_constraintdef(constraint_definition.oid) like
        '%owner%manager%kitchen%driver%'
  ),
  'membership roles are limited to the four explicit restaurant roles'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_definition
    join pg_catalog.pg_class as relation
      on relation.oid = constraint_definition.conrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'restaurant_membership_locations'
      and constraint_definition.conname = 'restaurant_membership_locations_membership_fk'
      and constraint_definition.contype = 'f'
  ),
  'assignments require a membership in the same restaurant'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_definition
    join pg_catalog.pg_class as relation
      on relation.oid = constraint_definition.conrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'restaurant_membership_locations'
      and constraint_definition.conname = 'restaurant_membership_locations_location_fk'
      and constraint_definition.contype = 'f'
  ),
  'assignments require a location in the same restaurant'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'restaurant_membership_locations'
  ),
  'personnel location assignments have row level security enabled'
);

select ok(
  (
    select relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'restaurant_membership_locations'
  ),
  'personnel location assignments force row level security'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'restaurant_membership_locations'
  ),
  1,
  'personnel location assignments define exactly one browser policy'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'locations'
      and policyname = 'locations_select_for_authorized_personnel'
  ),
  1,
  'locations use the personnel-aware select policy'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'locations'
      and policyname = 'locations_select_for_restaurant_members'
  ),
  0,
  'the former restaurant-wide location policy is removed'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.restaurant_membership_locations',
    'select,insert,update,delete'
  ),
  'anonymous users have no personnel location privileges'
);
select ok(
  has_table_privilege('authenticated', 'public.restaurant_membership_locations', 'select'),
  'authenticated personnel may read their own assignments through RLS'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.restaurant_membership_locations',
    'insert,update,delete'
  ),
  'authenticated personnel cannot write location assignments directly'
);
select ok(
  has_table_privilege(
    'service_role',
    'public.restaurant_membership_locations',
    'select,insert,update,delete'
  ),
  'the server role can manage personnel location assignments'
);
select ok(
  has_function_privilege(
    'authenticated',
    'private.has_restaurant_role(uuid,text[])',
    'execute'
  ),
  'authenticated personnel may execute the role helper'
);
select ok(
  has_function_privilege(
    'authenticated',
    'private.can_access_location(uuid,uuid)',
    'execute'
  ),
  'authenticated personnel may execute the location helper'
);
select ok(
  not has_function_privilege('anon', 'private.has_restaurant_role(uuid,text[])', 'execute'),
  'anonymous users cannot execute the role helper'
);
select ok(
  not has_function_privilege('anon', 'private.can_access_location(uuid,uuid)', 'execute'),
  'anonymous users cannot execute the location helper'
);

insert into auth.users (id, email)
values
  ('61000000-0000-0000-0000-000000000001', 'personnel-owner@example.invalid'),
  ('61000000-0000-0000-0000-000000000002', 'personnel-manager@example.invalid'),
  ('61000000-0000-0000-0000-000000000003', 'personnel-kitchen@example.invalid'),
  ('61000000-0000-0000-0000-000000000004', 'personnel-driver@example.invalid'),
  ('61000000-0000-0000-0000-000000000005', 'personnel-manager-b@example.invalid'),
  ('61000000-0000-0000-0000-000000000006', 'personnel-stranger@example.invalid');

insert into public.restaurants (id, slug, display_name)
values
  ('62000000-0000-0000-0000-000000000001', 'personnel-restaurant-a', 'Personnel Restaurant A'),
  ('62000000-0000-0000-0000-000000000002', 'personnel-restaurant-b', 'Personnel Restaurant B');

insert into public.restaurant_memberships (restaurant_id, user_id, role)
values
  (
    '62000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000001',
    'owner'
  ),
  (
    '62000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000002',
    'manager'
  ),
  (
    '62000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000003',
    'kitchen'
  ),
  (
    '62000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000004',
    'driver'
  ),
  (
    '62000000-0000-0000-0000-000000000002',
    '61000000-0000-0000-0000-000000000005',
    'manager'
  );

select throws_ok(
  $$
    insert into public.restaurant_memberships (restaurant_id, user_id, role)
    values (
      '62000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000006',
      'staff'
    )
  $$,
  '23514',
  null,
  'the ambiguous legacy staff role is rejected'
);

select throws_ok(
  $$
    insert into public.restaurant_memberships (restaurant_id, user_id, role)
    values (
      '62000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000006',
      'administrator'
    )
  $$,
  '23514',
  null,
  'unknown restaurant roles are rejected'
);

insert into public.locations (id, restaurant_id, slug, display_name)
values
  (
    '63000000-0000-0000-0000-000000000001',
    '62000000-0000-0000-0000-000000000001',
    'aachen-mitte',
    'Aachen Mitte'
  ),
  (
    '63000000-0000-0000-0000-000000000002',
    '62000000-0000-0000-0000-000000000001',
    'aachen-sued',
    'Aachen Sued'
  ),
  (
    '63000000-0000-0000-0000-000000000003',
    '62000000-0000-0000-0000-000000000002',
    'koeln-mitte',
    'Koeln Mitte'
  );

insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
values
  (
    '62000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000002',
    '63000000-0000-0000-0000-000000000001'
  ),
  (
    '62000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000003',
    '63000000-0000-0000-0000-000000000002'
  ),
  (
    '62000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000004',
    '63000000-0000-0000-0000-000000000001'
  ),
  (
    '62000000-0000-0000-0000-000000000002',
    '61000000-0000-0000-0000-000000000005',
    '63000000-0000-0000-0000-000000000003'
  );

select throws_ok(
  $$
    insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
    values (
      '62000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000002',
      '63000000-0000-0000-0000-000000000003'
    )
  $$,
  '23503',
  null,
  'a location from another restaurant cannot be assigned'
);

select throws_ok(
  $$
    insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
    values (
      '62000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000006',
      '63000000-0000-0000-0000-000000000001'
    )
  $$,
  '23503',
  null,
  'a non-member cannot receive a location assignment'
);

select throws_ok(
  $$
    insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
    values (
      '62000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000002',
      '63000000-0000-0000-0000-000000000001'
    )
  $$,
  '23505',
  null,
  'duplicate personnel location assignments are rejected'
);

set local role anon;

select throws_ok(
  $$select * from public.restaurant_membership_locations$$,
  '42501',
  null,
  'anonymous users cannot query personnel location assignments'
);

set local role authenticated;
set local request.jwt.claim.sub = '61000000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"61000000-0000-0000-0000-000000000001","aal":"aal2"}';

select ok(
  private.has_restaurant_role(
    '62000000-0000-0000-0000-000000000001',
    array['owner']::text[]
  ),
  'an owner satisfies the owner role check'
);
select ok(
  not private.has_restaurant_role(
    '62000000-0000-0000-0000-000000000001',
    array['manager']::text[]
  ),
  'an owner does not implicitly satisfy another role check'
);
select ok(
  not private.has_restaurant_role(
    '62000000-0000-0000-0000-000000000001',
    array[]::text[]
  ),
  'an empty role set grants no access'
);
select results_eq(
  $$select display_name from public.locations order by display_name$$,
  array['Aachen Mitte'::text, 'Aachen Sued'::text],
  'an owner sees every location in their restaurant'
);
select is_empty(
  $$select id from public.locations where id = '63000000-0000-0000-0000-000000000003'$$,
  'an owner cannot see another restaurant location'
);
select is_empty(
  $$select location_id from public.restaurant_membership_locations$$,
  'an owner without explicit assignments sees no other personnel assignments'
);
select ok(
  private.can_access_location(
    '62000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000001'
  ),
  'an owner can access a location in their restaurant'
);
select ok(
  not private.can_access_location(
    '62000000-0000-0000-0000-000000000002',
    '63000000-0000-0000-0000-000000000003'
  ),
  'an owner cannot access a location in another restaurant'
);
select ok(
  not private.can_access_location(
    '62000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000003'
  ),
  'a mismatched restaurant and location pair grants no access'
);

set local request.jwt.claim.sub = '61000000-0000-0000-0000-000000000002';
set local request.jwt.claims = '{"sub":"61000000-0000-0000-0000-000000000002","aal":"aal2"}';

select ok(
  private.has_restaurant_role(
    '62000000-0000-0000-0000-000000000001',
    array['manager', 'owner']::text[]
  ),
  'a manager satisfies an allowed manager role check'
);
select results_eq(
  $$select display_name from public.locations order by display_name$$,
  array['Aachen Mitte'::text],
  'a manager sees only explicitly assigned locations'
);
select results_eq(
  $$select location_id from public.restaurant_membership_locations order by location_id$$,
  array['63000000-0000-0000-0000-000000000001'::uuid],
  'a manager sees only their own assignment rows'
);
select is_empty(
  $$select id from public.locations where id = '63000000-0000-0000-0000-000000000002'$$,
  'a manager cannot retrieve an unassigned location by id'
);
select ok(
  private.can_access_location(
    '62000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000001'
  ),
  'a manager can access an assigned location'
);
select ok(
  not private.can_access_location(
    '62000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000002'
  ),
  'a manager cannot access an unassigned location'
);

set local request.jwt.claim.sub = '61000000-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"sub":"61000000-0000-0000-0000-000000000003","aal":"aal2"}';

select results_eq(
  $$select display_name from public.locations order by display_name$$,
  array['Aachen Sued'::text],
  'kitchen personnel see only explicitly assigned locations'
);
select results_eq(
  $$select location_id from public.restaurant_membership_locations order by location_id$$,
  array['63000000-0000-0000-0000-000000000002'::uuid],
  'kitchen personnel see only their own assignment rows'
);

set local request.jwt.claim.sub = '61000000-0000-0000-0000-000000000004';
set local request.jwt.claims = '{"sub":"61000000-0000-0000-0000-000000000004","aal":"aal2"}';

select results_eq(
  $$select display_name from public.locations order by display_name$$,
  array['Aachen Mitte'::text],
  'drivers see only explicitly assigned locations'
);
select results_eq(
  $$select location_id from public.restaurant_membership_locations order by location_id$$,
  array['63000000-0000-0000-0000-000000000001'::uuid],
  'drivers see only their own assignment rows'
);

set local request.jwt.claim.sub = '61000000-0000-0000-0000-000000000005';
set local request.jwt.claims = '{"sub":"61000000-0000-0000-0000-000000000005","aal":"aal2"}';

select results_eq(
  $$select display_name from public.locations order by display_name$$,
  array['Koeln Mitte'::text],
  'personnel in a second restaurant see only their assigned tenant location'
);

set local request.jwt.claim.sub = '61000000-0000-0000-0000-000000000006';
set local request.jwt.claims = '{"sub":"61000000-0000-0000-0000-000000000006","aal":"aal2"}';

select is_empty(
  $$select id from public.locations$$,
  'a signed-in non-member sees no locations'
);
select is_empty(
  $$select location_id from public.restaurant_membership_locations$$,
  'a signed-in non-member sees no personnel assignments'
);
select throws_ok(
  $$
    insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
    values (
      '62000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000006',
      '63000000-0000-0000-0000-000000000001'
    )
  $$,
  '42501',
  null,
  'authenticated browser users cannot create personnel assignments directly'
);

select * from finish();

rollback;
