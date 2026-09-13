begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(41);

select has_table('public', 'feature_definitions', 'feature definitions table exists');
select has_table('public', 'restaurant_feature_flags', 'restaurant feature flags table exists');

select has_column('public', 'feature_definitions', 'key', 'feature definitions have a key');
select has_column(
  'public',
  'feature_definitions',
  'description',
  'feature definitions have a description'
);
select has_column(
  'public',
  'feature_definitions',
  'default_enabled',
  'feature definitions have a secure default'
);
select has_column(
  'public',
  'restaurant_feature_flags',
  'restaurant_id',
  'restaurant flags have a restaurant id'
);
select has_column(
  'public',
  'restaurant_feature_flags',
  'feature_key',
  'restaurant flags have a feature key'
);
select has_column(
  'public',
  'restaurant_feature_flags',
  'enabled',
  'restaurant flags have an enabled state'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'feature_definitions'
  ),
  'feature definitions have row level security enabled'
);
select ok(
  (
    select relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'feature_definitions'
  ),
  'feature definitions force row level security'
);
select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'restaurant_feature_flags'
  ),
  'restaurant feature flags have row level security enabled'
);
select ok(
  (
    select relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'restaurant_feature_flags'
  ),
  'restaurant feature flags force row level security'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'feature_definitions'
  ),
  0,
  'feature definitions deliberately define no browser policies'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'restaurant_feature_flags'
  ),
  0,
  'restaurant feature flags deliberately define no browser policies'
);

select ok(
  not has_table_privilege('anon', 'public.feature_definitions', 'select,insert,update,delete'),
  'anonymous users have no feature definition privileges'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.feature_definitions',
    'select,insert,update,delete'
  ),
  'authenticated users have no feature definition privileges'
);
select ok(
  not has_table_privilege(
    'anon',
    'public.restaurant_feature_flags',
    'select,insert,update,delete'
  ),
  'anonymous users have no restaurant feature flag privileges'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.restaurant_feature_flags',
    'select,insert,update,delete'
  ),
  'authenticated users have no restaurant feature flag privileges'
);
select ok(
  has_table_privilege(
    'service_role',
    'public.feature_definitions',
    'select,insert,update,delete'
  ),
  'the server role can manage feature definitions'
);
select ok(
  has_table_privilege(
    'service_role',
    'public.restaurant_feature_flags',
    'select,insert,update,delete'
  ),
  'the server role can manage restaurant feature flags'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.is_restaurant_feature_enabled(uuid,text)',
    'execute'
  ),
  'anonymous users cannot resolve server-side feature flags'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.is_restaurant_feature_enabled(uuid,text)',
    'execute'
  ),
  'authenticated users cannot resolve server-side feature flags directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.is_restaurant_feature_enabled(uuid,text)',
    'execute'
  ),
  'the server role can resolve feature flags'
);

select is(
  (
    select count(*)::integer
    from public.feature_definitions
    where key in (
      'ordering.accept_orders',
      'fulfillment.pickup',
      'fulfillment.delivery',
      'payment.online'
    )
  ),
  4,
  'the original controlled feature registry entries remain present'
);
select ok(
  (select bool_and(not default_enabled) from public.feature_definitions),
  'all initial features are disabled by default'
);

insert into public.restaurants (id, slug, display_name)
values
  ('12121212-1212-1212-1212-121212121212', 'feature-test-a', 'Feature Test A'),
  ('34343434-3434-3434-3434-343434343434', 'feature-test-b', 'Feature Test B');

select is(
  private.is_restaurant_feature_enabled(
    '12121212-1212-1212-1212-121212121212',
    'unknown.feature'
  ),
  false,
  'unknown features resolve to disabled'
);
select is(
  private.is_restaurant_feature_enabled(
    '12121212-1212-1212-1212-121212121212',
    'ordering.accept_orders'
  ),
  false,
  'registered features start disabled'
);

update public.feature_definitions
set default_enabled = true
where key = 'ordering.accept_orders';

select is(
  private.is_restaurant_feature_enabled(
    '12121212-1212-1212-1212-121212121212',
    'ordering.accept_orders'
  ),
  true,
  'a restaurant inherits an enabled registry default'
);
select is(
  private.is_restaurant_feature_enabled(
    '56565656-5656-5656-5656-565656565656',
    'ordering.accept_orders'
  ),
  false,
  'an unknown restaurant never inherits an enabled default'
);

insert into public.restaurant_feature_flags (restaurant_id, feature_key, enabled)
values (
  '12121212-1212-1212-1212-121212121212',
  'ordering.accept_orders',
  false
);

select is(
  private.is_restaurant_feature_enabled(
    '12121212-1212-1212-1212-121212121212',
    'ordering.accept_orders'
  ),
  false,
  'a restaurant override takes precedence over the registry default'
);
select is(
  private.is_restaurant_feature_enabled(
    '34343434-3434-3434-3434-343434343434',
    'ordering.accept_orders'
  ),
  true,
  'another restaurant keeps the registry default'
);

insert into public.restaurant_feature_flags (restaurant_id, feature_key, enabled)
values (
  '12121212-1212-1212-1212-121212121212',
  'fulfillment.delivery',
  true
);

select is(
  private.is_restaurant_feature_enabled(
    '12121212-1212-1212-1212-121212121212',
    'fulfillment.delivery'
  ),
  true,
  'a feature can be enabled for one restaurant'
);
select is(
  private.is_restaurant_feature_enabled(
    '34343434-3434-3434-3434-343434343434',
    'fulfillment.delivery'
  ),
  false,
  'the same feature remains disabled for another restaurant'
);

select throws_ok(
  $$
    insert into public.restaurant_feature_flags (restaurant_id, feature_key, enabled)
    values (
      '12121212-1212-1212-1212-121212121212',
      'ordering.accept_orders',
      true
    )
  $$,
  '23505',
  null,
  'a restaurant can define only one override per feature'
);
select throws_ok(
  $$
    insert into public.restaurant_feature_flags (restaurant_id, feature_key)
    values (
      '34343434-3434-3434-3434-343434343434',
      'unknown.feature'
    )
  $$,
  '23503',
  null,
  'restaurant overrides require a registered feature'
);
select throws_ok(
  $$
    insert into public.feature_definitions (key, description)
    values ('Invalid Feature', 'Invalid key')
  $$,
  '23514',
  null,
  'feature keys follow the namespaced contract'
);
select throws_ok(
  $$
    insert into public.feature_definitions (key, description)
    values ('test.blank_description', '   ')
  $$,
  '23514',
  null,
  'feature descriptions cannot be blank'
);

set local role anon;

select throws_ok(
  $$select * from public.feature_definitions$$,
  '42501',
  null,
  'anonymous users cannot query feature definitions'
);
select throws_ok(
  $$select * from public.restaurant_feature_flags$$,
  '42501',
  null,
  'anonymous users cannot query restaurant feature flags'
);

set local role authenticated;

select throws_ok(
  $$select * from public.feature_definitions$$,
  '42501',
  null,
  'authenticated users cannot query feature definitions directly'
);
select throws_ok(
  $$select * from public.restaurant_feature_flags$$,
  '42501',
  null,
  'authenticated users cannot query restaurant feature flags directly'
);

select * from finish();

rollback;
