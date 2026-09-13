begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(84);

select has_table(
  'public',
  'availability_schedule_versions',
  'availability schedule versions table exists'
);
select has_table('public', 'availability_windows', 'weekly availability windows table exists');
select has_table('public', 'availability_exceptions', 'availability exceptions table exists');
select has_table(
  'public',
  'availability_publications',
  'availability publication history table exists'
);
select has_table('public', 'ordering_pause_events', 'ordering pause history table exists');
select has_table('public', 'ordering_capacity_claims', 'ordering capacity claims table exists');

select has_function(
  'private',
  'create_availability_schedule_draft',
  array['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'controlled availability draft creation exists'
);
select has_function(
  'private',
  'update_availability_schedule_draft',
  array['uuid', 'uuid', 'uuid', 'integer', 'integer', 'integer', 'integer', 'integer', 'uuid', 'text'],
  'controlled availability settings update exists'
);
select has_function(
  'private',
  'publish_availability_schedule',
  array['uuid', 'uuid', 'uuid', 'timestamptz', 'uuid', 'text'],
  'controlled availability publication exists'
);
select has_function(
  'private',
  'set_ordering_pause',
  array['uuid', 'uuid', 'text', 'timestamptz', 'text', 'uuid', 'text'],
  'controlled ordering pause function exists'
);
select has_function(
  'private',
  'resolve_availability_schedule_version',
  array['uuid', 'uuid', 'timestamptz'],
  'effective availability schedule resolver exists'
);
select has_function(
  'private',
  'resolve_availability_window',
  array['uuid', 'text', 'timestamp without time zone'],
  'local availability window resolver exists'
);
select has_function(
  'private',
  'resolve_ordering_availability',
  array['uuid', 'uuid', 'text', 'timestamptz', 'integer', 'timestamptz'],
  'fail-closed ordering availability resolver exists'
);
select has_function(
  'private',
  'reserve_ordering_capacity',
  array['uuid', 'uuid', 'text', 'timestamptz', 'integer', 'text', 'timestamptz'],
  'atomic ordering capacity reservation exists'
);
select has_function(
  'private',
  'release_ordering_capacity',
  array['uuid', 'uuid', 'text', 'text'],
  'idempotent ordering capacity release exists'
);

select has_trigger(
  'public',
  'availability_schedule_versions',
  'availability_schedule_versions_protect_identity',
  'availability schedule lifecycle protection exists'
);
select has_trigger(
  'public',
  'availability_windows',
  'availability_windows_require_draft',
  'published weekly windows are protected'
);
select has_trigger(
  'public',
  'availability_exceptions',
  'availability_exceptions_require_draft',
  'published exceptions are protected'
);
select has_trigger(
  'public',
  'availability_publications',
  'availability_publications_append_only',
  'availability publication history is append-only'
);
select has_trigger(
  'public',
  'ordering_pause_events',
  'ordering_pause_events_append_only',
  'ordering pause history is append-only'
);
select has_trigger(
  'public',
  'ordering_capacity_claims',
  'ordering_capacity_claims_append_only',
  'capacity claim history is append-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'private.reserve_ordering_capacity(uuid,uuid,text,timestamptz,integer,text,timestamptz)',
    'execute'
  ),
  'service role may reserve capacity through the controlled function'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.reserve_ordering_capacity(uuid,uuid,text,timestamptz,integer,text,timestamptz)',
    'execute'
  ),
  'authenticated browsers cannot reserve capacity directly'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.resolve_ordering_availability(uuid,uuid,text,timestamptz,integer,timestamptz)',
    'execute'
  ),
  'anonymous browsers cannot call the internal ordering resolver'
);
select ok(
  has_table_privilege('authenticated', 'public.availability_schedule_versions', 'select'),
  'authenticated administrators receive RLS-filtered schedule reads'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.availability_schedule_versions',
    'insert,update,delete'
  ),
  'authenticated users cannot write availability schedules directly'
);
select ok(
  has_table_privilege('service_role', 'public.availability_windows', 'insert,update,delete'),
  'service role may edit weekly windows while their schedule is a draft'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.availability_schedule_versions',
    'insert,update,delete'
  ),
  'service role must use controlled functions for schedule lifecycle writes'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.availability_publications',
    'insert,update,delete'
  ),
  'service role cannot rewrite availability publications'
);
select ok(
  not has_table_privilege('service_role', 'public.ordering_pause_events', 'insert,update,delete'),
  'service role must use the controlled pause function'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.ordering_capacity_claims',
    'insert,update,delete'
  ),
  'service role must use controlled capacity functions'
);

insert into auth.users (id, email)
values
  ('b1000000-0000-0000-0000-000000000001', 'availability-owner-a@example.invalid'),
  ('b1000000-0000-0000-0000-000000000002', 'availability-manager-a@example.invalid'),
  ('b1000000-0000-0000-0000-000000000003', 'availability-kitchen-a@example.invalid'),
  ('b1000000-0000-0000-0000-000000000004', 'availability-owner-b@example.invalid');

insert into public.restaurants (id, slug, display_name, status)
values
  (
    'b2000000-0000-0000-0000-000000000001',
    'availability-restaurant-a',
    'Availability Restaurant A',
    'active'
  ),
  (
    'b2000000-0000-0000-0000-000000000002',
    'availability-restaurant-b',
    'Availability Restaurant B',
    'active'
  );

insert into public.restaurant_memberships (restaurant_id, user_id, role, status)
values
  (
    'b2000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'owner',
    'active'
  ),
  (
    'b2000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000002',
    'manager',
    'active'
  ),
  (
    'b2000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000003',
    'kitchen',
    'active'
  ),
  (
    'b2000000-0000-0000-0000-000000000002',
    'b1000000-0000-0000-0000-000000000004',
    'owner',
    'active'
  );

insert into public.locations (
  id,
  restaurant_id,
  slug,
  display_name,
  status,
  timezone,
  address_line_1,
  postal_code,
  city,
  country_code
)
values
  (
    'b3000000-0000-0000-0000-000000000001',
    'b2000000-0000-0000-0000-000000000001',
    'availability-a-mitte',
    'Availability A Mitte',
    'active',
    'Europe/Berlin',
    'Markt 1',
    '52062',
    'Aachen',
    'DE'
  ),
  (
    'b3000000-0000-0000-0000-000000000002',
    'b2000000-0000-0000-0000-000000000001',
    'availability-a-sued',
    'Availability A Sued',
    'active',
    'Europe/Berlin',
    'Suedstrasse 2',
    '52064',
    'Aachen',
    'DE'
  ),
  (
    'b3000000-0000-0000-0000-000000000003',
    'b2000000-0000-0000-0000-000000000002',
    'availability-b-mitte',
    'Availability B Mitte',
    'active',
    'Europe/Berlin',
    'Domplatz 3',
    '50667',
    'Koeln',
    'DE'
  );

insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
values (
  'b2000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000002',
  'b3000000-0000-0000-0000-000000000001'
);

update public.onboarding_check_results as result
set
  status = 'passed',
  checked_by_user_id = case
    when result.restaurant_id = 'b2000000-0000-0000-0000-000000000001'
      then 'b1000000-0000-0000-0000-000000000001'::uuid
    else 'b1000000-0000-0000-0000-000000000004'::uuid
  end,
  checked_at = now()
where result.restaurant_id in (
  'b2000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000002'
);

update public.restaurant_activation_states as activation
set
  onboarding_status = 'approved',
  go_live_status = 'live',
  approved_by_user_id = case
    when activation.restaurant_id = 'b2000000-0000-0000-0000-000000000001'
      then 'b1000000-0000-0000-0000-000000000001'::uuid
    else 'b1000000-0000-0000-0000-000000000004'::uuid
  end,
  approved_at = now(),
  went_live_at = now()
where activation.restaurant_id in (
  'b2000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000002'
);

update public.location_activation_states as activation
set
  onboarding_status = 'approved',
  go_live_status = 'live',
  approved_by_user_id = case
    when activation.restaurant_id = 'b2000000-0000-0000-0000-000000000001'
      then 'b1000000-0000-0000-0000-000000000001'::uuid
    else 'b1000000-0000-0000-0000-000000000004'::uuid
  end,
  approved_at = now(),
  went_live_at = now()
where activation.restaurant_id in (
  'b2000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000002'
);

insert into public.restaurant_feature_flags (restaurant_id, feature_key, enabled)
values
  ('b2000000-0000-0000-0000-000000000001', 'ordering.accept_orders', true),
  ('b2000000-0000-0000-0000-000000000001', 'fulfillment.pickup', true),
  ('b2000000-0000-0000-0000-000000000001', 'fulfillment.delivery', true),
  ('b2000000-0000-0000-0000-000000000001', 'catalog.public_menu', true);

insert into public.menus (id, restaurant_id, slug, display_name)
values (
  'b4000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001',
  'bestellkarte',
  'Bestellkarte'
);

insert into public.menu_versions (
  id,
  restaurant_id,
  menu_id,
  version_number,
  status,
  currency_code,
  created_by_user_id,
  published_by_user_id,
  published_at
)
values (
  'b5000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001',
  'b4000000-0000-0000-0000-000000000001',
  1,
  'published',
  'EUR',
  'b1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001',
  now()
);

insert into public.menu_publications (
  id,
  restaurant_id,
  location_id,
  menu_id,
  menu_version_id,
  publication_kind,
  effective_at,
  actor_user_id,
  authentication_assurance
)
values (
  'b6000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001',
  'b3000000-0000-0000-0000-000000000001',
  'b4000000-0000-0000-0000-000000000001',
  'b5000000-0000-0000-0000-000000000001',
  'publish',
  now(),
  'b1000000-0000-0000-0000-000000000001',
  'aal2'
);

select throws_ok(
  $$
    insert into public.availability_schedule_versions (
      restaurant_id, location_id, version_number, slot_interval_minutes,
      default_order_capacity, created_by_user_id
    )
    values (
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      9, 17, 1,
      'b1000000-0000-0000-0000-000000000001'
    )
  $$,
  '23514',
  null,
  'slot intervals must divide a local day evenly'
);

insert into public.availability_schedule_versions (
  id,
  restaurant_id,
  location_id,
  version_number,
  minimum_lead_minutes,
  maximum_advance_days,
  slot_interval_minutes,
  default_order_capacity,
  default_item_capacity,
  created_by_user_id
)
values (
  'b7000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001',
  'b3000000-0000-0000-0000-000000000001',
  1,
  30,
  14,
  15,
  2,
  5,
  'b1000000-0000-0000-0000-000000000001'
);

insert into public.availability_windows (
  restaurant_id,
  location_id,
  schedule_version_id,
  fulfillment_type,
  weekday,
  opens_at,
  closes_at
)
select
  'b2000000-0000-0000-0000-000000000001',
  'b3000000-0000-0000-0000-000000000001',
  'b7000000-0000-0000-0000-000000000001',
  'pickup',
  weekday,
  '00:00:00'::time,
  '23:59:59'::time
from generate_series(0, 6) as weekday;

insert into public.availability_windows (
  restaurant_id,
  location_id,
  schedule_version_id,
  fulfillment_type,
  weekday,
  opens_at,
  closes_at
)
values (
  'b2000000-0000-0000-0000-000000000001',
  'b3000000-0000-0000-0000-000000000001',
  'b7000000-0000-0000-0000-000000000001',
  'delivery',
  extract(dow from date '2099-01-01')::smallint,
  '22:00:00',
  '02:00:00'
);

insert into public.availability_exceptions (
  restaurant_id,
  location_id,
  schedule_version_id,
  fulfillment_type,
  local_date,
  availability_status,
  reason
)
values (
  'b2000000-0000-0000-0000-000000000001',
  'b3000000-0000-0000-0000-000000000001',
  'b7000000-0000-0000-0000-000000000001',
  'pickup',
  '2099-01-02',
  'closed',
  'Synthetic holiday'
);

select throws_ok(
  $$
    insert into public.availability_windows (
      restaurant_id, location_id, schedule_version_id, fulfillment_type,
      weekday, opens_at, closes_at
    )
    values (
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'b7000000-0000-0000-0000-000000000001',
      'pickup', 7, '10:00', '11:00'
    )
  $$,
  '23514',
  null,
  'weekly windows reject invalid weekdays'
);
select throws_ok(
  $$
    insert into public.availability_exceptions (
      restaurant_id, location_id, schedule_version_id, fulfillment_type,
      local_date, availability_status, opens_at, closes_at
    )
    values (
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'b7000000-0000-0000-0000-000000000001',
      'delivery', '2099-01-03', 'closed', '10:00', '11:00'
    )
  $$,
  '23514',
  null,
  'closed exceptions cannot carry opening hours'
);

set local role service_role;

select throws_ok(
  $$
    select private.create_availability_schedule_draft(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      null,
      'b1000000-0000-0000-0000-000000000001',
      'aal1'
    )
  $$,
  'P0001',
  'availability administration requires aal2',
  'aal1 cannot administer availability schedules'
);
select throws_ok(
  $$
    select private.publish_availability_schedule(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000002',
      'b7000000-0000-0000-0000-000000000001',
      now(),
      'b1000000-0000-0000-0000-000000000002',
      'aal2'
    )
  $$,
  'P0001',
  'manager is not assigned to the availability location',
  'a manager cannot publish an unassigned location schedule'
);
select throws_ok(
  $$
    select private.publish_availability_schedule(
      'b2000000-0000-0000-0000-000000000002',
      'b3000000-0000-0000-0000-000000000003',
      'b7000000-0000-0000-0000-000000000001',
      now(),
      'b1000000-0000-0000-0000-000000000004',
      'aal2'
    )
  $$,
  'P0001',
  'availability schedule was not found',
  'cross-tenant schedules cannot be published'
);
select lives_ok(
  $$
    select private.publish_availability_schedule(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'b7000000-0000-0000-0000-000000000001',
      now(),
      'b1000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'an aal2 owner can publish a complete availability schedule'
);
select results_eq(
  $$
    select status, published_by_user_id, published_at is not null
    from public.availability_schedule_versions
    where id = 'b7000000-0000-0000-0000-000000000001'
  $$,
  $$values ('published'::text, 'b1000000-0000-0000-0000-000000000001'::uuid, true)$$,
  'publication freezes the schedule and records its actor'
);
select is(
  private.resolve_availability_schedule_version(
    'b2000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    '2099-01-01 10:00:00+00'
  ),
  'b7000000-0000-0000-0000-000000000001'::uuid,
  'the effective published availability schedule resolves deterministically'
);

select results_eq(
  $$
    select is_available, reason_code, maximum_orders, maximum_items
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      2,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (true, 'available'::text, 2, 5)$$,
  'a live location inside its pickup window is orderable'
);
select results_eq(
  $$
    select is_available, reason_code, slot_start is not null
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-03-29 02:30:00+00',
      1,
      '2099-03-29 01:00:00+00'
    )
  $$,
  $$values (true, 'available'::text, true)$$,
  'timezone conversion keeps a valid slot across the daylight-saving transition'
);
select results_eq(
  $$
    select is_available, reason_code
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'dine_in',
      '2099-01-01 11:00:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (false, 'invalid_fulfillment'::text)$$,
  'unknown fulfillment modes fail closed'
);
select results_eq(
  $$
    select is_available, reason_code
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      0,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (false, 'invalid_item_count'::text)$$,
  'nonpositive item counts fail closed'
);
select results_eq(
  $$
    select is_available, reason_code
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 10:15:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (false, 'lead_time'::text)$$,
  'minimum lead time is enforced'
);
select results_eq(
  $$
    select is_available, reason_code
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-02-01 11:00:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (false, 'advance_horizon'::text)$$,
  'maximum advance horizon is enforced'
);
select results_eq(
  $$
    select is_available, reason_code
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-02 11:00:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (false, 'outside_window'::text)$$,
  'a local-date closure overrides weekly pickup hours'
);
select results_eq(
  $$
    select is_available, reason_code, slot_start is not null
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'delivery',
      '2099-01-01 23:30:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (true, 'available'::text, true)$$,
  'an overnight delivery window continues after local midnight'
);

update public.restaurant_feature_flags
set enabled = false
where restaurant_id = 'b2000000-0000-0000-0000-000000000001'
  and feature_key = 'ordering.accept_orders';

select results_eq(
  $$
    select is_available, reason_code
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (false, 'ordering_disabled'::text)$$,
  'the global ordering feature closes ordering immediately'
);

update public.restaurant_feature_flags
set enabled = true
where restaurant_id = 'b2000000-0000-0000-0000-000000000001'
  and feature_key = 'ordering.accept_orders';

update public.restaurant_feature_flags
set enabled = false
where restaurant_id = 'b2000000-0000-0000-0000-000000000001'
  and feature_key = 'catalog.public_menu';

select results_eq(
  $$
    select is_available, reason_code
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (false, 'menu_unavailable'::text)$$,
  'a disabled public catalog closes ordering even when a schedule exists'
);

update public.restaurant_feature_flags
set enabled = true
where restaurant_id = 'b2000000-0000-0000-0000-000000000001'
  and feature_key = 'catalog.public_menu';

update public.locations
set status = 'suspended'
where id = 'b3000000-0000-0000-0000-000000000001';

select results_eq(
  $$
    select is_available, reason_code
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (false, 'location_unavailable'::text)$$,
  'a suspended location fails closed before time and capacity evaluation'
);

update public.locations
set status = 'active'
where id = 'b3000000-0000-0000-0000-000000000001';

update public.restaurant_feature_flags
set enabled = false
where restaurant_id = 'b2000000-0000-0000-0000-000000000001'
  and feature_key = 'fulfillment.delivery';

select results_eq(
  $$
    select is_available, reason_code
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'delivery',
      '2099-01-01 23:30:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (false, 'fulfillment_disabled'::text)$$,
  'delivery closes immediately when its feature is disabled'
);

update public.restaurant_feature_flags
set enabled = true
where restaurant_id = 'b2000000-0000-0000-0000-000000000001'
  and feature_key = 'fulfillment.delivery';

select lives_ok(
  $$
    select private.set_ordering_pause(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 09:00:00+00',
      'Synthetic expired pause',
      'b1000000-0000-0000-0000-000000000002',
      'aal2'
    )
  $$,
  'an assigned manager may create a time-bounded operational pause'
);
select results_eq(
  $$
    select is_available, reason_code
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (true, 'available'::text)$$,
  'an expired pause no longer closes ordering'
);

select lives_ok(
  $$
    select private.set_ordering_pause(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-12-31 23:59:59+00',
      'Synthetic kitchen pause',
      'b1000000-0000-0000-0000-000000000002',
      'aal2'
    )
  $$,
  'an assigned aal2 manager may pause pickup temporarily'
);
select results_eq(
  $$
    select is_available, reason_code
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (false, 'manual_pause'::text)$$,
  'an active manual pause closes pickup'
);
select lives_ok(
  $$
    select private.set_ordering_pause(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      null,
      'Synthetic resume',
      'b1000000-0000-0000-0000-000000000002',
      'aal2'
    )
  $$,
  'an assigned aal2 manager may resume pickup'
);
select results_eq(
  $$
    select is_available, reason_code
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (true, 'available'::text)$$,
  'the latest resume event reopens pickup'
);

select is(
  private.reserve_ordering_capacity(
    'b2000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    'pickup',
    '2099-01-01 11:00:00+00',
    2,
    'synthetic-order-a',
    '2099-01-01 10:00:00+00'
  ),
  true,
  'the first capacity claim is reserved'
);
select is(
  private.reserve_ordering_capacity(
    'b2000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    'pickup',
    '2099-01-01 11:00:00+00',
    2,
    'synthetic-order-a',
    '2099-01-01 10:00:00+00'
  ),
  true,
  'retrying the same capacity key is idempotent'
);
select is(
  (
    select count(*)::integer
    from public.ordering_capacity_claims
    where claim_key = 'synthetic-order-a'
      and claim_kind = 'reserve'
  ),
  1,
  'an idempotent retry does not consume capacity twice'
);
select is(
  private.reserve_ordering_capacity(
    'b2000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    'pickup',
    '2099-01-01 11:00:00+00',
    3,
    'synthetic-order-b',
    '2099-01-01 10:00:00+00'
  ),
  true,
  'a second claim can fill the remaining item capacity'
);
select is(
  private.reserve_ordering_capacity(
    'b2000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    'pickup',
    '2099-01-01 11:00:00+00',
    1,
    'synthetic-order-c',
    '2099-01-01 10:00:00+00'
  ),
  false,
  'capacity cannot be overbooked'
);
select results_eq(
  $$
    select is_available, reason_code, reserved_orders, reserved_items
    from private.resolve_ordering_availability(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      1,
      '2099-01-01 10:00:00+00'
    )
  $$,
  $$values (false, 'capacity_exhausted'::text, 2, 5)$$,
  'the resolver exposes exhausted slot usage without customer data'
);
select is(
  private.release_ordering_capacity(
    'b2000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    'pickup',
    'synthetic-order-a'
  ),
  true,
  'a reserved capacity claim can be released'
);
select is(
  private.release_ordering_capacity(
    'b2000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    'pickup',
    'synthetic-order-a'
  ),
  true,
  'releasing the same claim twice is idempotent'
);
select is(
  (
    select count(*)::integer
    from public.ordering_capacity_claims
    where claim_key = 'synthetic-order-a'
      and claim_kind = 'release'
  ),
  1,
  'an idempotent release writes one compensating claim'
);
select is(
  private.reserve_ordering_capacity(
    'b2000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    'pickup',
    '2099-01-01 11:00:00+00',
    1,
    'synthetic-order-c',
    '2099-01-01 10:00:00+00'
  ),
  true,
  'released capacity becomes safely reusable'
);
select is(
  private.release_ordering_capacity(
    'b2000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    'pickup',
    'missing-claim'
  ),
  false,
  'an unknown capacity claim fails closed'
);
select lives_ok(
  $$
    select private.create_availability_schedule_draft(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'b7000000-0000-0000-0000-000000000001',
      'b1000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'an owner may copy a published schedule into a new draft'
);
select is(
  (
    select count(*)::integer
    from public.availability_schedule_versions
    where restaurant_id = 'b2000000-0000-0000-0000-000000000001'
      and location_id = 'b3000000-0000-0000-0000-000000000001'
      and version_number = 2
      and status = 'draft'
  ),
  1,
  'a copied schedule receives the next version number as a draft'
);
select is(
  (
    select count(*)::integer
    from public.availability_windows as availability_window
    join public.availability_schedule_versions as version
      on version.id = availability_window.schedule_version_id
    where version.restaurant_id = 'b2000000-0000-0000-0000-000000000001'
      and version.location_id = 'b3000000-0000-0000-0000-000000000001'
      and version.version_number = 2
  ),
  8,
  'a new schedule draft copies all weekly windows'
);
select is(
  (
    select count(*)::integer
    from public.availability_exceptions as exception
    join public.availability_schedule_versions as version
      on version.id = exception.schedule_version_id
    where version.restaurant_id = 'b2000000-0000-0000-0000-000000000001'
      and version.location_id = 'b3000000-0000-0000-0000-000000000001'
      and version.version_number = 2
  ),
  1,
  'a new schedule draft copies its calendar exceptions'
);
select lives_ok(
  $$
    select private.update_availability_schedule_draft(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      (
        select id
        from public.availability_schedule_versions
        where restaurant_id = 'b2000000-0000-0000-0000-000000000001'
          and location_id = 'b3000000-0000-0000-0000-000000000001'
          and version_number = 2
      ),
      45,
      21,
      15,
      3,
      9,
      'b1000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'draft schedule settings can be changed through the controlled function'
);
select is(
  (
    select minimum_lead_minutes
    from public.availability_schedule_versions
    where restaurant_id = 'b2000000-0000-0000-0000-000000000001'
      and location_id = 'b3000000-0000-0000-0000-000000000001'
      and version_number = 2
  ),
  45,
  'the controlled draft update persists validated settings'
);
select throws_ok(
  $$
    select private.reserve_ordering_capacity(
      'b2000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      4,
      'synthetic-order-c',
      '2099-01-01 10:00:00+00'
    )
  $$,
  'P0001',
  'capacity claim key was reused with different values',
  'capacity keys cannot be reused for different quantities'
);

select cmp_ok(
  (
    select count(*)::integer
    from public.outbox_events
    where restaurant_id = 'b2000000-0000-0000-0000-000000000001'
      and aggregate_type in ('ordering_availability', 'ordering_capacity')
  ),
  '>=',
  7,
  'publications, pauses and capacity changes emit transactional outbox events'
);
select is(
  (
    select count(*)::integer
    from public.ordering_pause_events
    where restaurant_id = 'b2000000-0000-0000-0000-000000000001'
      and location_id = 'b3000000-0000-0000-0000-000000000001'
  ),
  3,
  'expired pause, active pause and resume remain as append-only history'
);

reset role;

select throws_ok(
  $$
    update public.availability_schedule_versions
    set minimum_lead_minutes = 60
    where id = 'b7000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'published availability schedules are immutable',
  'published schedule settings cannot be rewritten'
);
select throws_ok(
  $$
    update public.availability_windows
    set closes_at = '22:00'
    where schedule_version_id = 'b7000000-0000-0000-0000-000000000001'
      and fulfillment_type = 'pickup'
      and weekday = 1
  $$,
  '23514',
  'published availability schedule content is immutable',
  'published weekly windows cannot be rewritten'
);
select throws_ok(
  $$
    update public.availability_publications
    set effective_at = effective_at + interval '1 hour'
    where schedule_version_id = 'b7000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'ordering availability history is append-only',
  'availability publication history cannot be rewritten'
);
select throws_ok(
  $$
    delete from public.ordering_capacity_claims
    where claim_key = 'synthetic-order-b'
  $$,
  '23514',
  'ordering availability history is append-only',
  'capacity history cannot be deleted directly'
);

set local role authenticated;
set local request.jwt.claim.sub = 'b1000000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"b1000000-0000-0000-0000-000000000001","aal":"aal2"}';

select is(
  (
    select count(*)::integer
    from public.availability_schedule_versions
    where restaurant_id = 'b2000000-0000-0000-0000-000000000001'
  ),
  1,
  'an authenticated owner can read its location schedule'
);
select is(
  (
    select count(*)::integer
    from public.availability_schedule_versions
    where restaurant_id = 'b2000000-0000-0000-0000-000000000002'
  ),
  0,
  'RLS hides another tenant availability schedule'
);

reset role;

select * from finish();
rollback;
