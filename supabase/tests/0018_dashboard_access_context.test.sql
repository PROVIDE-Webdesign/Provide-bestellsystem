begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select no_plan();
\ir fixtures/storefront.fixture.inc

select has_function(
  'private',
  'read_dashboard_access_context',
  array['uuid','text'],
  'dashboard access context function exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.read_dashboard_access_context(uuid,text)',
    'execute'
  ),
  'server may read the dashboard access context'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.read_dashboard_access_context(uuid,text)',
    'execute'
  ),
  'anonymous users cannot call the dashboard context directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.read_dashboard_access_context(uuid,text)',
    'execute'
  ),
  'authenticated browsers cannot bypass the dashboard API'
);

set local role service_role;

select is(
  private.read_dashboard_access_context(
    'f1000000-0000-0000-0000-000000000001','aal1'
  ) #>> '{memberships,0,access}',
  'mfa_required',
  'owner requires aal2'
);
select is(
  private.read_dashboard_access_context(
    'f1000000-0000-0000-0000-000000000001','aal1'
  ) #> '{memberships,0,restaurant}',
  'null'::jsonb,
  'restaurant profile stays hidden before owner MFA'
);
select is(
  jsonb_array_length(
    private.read_dashboard_access_context(
      'f1000000-0000-0000-0000-000000000001','aal1'
    ) #> '{memberships,0,locations}'
  ),
  0,
  'locations stay hidden before owner MFA'
);

select is(
  private.read_dashboard_access_context(
    'f1000000-0000-0000-0000-000000000001','aal2'
  ) #>> '{memberships,0,access}',
  'allowed',
  'owner with aal2 is allowed'
);
select is(
  private.read_dashboard_access_context(
    'f1000000-0000-0000-0000-000000000001','aal2'
  ) #>> '{memberships,0,restaurant,slug}',
  'storefront-restaurant-a',
  'allowed owner sees only their restaurant profile'
);
select is(
  jsonb_array_length(
    private.read_dashboard_access_context(
      'f1000000-0000-0000-0000-000000000001','aal2'
    ) #> '{memberships,0,locations}'
  ),
  1,
  'owner sees every location in their restaurant'
);

select is(
  private.read_dashboard_access_context(
    'f1000000-0000-0000-0000-000000000002','aal1'
  ) #>> '{memberships,0,access}',
  'mfa_required',
  'manager requires aal2'
);
select is(
  jsonb_array_length(
    private.read_dashboard_access_context(
      'f1000000-0000-0000-0000-000000000002','aal2'
    ) #> '{memberships,0,locations}'
  ),
  1,
  'manager sees only assigned locations'
);
select is(
  private.read_dashboard_access_context(
    'f1000000-0000-0000-0000-000000000003','aal1'
  ) #>> '{memberships,0,access}',
  'allowed',
  'kitchen may enter with aal1'
);
select is(
  private.read_dashboard_access_context(
    'f1000000-0000-0000-0000-000000000004','aal1'
  ) #>> '{memberships,0,access}',
  'allowed',
  'driver may enter with aal1'
);
select is(
  jsonb_array_length(
    private.read_dashboard_access_context(
      'f1000000-0000-0000-0000-000000000006','aal2'
    ) #> '{memberships,0,locations}'
  ),
  0,
  'unassigned manager receives no location'
);
select unlike(
  private.read_dashboard_access_context(
    'f1000000-0000-0000-0000-000000000001','aal2'
  )::text,
  '%storefront-restaurant-b%',
  'dashboard context cannot cross the tenant boundary'
);

update public.restaurant_memberships
set status = 'suspended', suspended_at = now()
where restaurant_id = 'f2000000-0000-0000-0000-000000000001'
  and user_id = 'f1000000-0000-0000-0000-000000000003';
select is(
  private.read_dashboard_access_context(
    'f1000000-0000-0000-0000-000000000003','aal2'
  ) #>> '{memberships,0,access}',
  'suspended',
  'suspended membership remains blocked even with aal2'
);
select is(
  private.read_dashboard_access_context(
    'f1000000-0000-0000-0000-000000000003','aal2'
  ) #> '{memberships,0,restaurant}',
  'null'::jsonb,
  'suspended membership exposes no restaurant profile'
);
select is(
  jsonb_array_length(
    private.read_dashboard_access_context(
      '00000000-0000-0000-0000-000000000000','aal1'
    ) -> 'memberships'
  ),
  0,
  'unknown authenticated subject receives no membership'
);

reset role;
select * from finish();
rollback;
