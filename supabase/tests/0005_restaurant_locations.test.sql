begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(39);

select has_table('public', 'locations', 'locations table exists');
select has_column('public', 'locations', 'id', 'locations have an id');
select has_column('public', 'locations', 'restaurant_id', 'locations have a restaurant id');
select has_column('public', 'locations', 'slug', 'locations have a slug');
select has_column('public', 'locations', 'display_name', 'locations have a display name');
select has_column('public', 'locations', 'status', 'locations have a status');
select has_column('public', 'locations', 'timezone', 'locations have a timezone');
select has_column('public', 'locations', 'address_line_1', 'locations have a first address line');
select has_column('public', 'locations', 'address_line_2', 'locations have a second address line');
select has_column('public', 'locations', 'postal_code', 'locations have a postal code');
select has_column('public', 'locations', 'city', 'locations have a city');
select has_column('public', 'locations', 'country_code', 'locations have a country code');
select has_column('public', 'locations', 'created_at', 'locations have a creation timestamp');
select has_column('public', 'locations', 'updated_at', 'locations have an update timestamp');
select has_pk('public', 'locations', 'locations have a primary key');
select has_trigger(
  'public',
  'locations',
  'locations_prevent_restaurant_change',
  'locations prevent restaurant reassignment'
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
      and relation.relname = 'locations'
      and constraint_definition.contype = 'f'
      and pg_get_constraintdef(constraint_definition.oid) like
        'FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)%'
  ),
  'locations reference their restaurant'
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
      and relation.relname = 'locations'
      and constraint_definition.conname = 'locations_restaurant_id_id_unique'
      and constraint_definition.contype = 'u'
  ),
  'locations expose a composite tenant key for later foreign keys'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'locations'
  ),
  'locations have row level security enabled'
);

select ok(
  (
    select relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'locations'
  ),
  'locations force row level security'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'locations'
  ),
  1,
  'locations define exactly one authenticated policy'
);

select ok(
  not has_table_privilege('anon', 'public.locations', 'select,insert,update,delete'),
  'anonymous users have no location privileges'
);
select ok(
  has_table_privilege('authenticated', 'public.locations', 'select'),
  'authenticated users may read locations through RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.locations', 'insert,update,delete'),
  'authenticated users cannot write locations directly'
);
select ok(
  has_table_privilege('service_role', 'public.locations', 'select,insert,update,delete'),
  'the server role can manage locations'
);

insert into auth.users (id, email)
values
  ('33333333-3333-3333-3333-333333333333', 'location-member-a@example.invalid'),
  ('44444444-4444-4444-4444-444444444444', 'location-member-b@example.invalid'),
  ('55555555-5555-5555-5555-555555555555', 'location-stranger@example.invalid');

insert into public.restaurants (id, slug, display_name)
values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'location-restaurant-a', 'Location Restaurant A'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'location-restaurant-b', 'Location Restaurant B');

insert into public.restaurant_memberships (restaurant_id, user_id, role)
values
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '33333333-3333-3333-3333-333333333333',
    'owner'
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    '44444444-4444-4444-4444-444444444444',
    'manager'
  );

insert into public.locations (
  id,
  restaurant_id,
  slug,
  display_name,
  address_line_1,
  postal_code,
  city,
  country_code
)
values
  (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'hauptstandort',
    'Hauptstandort A',
    'Teststrasse 1',
    '52066',
    'Aachen',
    'DE'
  ),
  (
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'hauptstandort',
    'Hauptstandort B',
    'Teststrasse 2',
    '52070',
    'Aachen',
    'DE'
  );

select is(
  (select count(*)::integer from public.locations where slug = 'hauptstandort'),
  2,
  'the same location slug is allowed in different restaurants'
);

select throws_ok(
  $$
    insert into public.locations (restaurant_id, slug, display_name)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'hauptstandort', 'Duplicate')
  $$,
  '23505',
  null,
  'a location slug is unique inside one restaurant'
);

select throws_ok(
  $$
    insert into public.locations (restaurant_id, slug, display_name)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Invalid Slug', 'Invalid slug')
  $$,
  '23514',
  null,
  'location slugs follow the stable URL format'
);

select throws_ok(
  $$
    insert into public.locations (restaurant_id, slug, display_name)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'blank-name', '   ')
  $$,
  '23514',
  null,
  'location display names cannot be blank'
);

select throws_ok(
  $$
    insert into public.locations (restaurant_id, slug, display_name, status)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'invalid-status', 'Invalid status', 'live')
  $$,
  '23514',
  null,
  'location status values are controlled'
);

select throws_ok(
  $$
    insert into public.locations (restaurant_id, slug, display_name, timezone)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'blank-timezone', 'Blank timezone', '   ')
  $$,
  '23514',
  null,
  'location timezones cannot be blank'
);

select throws_ok(
  $$
    insert into public.locations (restaurant_id, slug, display_name, country_code)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'invalid-country', 'Invalid country', 'de')
  $$,
  '23514',
  null,
  'location country codes use uppercase ISO alpha-2 format'
);

select throws_ok(
  $$
    update public.locations
    set restaurant_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  $$,
  '23514',
  'a location cannot be reassigned to another restaurant',
  'a location remains permanently attached to its restaurant'
);

set local role anon;

select throws_ok(
  $$select * from public.locations$$,
  '42501',
  null,
  'anonymous users cannot query locations'
);

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select results_eq(
  $$select display_name from public.locations order by display_name$$,
  array['Hauptstandort A'::text],
  'a restaurant member sees only locations in their restaurant'
);

select is_empty(
  $$select id from public.locations where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'$$,
  'a member cannot access another restaurant location by its id'
);

select throws_ok(
  $$
    insert into public.locations (restaurant_id, slug, display_name)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'browser-write', 'Browser write')
  $$,
  '42501',
  null,
  'authenticated browser users cannot create locations directly'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select results_eq(
  $$select display_name from public.locations order by display_name$$,
  array['Hauptstandort B'::text],
  'a second restaurant member sees only their own restaurant location'
);

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select is_empty(
  $$select id from public.locations$$,
  'a signed-in non-member sees no locations'
);

select * from finish();

rollback;
