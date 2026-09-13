begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(71);

select has_table(
  'public',
  'onboarding_check_definitions',
  'onboarding check definitions table exists'
);
select has_table(
  'public',
  'restaurant_activation_states',
  'restaurant activation states table exists'
);
select has_table(
  'public',
  'location_activation_states',
  'location activation states table exists'
);
select has_table(
  'public',
  'onboarding_check_results',
  'onboarding check results table exists'
);
select has_table(
  'public',
  'onboarding_transitions',
  'onboarding transition history table exists'
);
select has_function(
  'private',
  'update_onboarding_check',
  array['uuid', 'uuid', 'text', 'text', 'uuid', 'text', 'text'],
  'server-side onboarding check function exists'
);
select has_function(
  'private',
  'transition_restaurant_onboarding',
  array['uuid', 'text', 'uuid', 'text'],
  'restaurant onboarding transition function exists'
);
select has_function(
  'private',
  'transition_location_onboarding',
  array['uuid', 'uuid', 'text', 'uuid', 'text'],
  'location onboarding transition function exists'
);
select has_function(
  'private',
  'transition_restaurant_go_live',
  array['uuid', 'text', 'uuid', 'text'],
  'restaurant go-live transition function exists'
);
select has_function(
  'private',
  'transition_location_go_live',
  array['uuid', 'uuid', 'text', 'uuid', 'text'],
  'location go-live transition function exists'
);
select has_function(
  'private',
  'is_restaurant_go_live',
  array['uuid'],
  'restaurant launch gate exists'
);
select has_function(
  'private',
  'is_location_go_live',
  array['uuid', 'uuid'],
  'location launch gate exists'
);
select has_trigger(
  'public',
  'restaurants',
  'restaurants_initialize_activation',
  'new restaurants initialize their activation state'
);
select has_trigger(
  'public',
  'locations',
  'locations_initialize_activation',
  'new locations initialize their activation state'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.transition_restaurant_go_live(uuid,text,uuid,text)',
    'execute'
  ),
  'the service role may execute restaurant go-live transitions'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.transition_restaurant_go_live(uuid,text,uuid,text)',
    'execute'
  ),
  'authenticated browsers cannot execute restaurant go-live transitions'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.update_onboarding_check(uuid,uuid,text,text,uuid,text,text)',
    'execute'
  ),
  'anonymous users cannot update onboarding checks'
);
select ok(
  has_table_privilege('authenticated', 'public.restaurant_activation_states', 'select'),
  'authenticated administrators receive read-only activation access'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.restaurant_activation_states',
    'insert,update,delete'
  ),
  'authenticated users cannot modify activation rows directly'
);
select is(
  (
    select count(*)::integer
    from public.onboarding_check_definitions
    where required_for_go_live
  ),
  8,
  'eight required launch checks are registered'
);

insert into auth.users (id, email)
values
  ('91000000-0000-0000-0000-000000000001', 'launch-owner-a@example.invalid'),
  ('91000000-0000-0000-0000-000000000002', 'launch-manager-a@example.invalid'),
  ('91000000-0000-0000-0000-000000000003', 'launch-kitchen-a@example.invalid'),
  ('91000000-0000-0000-0000-000000000004', 'launch-owner-b@example.invalid');

insert into public.restaurants (id, slug, display_name, status)
values
  (
    '92000000-0000-0000-0000-000000000001',
    'launch-restaurant-a',
    'Launch Restaurant A',
    'active'
  ),
  (
    '92000000-0000-0000-0000-000000000002',
    'launch-restaurant-b',
    'Launch Restaurant B',
    'active'
  );

insert into public.restaurant_memberships (restaurant_id, user_id, role, status)
values
  (
    '92000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001',
    'owner',
    'active'
  ),
  (
    '92000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000002',
    'manager',
    'active'
  ),
  (
    '92000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000003',
    'kitchen',
    'active'
  ),
  (
    '92000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000004',
    'owner',
    'active'
  );

insert into public.locations (
  id,
  restaurant_id,
  slug,
  display_name,
  status,
  address_line_1,
  postal_code,
  city,
  country_code
)
values
  (
    '93000000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000001',
    'launch-a-mitte',
    'Launch A Mitte',
    'active',
    'Markt 1',
    '52062',
    'Aachen',
    'DE'
  ),
  (
    '93000000-0000-0000-0000-000000000002',
    '92000000-0000-0000-0000-000000000001',
    'launch-a-sued',
    'Launch A Sued',
    'active',
    'Suedstrasse 2',
    '52064',
    'Aachen',
    'DE'
  ),
  (
    '93000000-0000-0000-0000-000000000003',
    '92000000-0000-0000-0000-000000000002',
    'launch-b-mitte',
    'Launch B Mitte',
    'active',
    'Domplatz 3',
    '50667',
    'Koeln',
    'DE'
  );

insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
values (
  '92000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000001'
);

select is(
  (
    select count(*)::integer
    from public.restaurant_activation_states
    where restaurant_id in (
      '92000000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000002'
    )
  ),
  2,
  'restaurant activation rows are initialized automatically'
);
select is(
  (
    select count(*)::integer
    from public.location_activation_states
    where restaurant_id in (
      '92000000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000002'
    )
  ),
  3,
  'location activation rows are initialized automatically'
);
select is(
  (
    select count(*)::integer
    from public.onboarding_check_results
    where restaurant_id = '92000000-0000-0000-0000-000000000001'
  ),
  12,
  'restaurant and both locations receive their required check rows'
);
select results_eq(
  $$
    select onboarding_status, go_live_status
    from public.restaurant_activation_states
    where restaurant_id = '92000000-0000-0000-0000-000000000001'
  $$,
  $$values ('not_started'::text, 'blocked'::text)$$,
  'new restaurants start blocked and not started'
);

set local role service_role;

select throws_ok(
  $$
    select private.transition_restaurant_onboarding(
      '92000000-0000-0000-0000-000000000001',
      'in_progress',
      '91000000-0000-0000-0000-000000000001',
      'aal1'
    )
  $$,
  'P0001',
  'onboarding administration requires aal2',
  'aal1 cannot administer restaurant onboarding'
);
select throws_ok(
  $$
    select private.transition_restaurant_onboarding(
      '92000000-0000-0000-0000-000000000001',
      'in_progress',
      '91000000-0000-0000-0000-000000000004',
      'aal2'
    )
  $$,
  'P0001',
  'onboarding actor must be an active owner or manager',
  'an owner from another tenant cannot administer onboarding'
);
select throws_ok(
  $$
    select private.transition_restaurant_onboarding(
      '92000000-0000-0000-0000-000000000001',
      'approved',
      '91000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'P0001',
  'restaurant onboarding transition is invalid',
  'restaurant onboarding cannot skip directly to approval'
);
select lives_ok(
  $$
    select private.transition_restaurant_onboarding(
      '92000000-0000-0000-0000-000000000001',
      'in_progress',
      '91000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'restaurant onboarding may start with aal2'
);
select throws_ok(
  $$
    select private.transition_restaurant_onboarding(
      '92000000-0000-0000-0000-000000000001',
      'ready_for_review',
      '91000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'P0001',
  'restaurant onboarding checks are incomplete',
  'restaurant review is blocked while checks are pending'
);
select lives_ok(
  $$
    do $block$
    begin
      perform private.update_onboarding_check(
        '92000000-0000-0000-0000-000000000001', null,
        'restaurant.profile', 'passed',
        '91000000-0000-0000-0000-000000000001', 'aal2', null
      );
      perform private.update_onboarding_check(
        '92000000-0000-0000-0000-000000000001', null,
        'restaurant.owner', 'passed',
        '91000000-0000-0000-0000-000000000001', 'aal2', null
      );
      perform private.update_onboarding_check(
        '92000000-0000-0000-0000-000000000001', null,
        'restaurant.legal', 'passed',
        '91000000-0000-0000-0000-000000000001', 'aal2', 'Reviewed for test'
      );
      perform private.update_onboarding_check(
        '92000000-0000-0000-0000-000000000001', null,
        'restaurant.operations', 'passed',
        '91000000-0000-0000-0000-000000000001', 'aal2', null
      );
    end;
    $block$;
  $$,
  'all restaurant launch checks can be recorded atomically'
);
select is(
  (
    select count(*)::integer
    from public.onboarding_check_results
    where restaurant_id = '92000000-0000-0000-0000-000000000001'
      and location_id is null
      and status = 'passed'
  ),
  4,
  'all required restaurant checks are recorded as passed'
);
select lives_ok(
  $$
    do $block$
    begin
      perform private.transition_restaurant_onboarding(
        '92000000-0000-0000-0000-000000000001',
        'ready_for_review',
        '91000000-0000-0000-0000-000000000001',
        'aal2'
      );
      perform private.transition_restaurant_onboarding(
        '92000000-0000-0000-0000-000000000001',
        'approved',
        '91000000-0000-0000-0000-000000000001',
        'aal2'
      );
    end;
    $block$;
  $$,
  'restaurant onboarding follows review before approval'
);
select results_eq(
  $$
    select onboarding_status, approved_by_user_id
    from public.restaurant_activation_states
    where restaurant_id = '92000000-0000-0000-0000-000000000001'
  $$,
  $$values ('approved'::text, '91000000-0000-0000-0000-000000000001'::uuid)$$,
  'restaurant approval records its verified actor'
);
select throws_ok(
  $$
    select private.update_onboarding_check(
      '92000000-0000-0000-0000-000000000001', null,
      'restaurant.legal', 'failed',
      '91000000-0000-0000-0000-000000000001', 'aal2', null
    )
  $$,
  'P0001',
  'approved onboarding checks are immutable',
  'approved restaurant checks cannot be silently rewritten'
);

select lives_ok(
  $$
    select private.transition_location_onboarding(
      '92000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000001',
      'in_progress',
      '91000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'location onboarding may start with an authorized owner'
);
select throws_ok(
  $$
    select private.transition_location_onboarding(
      '92000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000001',
      'ready_for_review',
      '91000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'P0001',
  'location onboarding checks are incomplete',
  'location review is blocked while checks are pending'
);
select throws_ok(
  $$
    select private.update_onboarding_check(
      '92000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000002',
      'location.profile', 'passed',
      '91000000-0000-0000-0000-000000000002', 'aal2', null
    )
  $$,
  'P0001',
  'manager is not assigned to the onboarding location',
  'a manager cannot administer an unassigned location'
);
select lives_ok(
  $$
    do $block$
    begin
      perform private.update_onboarding_check(
        '92000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000001',
        'location.profile', 'passed',
        '91000000-0000-0000-0000-000000000002', 'aal2', null
      );
      perform private.update_onboarding_check(
        '92000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000001',
        'location.address', 'passed',
        '91000000-0000-0000-0000-000000000002', 'aal2', null
      );
      perform private.update_onboarding_check(
        '92000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000001',
        'location.fulfillment', 'passed',
        '91000000-0000-0000-0000-000000000002', 'aal2', null
      );
      perform private.update_onboarding_check(
        '92000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000001',
        'location.operations', 'passed',
        '91000000-0000-0000-0000-000000000002', 'aal2', null
      );
    end;
    $block$;
  $$,
  'an assigned manager can complete location launch checks'
);
select lives_ok(
  $$
    do $block$
    begin
      perform private.transition_location_onboarding(
        '92000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000001',
        'ready_for_review',
        '91000000-0000-0000-0000-000000000002',
        'aal2'
      );
      perform private.transition_location_onboarding(
        '92000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000001',
        'approved',
        '91000000-0000-0000-0000-000000000002',
        'aal2'
      );
    end;
    $block$;
  $$,
  'assigned manager can move a complete location through approval'
);
select results_eq(
  $$
    select onboarding_status, approved_by_user_id
    from public.location_activation_states
    where restaurant_id = '92000000-0000-0000-0000-000000000001'
      and location_id = '93000000-0000-0000-0000-000000000001'
  $$,
  $$values ('approved'::text, '91000000-0000-0000-0000-000000000002'::uuid)$$,
  'location approval records the assigned manager'
);
select lives_ok(
  $$
    select private.transition_location_go_live(
      '92000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000001',
      'ready',
      '91000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'an approved complete location can become ready'
);
select throws_ok(
  $$
    select private.transition_location_go_live(
      '92000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000001',
      'live',
      '91000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'P0001',
  'restaurant must be live before its location',
  'a location cannot go live before its restaurant'
);
select lives_ok(
  $$
    do $block$
    begin
      perform private.transition_restaurant_go_live(
        '92000000-0000-0000-0000-000000000001',
        'ready',
        '91000000-0000-0000-0000-000000000001',
        'aal2'
      );
      perform private.transition_restaurant_go_live(
        '92000000-0000-0000-0000-000000000001',
        'live',
        '91000000-0000-0000-0000-000000000001',
        'aal2'
      );
      perform private.transition_location_go_live(
        '92000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000001',
        'live',
        '91000000-0000-0000-0000-000000000001',
        'aal2'
      );
    end;
    $block$;
  $$,
  'restaurant and location follow the controlled go-live sequence'
);
select ok(
  private.is_restaurant_go_live('92000000-0000-0000-0000-000000000001'),
  'restaurant launch gate opens after verified go-live'
);
select ok(
  private.is_location_go_live(
    '92000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001'
  ),
  'location launch gate opens only after both entities are live'
);
select ok(
  not private.is_restaurant_feature_enabled(
    '92000000-0000-0000-0000-000000000001',
    'ordering.accept_orders'
  ),
  'go-live does not automatically enable order acceptance'
);
select is(
  (
    select count(*)::integer
    from public.onboarding_transitions
    where restaurant_id = '92000000-0000-0000-0000-000000000001'
  ),
  10,
  'every successful onboarding and go-live transition is audited'
);
select is(
  (
    select count(*)::integer
    from public.outbox_events
    where restaurant_id = '92000000-0000-0000-0000-000000000001'
      and idempotency_key like 'onboarding-transition:%'
  ),
  10,
  'every successful transition writes one transactional outbox event'
);
select results_eq(
  $$
    select distinct event_type
    from public.outbox_events
    where restaurant_id = '92000000-0000-0000-0000-000000000001'
      and idempotency_key like 'onboarding-transition:%'
    order by event_type
  $$,
  array[
    'location.go.live.status_changed'::text,
    'location.onboarding.status_changed'::text,
    'restaurant.go.live.status_changed'::text,
    'restaurant.onboarding.status_changed'::text
  ],
  'outbox events distinguish each transition kind'
);

select lives_ok(
  $$
    select private.transition_restaurant_go_live(
      '92000000-0000-0000-0000-000000000001',
      'paused',
      '91000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'a live restaurant can be paused safely'
);
select ok(
  not private.is_restaurant_go_live('92000000-0000-0000-0000-000000000001'),
  'paused restaurant closes the launch gate immediately'
);
select ok(
  not private.is_location_go_live(
    '92000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001'
  ),
  'pausing a restaurant also closes its location launch gate'
);
select throws_ok(
  $$
    select private.transition_restaurant_go_live(
      '92000000-0000-0000-0000-000000000001',
      'live',
      '91000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'P0001',
  'restaurant go-live transition is invalid',
  'a paused restaurant cannot skip readiness review'
);
select lives_ok(
  $$
    do $block$
    begin
      perform private.transition_restaurant_go_live(
        '92000000-0000-0000-0000-000000000001',
        'ready',
        '91000000-0000-0000-0000-000000000001',
        'aal2'
      );
      perform private.transition_restaurant_go_live(
        '92000000-0000-0000-0000-000000000001',
        'live',
        '91000000-0000-0000-0000-000000000001',
        'aal2'
      );
    end;
    $block$;
  $$,
  'paused restaurant can return through readiness to live'
);
select ok(
  private.is_location_go_live(
    '92000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001'
  ),
  'location gate reopens when its restaurant is live again'
);

update public.locations
set status = 'suspended'
where restaurant_id = '92000000-0000-0000-0000-000000000001'
  and id = '93000000-0000-0000-0000-000000000001';

select ok(
  not private.is_location_go_live(
    '92000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001'
  ),
  'suspending a location closes its launch gate even if state remains live'
);

update public.locations
set status = 'active'
where restaurant_id = '92000000-0000-0000-0000-000000000001'
  and id = '93000000-0000-0000-0000-000000000001';

update public.restaurants
set status = 'suspended'
where id = '92000000-0000-0000-0000-000000000001';

select ok(
  not private.is_restaurant_go_live('92000000-0000-0000-0000-000000000001'),
  'suspending a restaurant closes its launch gate immediately'
);
select ok(
  not private.is_location_go_live(
    '92000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001'
  ),
  'restaurant suspension also closes every child location gate'
);

update public.restaurants
set status = 'active'
where id = '92000000-0000-0000-0000-000000000001';

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '91000000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-000000000001","aal":"aal1"}';

select is_empty(
  $$select restaurant_id from public.restaurant_activation_states$$,
  'owner with aal1 cannot read administrative activation state'
);

set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-000000000001","aal":"aal2"}';

select results_eq(
  $$select restaurant_id from public.restaurant_activation_states$$,
  array['92000000-0000-0000-0000-000000000001'::uuid],
  'owner with aal2 sees only their restaurant activation state'
);
select results_eq(
  $$
    select location_id
    from public.location_activation_states
    order by location_id
  $$,
  array[
    '93000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000002'::uuid
  ],
  'owner with aal2 sees every location state in their restaurant'
);
select is(
  (
    select count(*)::integer
    from public.onboarding_transitions
  ),
  13,
  'owner with aal2 can read only their restaurant transition history'
);
select throws_ok(
  $$
    update public.restaurant_activation_states
    set go_live_status = 'paused'
    where restaurant_id = '92000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  null,
  'authenticated owner cannot update activation state directly'
);
select throws_ok(
  $$
    select private.transition_restaurant_go_live(
      '92000000-0000-0000-0000-000000000001',
      'paused',
      '91000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  '42501',
  null,
  'authenticated owner cannot call server-only transition functions'
);

set local request.jwt.claim.sub = '91000000-0000-0000-0000-000000000002';
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-000000000002","aal":"aal2"}';

select results_eq(
  $$select restaurant_id from public.restaurant_activation_states$$,
  array['92000000-0000-0000-0000-000000000001'::uuid],
  'manager with aal2 sees their restaurant activation state'
);
select results_eq(
  $$select location_id from public.location_activation_states$$,
  array['93000000-0000-0000-0000-000000000001'::uuid],
  'manager sees only their assigned location activation state'
);
select is(
  (
    select count(*)::integer
    from public.onboarding_check_results
  ),
  8,
  'manager sees restaurant checks plus checks for their assigned location'
);

set local request.jwt.claim.sub = '91000000-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-000000000003","aal":"aal2"}';

select is_empty(
  $$select restaurant_id from public.restaurant_activation_states$$,
  'kitchen personnel cannot read administrative activation state'
);
select is_empty(
  $$select id from public.onboarding_transitions$$,
  'kitchen personnel cannot read onboarding audit history'
);

reset role;
set local role anon;

select throws_ok(
  $$select * from public.restaurant_activation_states$$,
  '42501',
  null,
  'anonymous users cannot read activation state'
);
select throws_ok(
  $$select private.is_restaurant_go_live('92000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'anonymous users cannot call internal launch gates'
);

select * from finish();

rollback;
