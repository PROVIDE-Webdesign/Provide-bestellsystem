begin;

-- Disposable pgTAP fixture only: materialize a provider-shaped session for old role/scope tests.
-- New A4 tests deliberately omit/revoke these rows to exercise the strict product gate.
create function pg_temp.fixture_claims(value text, local_only boolean) returns text
language plpgsql security definer set search_path='' as $$
declare c jsonb := value::jsonb; u uuid; a text; sid uuid;
begin
  u := coalesce(c->>'sub',nullif(current_setting('request.jwt.claim.sub',true),''))::uuid;
  a := coalesce(c->>'aal','aal1');
  if u is not null and exists(select 1 from auth.users where id=u) and a in ('aal1','aal2') then
    sid := case when a='aal2' then u else md5(u::text||'aal1')::uuid end;
    if a='aal2' then
      insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
      values(u,u,'Synthetic test only','totp','verified','SYNTHETICTEST',now(),now()) on conflict(id) do nothing;
    end if;
    insert into auth.sessions(id,user_id,created_at,updated_at,aal,factor_id)
    values(sid,u,clock_timestamp(),clock_timestamp(),a::auth.aal_level,case when a='aal2' then u else null end)
    on conflict(id) do nothing;
    c := c || jsonb_build_object('session_id',sid);
  end if;
  return set_config('request.jwt.claims',c::text,local_only);
end $$;



create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(32);

select has_schema('private', 'private helper schema exists');
select has_table('public', 'restaurants', 'restaurants table exists');
select has_table('public', 'restaurant_memberships', 'restaurant memberships table exists');

select has_column('public', 'restaurants', 'id', 'restaurants have an id');
select has_column('public', 'restaurants', 'slug', 'restaurants have a slug');
select has_column('public', 'restaurants', 'display_name', 'restaurants have a display name');
select has_column('public', 'restaurants', 'status', 'restaurants have a status');
select has_column('public', 'restaurant_memberships', 'restaurant_id', 'memberships have a restaurant id');
select has_column('public', 'restaurant_memberships', 'user_id', 'memberships have a user id');
select has_column('public', 'restaurant_memberships', 'role', 'memberships have a role');

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'restaurants'
  ),
  'restaurants have row level security enabled'
);

select ok(
  (
    select relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'restaurants'
  ),
  'restaurants force row level security'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'restaurant_memberships'
  ),
  'memberships have row level security enabled'
);

select ok(
  (
    select relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'restaurant_memberships'
  ),
  'memberships force row level security'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'restaurants'
  ),
  1,
  'restaurants define exactly one authenticated policy'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'restaurant_memberships'
  ),
  1,
  'memberships define exactly one authenticated policy'
);

select ok(
  not has_function_privilege('anon', 'private.is_restaurant_member(uuid)', 'execute'),
  'anonymous users cannot execute the membership helper'
);
select ok(
  has_function_privilege('authenticated', 'private.is_restaurant_member(uuid)', 'execute'),
  'authenticated users may execute the RLS membership helper'
);

select ok(not has_table_privilege('anon', 'public.restaurants', 'select,insert,update,delete'),
  'anonymous users have no restaurant privileges');
select ok(not has_table_privilege(
  'anon',
  'public.restaurant_memberships',
  'select,insert,update,delete'
), 'anonymous users have no membership privileges');
select ok(
  has_table_privilege('authenticated', 'public.restaurants', 'select'),
  'authenticated users may read restaurants through RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.restaurants', 'insert,update,delete'),
  'authenticated users cannot write restaurants directly'
);
select ok(
  has_table_privilege('authenticated', 'public.restaurant_memberships', 'select'),
  'authenticated users may read their own memberships through RLS'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.restaurant_memberships',
    'insert,update,delete'
  ),
  'authenticated users cannot write memberships directly'
);
select ok(
  has_table_privilege('service_role', 'public.restaurants', 'select,insert,update,delete'),
  'the server role can manage restaurants'
);
select ok(
  has_table_privilege(
    'service_role',
    'public.restaurant_memberships',
    'select,insert,update,delete'
  ),
  'the server role can manage memberships'
);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'member-a@example.invalid'),
  ('22222222-2222-2222-2222-222222222222', 'stranger@example.invalid');

insert into public.restaurants (id, slug, display_name)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'restaurant-a', 'Restaurant A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'restaurant-b', 'Restaurant B');

insert into public.restaurant_memberships (restaurant_id, user_id, role)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'owner'
);

set local role anon;

select throws_ok(
  $$select * from public.restaurants$$,
  '42501',
  null,
  'anonymous users cannot query restaurants'
);
select throws_ok(
  $$select * from public.restaurant_memberships$$,
  '42501',
  null,
  'anonymous users cannot query memberships'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.fixture_claims('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}',true);

select results_eq(
  $$select slug from public.restaurants order by slug$$,
  array['restaurant-a'::text],
  'a member sees only their restaurant'
);
select results_eq(
  $$select role from public.restaurant_memberships order by role$$,
  array['owner'::text],
  'a member sees only their own membership'
);

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.fixture_claims('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal2"}',true);

select is_empty(
  $$select id from public.restaurants$$,
  'a signed-in non-member sees no restaurants'
);
select is_empty(
  $$select restaurant_id from public.restaurant_memberships$$,
  'a signed-in non-member sees no memberships'
);

select * from finish();

rollback;
