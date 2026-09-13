begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(57);

select has_table('public', 'orders', 'orders table exists');
select has_table('public', 'order_lines', 'immutable order lines table exists');
select has_table('public', 'order_status_events', 'append-only order status history exists');

select has_function(
  'private',
  'submit_order',
  array['uuid', 'uuid', 'uuid', 'uuid', 'text', 'timestamptz', 'jsonb', 'text', 'timestamptz'],
  'controlled order submission exists'
);
select has_function(
  'private',
  'transition_order_status',
  array['uuid', 'uuid', 'uuid', 'text', 'uuid', 'text'],
  'controlled order transition exists'
);
select has_trigger(
  'public',
  'orders',
  'orders_protect_snapshot',
  'order snapshot protection exists'
);
select has_trigger(
  'public',
  'orders',
  'orders_prevent_delete',
  'orders cannot be deleted'
);
select has_trigger(
  'public',
  'order_lines',
  'order_lines_append_only',
  'order lines are append-only'
);
select has_trigger(
  'public',
  'order_status_events',
  'order_status_events_append_only',
  'order status history is append-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'private.submit_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz)',
    'execute'
  ),
  'service role may submit through the controlled function'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.transition_order_status(uuid,uuid,uuid,text,uuid,text)',
    'execute'
  ),
  'service role may transition through the controlled function'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.submit_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz)',
    'execute'
  ),
  'authenticated browsers cannot submit orders directly'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.submit_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz)',
    'execute'
  ),
  'anonymous browsers cannot call internal order submission'
);
select ok(
  not has_table_privilege('service_role', 'public.orders', 'insert,update,delete'),
  'service role must use controlled functions for order writes'
);
select ok(
  not has_table_privilege('service_role', 'public.order_lines', 'insert,update,delete'),
  'service role cannot rewrite order-line snapshots'
);
select ok(
  not has_table_privilege('service_role', 'public.order_status_events', 'insert,update,delete'),
  'service role cannot rewrite order status history'
);
select ok(
  has_table_privilege('authenticated', 'public.orders', 'select'),
  'authenticated personnel receive RLS-filtered order reads'
);
select ok(
  not has_table_privilege('authenticated', 'public.orders', 'insert,update,delete'),
  'authenticated browsers cannot write orders directly'
);

insert into auth.users (id, email)
values
  ('c1000000-0000-0000-0000-000000000001', 'order-owner-a@example.invalid'),
  ('c1000000-0000-0000-0000-000000000002', 'order-manager-a@example.invalid'),
  ('c1000000-0000-0000-0000-000000000003', 'order-kitchen-a@example.invalid'),
  ('c1000000-0000-0000-0000-000000000004', 'order-driver-a@example.invalid'),
  ('c1000000-0000-0000-0000-000000000005', 'order-owner-b@example.invalid'),
  ('c1000000-0000-0000-0000-000000000006', 'order-manager-unassigned@example.invalid');

insert into public.restaurants (id, slug, display_name, status)
values
  (
    'c2000000-0000-0000-0000-000000000001',
    'order-restaurant-a',
    'Order Restaurant A',
    'active'
  ),
  (
    'c2000000-0000-0000-0000-000000000002',
    'order-restaurant-b',
    'Order Restaurant B',
    'active'
  );

insert into public.restaurant_memberships (restaurant_id, user_id, role, status)
values
  (
    'c2000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    'owner',
    'active'
  ),
  (
    'c2000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000002',
    'manager',
    'active'
  ),
  (
    'c2000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000003',
    'kitchen',
    'active'
  ),
  (
    'c2000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000004',
    'driver',
    'active'
  ),
  (
    'c2000000-0000-0000-0000-000000000002',
    'c1000000-0000-0000-0000-000000000005',
    'owner',
    'active'
  ),
  (
    'c2000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000006',
    'manager',
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
    'c3000000-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-000000000001',
    'order-a-mitte',
    'Order A Mitte',
    'active',
    'Europe/Berlin',
    'Testweg 1',
    '52062',
    'Aachen',
    'DE'
  ),
  (
    'c3000000-0000-0000-0000-000000000002',
    'c2000000-0000-0000-0000-000000000002',
    'order-b-mitte',
    'Order B Mitte',
    'active',
    'Europe/Berlin',
    'Testweg 2',
    '50667',
    'Koeln',
    'DE'
  );

insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
values
  (
    'c2000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000002',
    'c3000000-0000-0000-0000-000000000001'
  ),
  (
    'c2000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000003',
    'c3000000-0000-0000-0000-000000000001'
  ),
  (
    'c2000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000004',
    'c3000000-0000-0000-0000-000000000001'
  );

update public.onboarding_check_results as result
set
  status = 'passed',
  checked_by_user_id = case
    when result.restaurant_id = 'c2000000-0000-0000-0000-000000000001'
      then 'c1000000-0000-0000-0000-000000000001'::uuid
    else 'c1000000-0000-0000-0000-000000000005'::uuid
  end,
  checked_at = now()
where result.restaurant_id in (
  'c2000000-0000-0000-0000-000000000001',
  'c2000000-0000-0000-0000-000000000002'
);

update public.restaurant_activation_states as activation
set
  onboarding_status = 'approved',
  go_live_status = 'live',
  approved_by_user_id = case
    when activation.restaurant_id = 'c2000000-0000-0000-0000-000000000001'
      then 'c1000000-0000-0000-0000-000000000001'::uuid
    else 'c1000000-0000-0000-0000-000000000005'::uuid
  end,
  approved_at = now(),
  went_live_at = now()
where activation.restaurant_id in (
  'c2000000-0000-0000-0000-000000000001',
  'c2000000-0000-0000-0000-000000000002'
);

update public.location_activation_states as activation
set
  onboarding_status = 'approved',
  go_live_status = 'live',
  approved_by_user_id = case
    when activation.restaurant_id = 'c2000000-0000-0000-0000-000000000001'
      then 'c1000000-0000-0000-0000-000000000001'::uuid
    else 'c1000000-0000-0000-0000-000000000005'::uuid
  end,
  approved_at = now(),
  went_live_at = now()
where activation.restaurant_id in (
  'c2000000-0000-0000-0000-000000000001',
  'c2000000-0000-0000-0000-000000000002'
);

insert into public.restaurant_feature_flags (restaurant_id, feature_key, enabled)
values
  ('c2000000-0000-0000-0000-000000000001', 'ordering.accept_orders', true),
  ('c2000000-0000-0000-0000-000000000001', 'fulfillment.pickup', true),
  ('c2000000-0000-0000-0000-000000000001', 'catalog.public_menu', true);

insert into public.menus (id, restaurant_id, slug, display_name)
values (
  'c4000000-0000-0000-0000-000000000001',
  'c2000000-0000-0000-0000-000000000001',
  'order-test-menu',
  'Order Test Menu'
);

insert into public.menu_versions (
  id,
  restaurant_id,
  menu_id,
  version_number,
  currency_code,
  created_by_user_id
)
values (
  'c5000000-0000-0000-0000-000000000001',
  'c2000000-0000-0000-0000-000000000001',
  'c4000000-0000-0000-0000-000000000001',
  1,
  'EUR',
  'c1000000-0000-0000-0000-000000000001'
);

insert into public.menu_items (id, restaurant_id, menu_id, slug)
values
  (
    'c6000000-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-000000000001',
    'c4000000-0000-0000-0000-000000000001',
    'curry'
  ),
  (
    'c6000000-0000-0000-0000-000000000002',
    'c2000000-0000-0000-0000-000000000001',
    'c4000000-0000-0000-0000-000000000001',
    'reis'
  );

insert into public.menu_version_sections (
  restaurant_id,
  menu_id,
  menu_version_id,
  section_key,
  display_name
)
values (
  'c2000000-0000-0000-0000-000000000001',
  'c4000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001',
  'gerichte',
  'Gerichte'
);

insert into public.menu_version_items (
  restaurant_id,
  menu_id,
  menu_version_id,
  menu_item_id,
  section_key,
  display_name,
  price_amount_minor,
  sort_order
)
values
  (
    'c2000000-0000-0000-0000-000000000001',
    'c4000000-0000-0000-0000-000000000001',
    'c5000000-0000-0000-0000-000000000001',
    'c6000000-0000-0000-0000-000000000001',
    'gerichte',
    'Curry Snapshot',
    1250,
    1
  ),
  (
    'c2000000-0000-0000-0000-000000000001',
    'c4000000-0000-0000-0000-000000000001',
    'c5000000-0000-0000-0000-000000000001',
    'c6000000-0000-0000-0000-000000000002',
    'gerichte',
    'Reis Snapshot',
    300,
    2
  );

update public.menu_versions
set
  status = 'published',
  published_by_user_id = 'c1000000-0000-0000-0000-000000000001',
  published_at = now()
where id = 'c5000000-0000-0000-0000-000000000001';

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
  'c7000000-0000-0000-0000-000000000001',
  'c2000000-0000-0000-0000-000000000001',
  'c3000000-0000-0000-0000-000000000001',
  'c4000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001',
  'publish',
  now(),
  'c1000000-0000-0000-0000-000000000001',
  'aal2'
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
  'c8000000-0000-0000-0000-000000000001',
  'c2000000-0000-0000-0000-000000000001',
  'c3000000-0000-0000-0000-000000000001',
  1,
  15,
  14,
  15,
  10,
  100,
  'c1000000-0000-0000-0000-000000000001'
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
  'c2000000-0000-0000-0000-000000000001',
  'c3000000-0000-0000-0000-000000000001',
  'c8000000-0000-0000-0000-000000000001',
  'pickup',
  weekday,
  '00:00:00'::time,
  '23:59:59'::time
from generate_series(0, 6) as weekday;

update public.availability_schedule_versions
set
  status = 'published',
  published_by_user_id = 'c1000000-0000-0000-0000-000000000001',
  published_at = now()
where id = 'c8000000-0000-0000-0000-000000000001';

insert into public.availability_publications (
  id,
  restaurant_id,
  location_id,
  schedule_version_id,
  effective_at,
  actor_user_id,
  authentication_assurance
)
values (
  'c9000000-0000-0000-0000-000000000001',
  'c2000000-0000-0000-0000-000000000001',
  'c3000000-0000-0000-0000-000000000001',
  'c8000000-0000-0000-0000-000000000001',
  now(),
  'c1000000-0000-0000-0000-000000000001',
  'aal2'
);

set local role service_role;

select throws_ok(
  $$
    select private.submit_order(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      'c4000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      '[{"menu_item_id":"c6000000-0000-0000-0000-000000000001","quantity":1}]',
      'short',
      '2099-01-01 10:00:00+00'
    )
  $$,
  'P0001',
  'order submission key is invalid',
  'short idempotency keys are rejected'
);
select throws_ok(
  $$
    select private.submit_order(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      'c4000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      '[{"menu_item_id":"c6000000-0000-0000-0000-000000000001","quantity":1},{"menu_item_id":"c6000000-0000-0000-0000-000000000001","quantity":1}]',
      'duplicate-lines',
      '2099-01-01 10:00:00+00'
    )
  $$,
  'P0001',
  'order lines contain duplicate menu items',
  'duplicate menu items are rejected'
);
select throws_ok(
  $$
    select private.submit_order(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      'c4000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      '[{"menu_item_id":"c6000000-0000-0000-0000-000000000001","quantity":0}]',
      'invalid-quantity',
      '2099-01-01 10:00:00+00'
    )
  $$,
  'P0001',
  'order item quantity is invalid',
  'nonpositive order quantities are rejected'
);
select throws_ok(
  $$
    select private.submit_order(
      'c2000000-0000-0000-0000-000000000002',
      'c3000000-0000-0000-0000-000000000001',
      'c4000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      '[{"menu_item_id":"c6000000-0000-0000-0000-000000000001","quantity":1}]',
      'cross-tenant-order',
      '2099-01-01 10:00:00+00'
    )
  $$,
  'P0001',
  'order menu version is not publicly active',
  'cross-tenant menu and location combinations fail closed'
);

reset role;

insert into public.menu_item_location_availability (
  restaurant_id,
  location_id,
  menu_id,
  menu_item_id,
  status,
  updated_by_user_id
)
values (
  'c2000000-0000-0000-0000-000000000001',
  'c3000000-0000-0000-0000-000000000001',
  'c4000000-0000-0000-0000-000000000001',
  'c6000000-0000-0000-0000-000000000002',
  'sold_out',
  'c1000000-0000-0000-0000-000000000001'
);

set local role service_role;

select throws_ok(
  $$
    select private.submit_order(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      'c4000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      '[{"menu_item_id":"c6000000-0000-0000-0000-000000000002","quantity":1}]',
      'sold-out-order',
      '2099-01-01 10:00:00+00'
    )
  $$,
  'P0001',
  'order contains unavailable menu items',
  'sold-out items cannot enter an order snapshot'
);

reset role;

update public.menu_item_location_availability
set status = 'available'
where restaurant_id = 'c2000000-0000-0000-0000-000000000001'
  and location_id = 'c3000000-0000-0000-0000-000000000001'
  and menu_item_id = 'c6000000-0000-0000-0000-000000000002';

set local role service_role;

select lives_ok(
  $$
    select private.submit_order(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      'c4000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      '[{"menu_item_id":"c6000000-0000-0000-0000-000000000001","quantity":2},{"menu_item_id":"c6000000-0000-0000-0000-000000000002","quantity":1}]',
      'order-submit-0001',
      '2099-01-01 10:00:00+00'
    )
  $$,
  'a valid submission atomically creates an order snapshot'
);

reset role;

select results_eq(
  $$
    select status, currency_code, subtotal_amount_minor, total_amount_minor, item_count
    from public.orders
    where submission_key = 'order-submit-0001'
  $$,
  $$values ('submitted'::text, 'EUR'::text, 2800::bigint, 2800::bigint, 3)$$,
  'the order stores deterministic currency, totals and item count'
);
select results_eq(
  $$
    select display_name, quantity, unit_price_amount_minor, line_amount_minor
    from public.order_lines
    where order_id = (select id from public.orders where submission_key = 'order-submit-0001')
    order by line_number
  $$,
  $$
    values
      ('Curry Snapshot'::text, 2, 1250::bigint, 2500::bigint),
      ('Reis Snapshot'::text, 1, 300::bigint, 300::bigint)
  $$,
  'line names and prices are immutable menu-version snapshots'
);
select is(
  (
    select count(*)::integer
    from public.ordering_capacity_claims as claim
    join public.orders as order_record
      on order_record.capacity_claim_id = claim.id
    where order_record.submission_key = 'order-submit-0001'
      and claim.claim_kind = 'reserve'
      and claim.item_count = 3
  ),
  1,
  'the order links to exactly one matching capacity reservation'
);
select results_eq(
  $$
    select event_sequence, from_status, to_status, actor_kind
    from public.order_status_events
    where order_id = (select id from public.orders where submission_key = 'order-submit-0001')
  $$,
  $$values (1, null::text, 'submitted'::text, 'system'::text)$$,
  'submission starts an append-only system status history'
);
select is(
  (
    select count(*)::integer
    from public.outbox_events
    where aggregate_id = (select id from public.orders where submission_key = 'order-submit-0001')
      and event_type = 'order.submitted'
  ),
  1,
  'submission emits one minimized transactional outbox event'
);
select ok(
  not (
    select payload ?| array['customer', 'email', 'phone', 'address', 'payment']
    from public.outbox_events
    where aggregate_id = (select id from public.orders where submission_key = 'order-submit-0001')
      and event_type = 'order.submitted'
  ),
  'the order outbox event contains no customer or payment fields'
);

set local role service_role;

select is(
  private.submit_order(
    'c2000000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000001',
    'c4000000-0000-0000-0000-000000000001',
    'c5000000-0000-0000-0000-000000000001',
    'pickup',
    '2099-01-01 11:00:00+00',
    '[{"menu_item_id":"c6000000-0000-0000-0000-000000000002","quantity":1},{"menu_item_id":"c6000000-0000-0000-0000-000000000001","quantity":2}]',
    'order-submit-0001',
    '2099-01-01 10:00:00+00'
  ),
  (select id from public.orders where submission_key = 'order-submit-0001'),
  'a reordered but equivalent retry returns the existing order'
);
select throws_ok(
  $$
    select private.submit_order(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      'c4000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:00:00+00',
      '[{"menu_item_id":"c6000000-0000-0000-0000-000000000001","quantity":1}]',
      'order-submit-0001',
      '2099-01-01 10:00:00+00'
    )
  $$,
  'P0001',
  'order submission key was reused with different values',
  'an idempotency key cannot be reused with different order data'
);

reset role;

select is(
  (select count(*)::integer from public.orders where submission_key = 'order-submit-0001'),
  1,
  'idempotent retries do not duplicate the order'
);
select is(
  (
    select count(*)::integer
    from public.ordering_capacity_claims
    where claim_key like 'order:%'
      and claim_kind = 'reserve'
  ),
  1,
  'idempotent retries do not consume capacity twice'
);

set local role service_role;

select throws_ok(
  $$
    select private.transition_order_status(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      (select id from public.orders where submission_key = 'order-submit-0001'),
      'accepted',
      'c1000000-0000-0000-0000-000000000004',
      'aal1'
    )
  $$,
  'P0001',
  'order actor must be an active owner, manager or kitchen member',
  'drivers cannot transition the kitchen order lifecycle'
);
select throws_ok(
  $$
    select private.transition_order_status(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      (select id from public.orders where submission_key = 'order-submit-0001'),
      'accepted',
      'c1000000-0000-0000-0000-000000000006',
      'aal2'
    )
  $$,
  'P0001',
  'order actor is not assigned to the location',
  'an unassigned manager cannot transition the order'
);
select throws_ok(
  $$
    select private.transition_order_status(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      (select id from public.orders where submission_key = 'order-submit-0001'),
      'accepted',
      'c1000000-0000-0000-0000-000000000001',
      'aal1'
    )
  $$,
  'P0001',
  'order administration requires aal2',
  'an owner cannot administer orders with aal1'
);
select throws_ok(
  $$
    select private.transition_order_status(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      (select id from public.orders where submission_key = 'order-submit-0001'),
      'cancelled',
      'c1000000-0000-0000-0000-000000000003',
      'aal1'
    )
  $$,
  'P0001',
  'kitchen personnel cannot apply this order status',
  'kitchen personnel cannot cancel orders'
);
select lives_ok(
  $$
    select private.transition_order_status(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      (select id from public.orders where submission_key = 'order-submit-0001'),
      'accepted',
      'c1000000-0000-0000-0000-000000000003',
      'aal1'
    )
  $$,
  'assigned kitchen personnel may accept an order with aal1'
);
select throws_ok(
  $$
    select private.transition_order_status(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      (select id from public.orders where submission_key = 'order-submit-0001'),
      'completed',
      'c1000000-0000-0000-0000-000000000003',
      'aal1'
    )
  $$,
  'P0001',
  'order status transition is invalid',
  'order states cannot be skipped'
);
select lives_ok(
  $$
    select private.transition_order_status(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      (select id from public.orders where submission_key = 'order-submit-0001'),
      'preparing',
      'c1000000-0000-0000-0000-000000000003',
      'aal1'
    )
  $$,
  'kitchen personnel may start preparation'
);
select lives_ok(
  $$
    select private.transition_order_status(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      (select id from public.orders where submission_key = 'order-submit-0001'),
      'ready',
      'c1000000-0000-0000-0000-000000000003',
      'aal1'
    )
  $$,
  'kitchen personnel may mark an order ready'
);
select lives_ok(
  $$
    select private.transition_order_status(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      (select id from public.orders where submission_key = 'order-submit-0001'),
      'completed',
      'c1000000-0000-0000-0000-000000000002',
      'aal2'
    )
  $$,
  'an assigned aal2 manager may complete a ready order'
);

reset role;

select is(
  (select status from public.orders where submission_key = 'order-submit-0001'),
  'completed',
  'the valid transition chain reaches completed'
);
select results_eq(
  $$
    select event_sequence, to_status
    from public.order_status_events
    where order_id = (select id from public.orders where submission_key = 'order-submit-0001')
    order by event_sequence
  $$,
  $$
    values
      (1, 'submitted'::text),
      (2, 'accepted'::text),
      (3, 'preparing'::text),
      (4, 'ready'::text),
      (5, 'completed'::text)
  $$,
  'status history remains complete and ordered'
);
select is(
  (
    select count(*)::integer
    from public.outbox_events
    where aggregate_id = (select id from public.orders where submission_key = 'order-submit-0001')
      and event_type = 'order.status_changed'
  ),
  4,
  'every successful transition emits one outbox event'
);

set local role service_role;

select lives_ok(
  $$
    select private.submit_order(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      'c4000000-0000-0000-0000-000000000001',
      'c5000000-0000-0000-0000-000000000001',
      'pickup',
      '2099-01-01 11:15:00+00',
      '[{"menu_item_id":"c6000000-0000-0000-0000-000000000001","quantity":1}]',
      'order-submit-0002',
      '2099-01-01 10:00:00+00'
    )
  $$,
  'a second order can reserve another available slot'
);
select lives_ok(
  $$
    select private.transition_order_status(
      'c2000000-0000-0000-0000-000000000001',
      'c3000000-0000-0000-0000-000000000001',
      (select id from public.orders where submission_key = 'order-submit-0002'),
      'cancelled',
      'c1000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'an aal2 owner may cancel a submitted order'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.ordering_capacity_claims as release_claim
    join public.orders as order_record
      on release_claim.related_claim_id = order_record.capacity_claim_id
    where order_record.submission_key = 'order-submit-0002'
      and release_claim.claim_kind = 'release'
  ),
  1,
  'cancellation atomically releases the linked capacity once'
);

select throws_ok(
  $$
    update public.orders
    set total_amount_minor = total_amount_minor + 1
    where submission_key = 'order-submit-0001'
  $$,
  '23514',
  'order snapshot is immutable',
  'stored order totals cannot be rewritten'
);
select throws_ok(
  $$
    update public.order_lines
    set display_name = 'Rewritten'
    where order_id = (select id from public.orders where submission_key = 'order-submit-0001')
      and line_number = 1
  $$,
  '23514',
  'order records are append-only',
  'order-line snapshots cannot be rewritten'
);
select throws_ok(
  $$
    delete from public.order_status_events
    where order_id = (select id from public.orders where submission_key = 'order-submit-0001')
      and event_sequence = 1
  $$,
  '23514',
  'order records are append-only',
  'order status history cannot be deleted'
);
select throws_ok(
  $$
    delete from public.orders
    where submission_key = 'order-submit-0001'
  $$,
  '23514',
  'order records are append-only',
  'orders cannot be deleted directly'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000001","aal":"aal2"}';

select is(
  (select count(*)::integer from public.orders),
  2,
  'an aal2 owner can read all orders of its restaurant'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000003","aal":"aal1"}';

select is(
  (select count(*)::integer from public.orders),
  2,
  'assigned kitchen personnel can read orders at aal1'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000005';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000005","aal":"aal2"}';

select is(
  (select count(*)::integer from public.orders),
  0,
  'RLS hides orders from another restaurant owner'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000002';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000002","aal":"aal1"}';

select is(
  (select count(*)::integer from public.orders),
  0,
  'manager order reads require aal2'
);

reset role;

select * from finish();
rollback;
