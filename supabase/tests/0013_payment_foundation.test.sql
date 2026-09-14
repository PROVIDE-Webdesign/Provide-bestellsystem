begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(71);

select has_table('public', 'order_payments', 'order payment obligations table exists');
select has_table('public', 'payment_attempts', 'payment attempts table exists');
select has_table('public', 'payment_provider_events', 'verified provider event table exists');
select has_table('public', 'payment_status_events', 'append-only payment history exists');

select has_function(
  'private',
  'submit_order_with_payment',
  array[
    'uuid',
    'uuid',
    'uuid',
    'uuid',
    'text',
    'timestamptz',
    'jsonb',
    'text',
    'timestamptz',
    'text'
  ],
  'controlled order submission with payment exists'
);
select has_function(
  'private',
  'create_payment_attempt',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'text'],
  'controlled payment attempt creation exists'
);
select has_function(
  'private',
  'apply_verified_payment_event',
  array[
    'uuid',
    'uuid',
    'uuid',
    'text',
    'text',
    'text',
    'text',
    'text',
    'bigint',
    'text',
    'text',
    'timestamptz'
  ],
  'controlled verified provider event application exists'
);

select has_trigger(
  'public',
  'order_payments',
  'order_payments_protect_update',
  'payment obligations are protected from rewrites'
);
select has_trigger(
  'public',
  'order_payments',
  'order_payments_prevent_delete',
  'payment obligations cannot be deleted'
);
select has_trigger(
  'public',
  'payment_attempts',
  'payment_attempts_append_only',
  'payment attempts are append-only'
);
select has_trigger(
  'public',
  'payment_provider_events',
  'payment_provider_events_append_only',
  'provider events are append-only'
);
select has_trigger(
  'public',
  'payment_status_events',
  'payment_status_events_append_only',
  'payment history is append-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'private.submit_order_with_payment(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz,text)',
    'execute'
  ),
  'service role may submit orders only through the payment-aware boundary'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.submit_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz)',
    'execute'
  ),
  'service role cannot bypass payment requirement creation'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.create_payment_attempt(uuid,uuid,uuid,text,text,text)',
    'execute'
  ),
  'service role may create controlled payment attempts'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.apply_verified_payment_event(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text,timestamptz)',
    'execute'
  ),
  'service role may apply API-verified payment events'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.initialize_order_payment(uuid,uuid,uuid,text)',
    'execute'
  ),
  'service role cannot attach payment requirements outside order submission'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.create_payment_attempt(uuid,uuid,uuid,text,text,text)',
    'execute'
  ),
  'authenticated browsers cannot create payment attempts'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.apply_verified_payment_event(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text,timestamptz)',
    'execute'
  ),
  'anonymous callers cannot submit provider events'
);
select ok(
  not has_table_privilege('service_role', 'public.order_payments', 'insert,update,delete'),
  'service role must use controlled functions for payment writes'
);
select ok(
  not has_table_privilege('service_role', 'public.payment_attempts', 'insert,update,delete'),
  'service role cannot rewrite payment attempts'
);
select ok(
  not has_table_privilege('service_role', 'public.payment_provider_events', 'insert,update,delete'),
  'service role cannot rewrite provider events'
);
select ok(
  not has_table_privilege('service_role', 'public.payment_status_events', 'insert,update,delete'),
  'service role cannot rewrite payment history'
);
select ok(
  has_table_privilege('authenticated', 'public.order_payments', 'select'),
  'authenticated finance personnel receive RLS-filtered payment reads'
);
select ok(
  not has_table_privilege('authenticated', 'public.order_payments', 'insert,update,delete'),
  'authenticated browsers cannot write payment obligations'
);
select ok(
  not has_table_privilege('authenticated', 'public.payment_attempts', 'select'),
  'authenticated browsers cannot read provider payment references'
);
select ok(
  not has_table_privilege('authenticated', 'public.payment_provider_events', 'select'),
  'authenticated browsers cannot read provider event metadata'
);
select hasnt_column(
  'public',
  'payment_provider_events',
  'payload',
  'raw provider payloads are not stored'
);
select hasnt_column(
  'public',
  'order_payments',
  'card_number',
  'card data has no storage column'
);
select hasnt_column(
  'public',
  'order_payments',
  'customer_email',
  'payer contact data has no storage column'
);

insert into auth.users (id, email)
values
  ('d1000000-0000-0000-0000-000000000001', 'payment-owner-a@example.invalid'),
  ('d1000000-0000-0000-0000-000000000002', 'payment-kitchen-a@example.invalid'),
  ('d1000000-0000-0000-0000-000000000003', 'payment-owner-b@example.invalid');

insert into public.restaurants (id, slug, display_name, status)
values
  (
    'd2000000-0000-0000-0000-000000000001',
    'payment-restaurant-a',
    'Payment Restaurant A',
    'active'
  ),
  (
    'd2000000-0000-0000-0000-000000000002',
    'payment-restaurant-b',
    'Payment Restaurant B',
    'active'
  );

insert into public.restaurant_memberships (restaurant_id, user_id, role, status)
values
  (
    'd2000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'owner',
    'active'
  ),
  (
    'd2000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000002',
    'kitchen',
    'active'
  ),
  (
    'd2000000-0000-0000-0000-000000000002',
    'd1000000-0000-0000-0000-000000000003',
    'owner',
    'active'
  );

insert into public.locations (id, restaurant_id, slug, display_name, status)
values
  (
    'd3000000-0000-0000-0000-000000000001',
    'd2000000-0000-0000-0000-000000000001',
    'payment-a-mitte',
    'Payment A Mitte',
    'active'
  ),
  (
    'd3000000-0000-0000-0000-000000000002',
    'd2000000-0000-0000-0000-000000000002',
    'payment-b-mitte',
    'Payment B Mitte',
    'active'
  );

insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
values (
  'd2000000-0000-0000-0000-000000000001',
  'd1000000-0000-0000-0000-000000000002',
  'd3000000-0000-0000-0000-000000000001'
);

insert into public.restaurant_feature_flags (restaurant_id, feature_key, enabled)
values ('d2000000-0000-0000-0000-000000000001', 'payment.online', true);

insert into public.menus (id, restaurant_id, slug, display_name)
values (
  'd4000000-0000-0000-0000-000000000001',
  'd2000000-0000-0000-0000-000000000001',
  'payment-menu',
  'Payment Menu'
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
  'd5000000-0000-0000-0000-000000000001',
  'd2000000-0000-0000-0000-000000000001',
  'd4000000-0000-0000-0000-000000000001',
  1,
  'EUR',
  'd1000000-0000-0000-0000-000000000001'
);

insert into public.availability_schedule_versions (
  id,
  restaurant_id,
  location_id,
  version_number,
  default_order_capacity,
  default_item_capacity,
  created_by_user_id
)
values (
  'd6000000-0000-0000-0000-000000000001',
  'd2000000-0000-0000-0000-000000000001',
  'd3000000-0000-0000-0000-000000000001',
  1,
  10,
  100,
  'd1000000-0000-0000-0000-000000000001'
);

insert into public.ordering_capacity_claims (
  id,
  restaurant_id,
  location_id,
  schedule_version_id,
  fulfillment_type,
  slot_start,
  claim_key,
  claim_kind,
  order_count,
  item_count
)
values
  (
    'd7000000-0000-0000-0000-000000000001',
    'd2000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    'd6000000-0000-0000-0000-000000000001',
    'pickup',
    '2099-01-01 11:00:00+00',
    'payment-order-claim-0001',
    'reserve',
    1,
    2
  ),
  (
    'd7000000-0000-0000-0000-000000000002',
    'd2000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    'd6000000-0000-0000-0000-000000000001',
    'pickup',
    '2099-01-01 11:15:00+00',
    'payment-order-claim-0002',
    'reserve',
    1,
    1
  ),
  (
    'd7000000-0000-0000-0000-000000000003',
    'd2000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    'd6000000-0000-0000-0000-000000000001',
    'pickup',
    '2099-01-01 11:30:00+00',
    'payment-order-claim-0003',
    'reserve',
    1,
    1
  ),
  (
    'd7000000-0000-0000-0000-000000000004',
    'd2000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    'd6000000-0000-0000-0000-000000000001',
    'pickup',
    '2099-01-01 11:45:00+00',
    'payment-order-claim-0004',
    'reserve',
    1,
    1
  );

insert into public.orders (
  id,
  restaurant_id,
  location_id,
  menu_id,
  menu_version_id,
  schedule_version_id,
  capacity_claim_id,
  submission_key,
  submission_payload,
  fulfillment_type,
  requested_for,
  currency_code,
  subtotal_amount_minor,
  total_amount_minor,
  item_count
)
values
  (
    'd8000000-0000-0000-0000-000000000001',
    'd2000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    'd4000000-0000-0000-0000-000000000001',
    'd5000000-0000-0000-0000-000000000001',
    'd6000000-0000-0000-0000-000000000001',
    'd7000000-0000-0000-0000-000000000001',
    'payment-order-online-0001',
    '{}',
    'pickup',
    '2099-01-01 11:00:00+00',
    'EUR',
    2800,
    2800,
    2
  ),
  (
    'd8000000-0000-0000-0000-000000000002',
    'd2000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    'd4000000-0000-0000-0000-000000000001',
    'd5000000-0000-0000-0000-000000000001',
    'd6000000-0000-0000-0000-000000000001',
    'd7000000-0000-0000-0000-000000000002',
    'payment-order-offline-0002',
    '{}',
    'pickup',
    '2099-01-01 11:15:00+00',
    'EUR',
    1250,
    1250,
    1
  ),
  (
    'd8000000-0000-0000-0000-000000000003',
    'd2000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    'd4000000-0000-0000-0000-000000000001',
    'd5000000-0000-0000-0000-000000000001',
    'd6000000-0000-0000-0000-000000000001',
    'd7000000-0000-0000-0000-000000000003',
    'payment-order-unpaid-0003',
    '{}',
    'pickup',
    '2099-01-01 11:30:00+00',
    'EUR',
    900,
    900,
    1
  ),
  (
    'd8000000-0000-0000-0000-000000000004',
    'd2000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    'd4000000-0000-0000-0000-000000000001',
    'd5000000-0000-0000-0000-000000000001',
    'd6000000-0000-0000-0000-000000000001',
    'd7000000-0000-0000-0000-000000000004',
    'payment-order-missing-0004',
    '{}',
    'pickup',
    '2099-01-01 11:45:00+00',
    'EUR',
    700,
    700,
    1
  );

select lives_ok(
  $$
    select private.initialize_order_payment(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'online'
    )
  $$,
  'online payment requirement is created from the order'
);
select results_eq(
  $$
    select collection_mode, status, amount_due_minor, currency_code
    from public.order_payments
    where order_id = 'd8000000-0000-0000-0000-000000000001'
  $$,
  $$values ('online'::text, 'created'::text, 2800::bigint, 'EUR'::text)$$,
  'online payment copies the immutable order amount and currency'
);

select lives_ok(
  $$
    select private.initialize_order_payment(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000002',
      'on_fulfillment'
    )
  $$,
  'pay-on-fulfillment requirement is supported'
);
select results_eq(
  $$
    select collection_mode, status, amount_due_minor, currency_code
    from public.order_payments
    where order_id = 'd8000000-0000-0000-0000-000000000002'
  $$,
  $$values ('on_fulfillment'::text, 'not_required'::text, 1250::bigint, 'EUR'::text)$$,
  'pay-on-fulfillment remains outside the online lifecycle'
);

select lives_ok(
  $$
    select private.initialize_order_payment(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000003',
      'online'
    )
  $$,
  'a second online payment requirement can be created'
);

select is(
  private.initialize_order_payment(
    'd2000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    'd8000000-0000-0000-0000-000000000001',
    'online'
  ),
  (
    select id
    from public.order_payments
    where order_id = 'd8000000-0000-0000-0000-000000000001'
  ),
  'identical payment requirement retries return the existing payment'
);
select throws_ok(
  $$
    select private.initialize_order_payment(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'on_fulfillment'
    )
  $$,
  'P0001',
  'order payment requirement conflicts',
  'a payment collection mode cannot be changed after creation'
);
select throws_ok(
  $$
    select private.initialize_order_payment(
      'd2000000-0000-0000-0000-000000000002',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'online'
    )
  $$,
  'P0001',
  'payment order was not found',
  'cross-tenant payment attachment fails closed'
);

update public.restaurant_feature_flags
set enabled = false
where restaurant_id = 'd2000000-0000-0000-0000-000000000001'
  and feature_key = 'payment.online';

select throws_ok(
  $$
    select private.initialize_order_payment(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000004',
      'online'
    )
  $$,
  'P0001',
  'online payment is not enabled',
  'online payment creation fails when the feature is disabled'
);

update public.restaurant_feature_flags
set enabled = true
where restaurant_id = 'd2000000-0000-0000-0000-000000000001'
  and feature_key = 'payment.online';

set local role service_role;

select throws_ok(
  $$
    select private.create_payment_attempt(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'short',
      'testpay',
      'pay_online_0001'
    )
  $$,
  'P0001',
  'payment attempt key is invalid',
  'short payment attempt keys are rejected'
);
select throws_ok(
  $$
    select private.create_payment_attempt(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000002',
      'payment-attempt-offline',
      'testpay',
      'pay_offline_0002'
    )
  $$,
  'P0001',
  'order does not require online payment',
  'offline payment requirements cannot create provider attempts'
);
select throws_ok(
  $$
    select private.create_payment_attempt(
      'd2000000-0000-0000-0000-000000000002',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'payment-attempt-cross-tenant',
      'testpay',
      'pay_cross_tenant'
    )
  $$,
  'P0001',
  'online payment was not found',
  'cross-tenant payment attempts fail closed'
);
select lives_ok(
  $$
    select private.create_payment_attempt(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'payment-attempt-0001',
      'testpay',
      'pay_online_0001'
    )
  $$,
  'a valid payment attempt is created'
);
select is(
  private.create_payment_attempt(
    'd2000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    'd8000000-0000-0000-0000-000000000001',
    'payment-attempt-0001',
    'testpay',
    'pay_online_0001'
  ),
  (
    select id
    from public.payment_attempts
    where attempt_key = 'payment-attempt-0001'
  ),
  'identical payment attempt retries are idempotent'
);
select throws_ok(
  $$
    select private.create_payment_attempt(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'payment-attempt-0001',
      'testpay',
      'pay_changed_reference'
    )
  $$,
  'P0001',
  'payment attempt key was reused with different values',
  'attempt keys cannot be reused with different provider values'
);

select throws_ok(
  $$
    select private.transition_order_status(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'accepted',
      'd1000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'P0001',
  'order online payment is not captured',
  'an unpaid online order cannot be accepted'
);
select throws_ok(
  $$
    select private.transition_order_status(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000004',
      'accepted',
      'd1000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'P0001',
  'order payment requirement is missing',
  'orders without a payment requirement cannot be accepted'
);
select lives_ok(
  $$
    select private.transition_order_status(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000002',
      'accepted',
      'd1000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'pay-on-fulfillment orders may enter the restaurant lifecycle'
);

select throws_ok(
  $$
    select private.apply_verified_payment_event(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'testpay',
      'pay_online_0001',
      'evt_wrong_amount',
      'payment.authorized',
      'authorized',
      2799,
      'EUR',
      repeat('a', 64),
      '2099-01-01 10:01:00+00'
    )
  $$,
  'P0001',
  'payment provider amount does not match order',
  'provider events with a different amount are rejected'
);
select throws_ok(
  $$
    select private.apply_verified_payment_event(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'testpay',
      'pay_online_0001',
      'evt_wrong_currency',
      'payment.authorized',
      'authorized',
      2800,
      'USD',
      repeat('b', 64),
      '2099-01-01 10:01:00+00'
    )
  $$,
  'P0001',
  'payment provider currency does not match order',
  'provider events with a different currency are rejected'
);
select throws_ok(
  $$
    select private.apply_verified_payment_event(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'testpay',
      'pay_online_0001',
      'evt_bad_digest',
      'payment.authorized',
      'authorized',
      2800,
      'EUR',
      'not-a-digest',
      '2099-01-01 10:01:00+00'
    )
  $$,
  'P0001',
  'payment payload digest is invalid',
  'provider event payload digests are validated'
);

select lives_ok(
  $$
    select private.apply_verified_payment_event(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'testpay',
      'pay_online_0001',
      'evt_authorized_0001',
      'payment.authorized',
      'authorized',
      2800,
      'EUR',
      repeat('c', 64),
      '2099-01-01 10:02:00+00'
    )
  $$,
  'a verified authorization event is applied'
);
select is(
  private.apply_verified_payment_event(
    'd2000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    'd8000000-0000-0000-0000-000000000001',
    'testpay',
    'pay_online_0001',
    'evt_authorized_0001',
    'payment.authorized',
    'authorized',
    2800,
    'EUR',
    repeat('c', 64),
    '2099-01-01 10:02:00+00'
  ),
  (
    select id
    from public.payment_provider_events
    where provider_event_id = 'evt_authorized_0001'
  ),
  'identical provider event delivery returns the existing event'
);
select throws_ok(
  $$
    select private.apply_verified_payment_event(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'testpay',
      'pay_online_0001',
      'evt_authorized_0001',
      'payment.authorized',
      'authorized',
      2800,
      'EUR',
      repeat('d', 64),
      '2099-01-01 10:02:00+00'
    )
  $$,
  'P0001',
  'payment provider event id was reused with different values',
  'provider event ids cannot be reused with changed metadata'
);

select lives_ok(
  $$
    select private.apply_verified_payment_event(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'testpay',
      'pay_online_0001',
      'evt_captured_0001',
      'payment.captured',
      'captured',
      2800,
      'EUR',
      repeat('e', 64),
      '2099-01-01 10:03:00+00'
    )
  $$,
  'a verified capture event is applied'
);
select results_eq(
  $$
    select status, captured_amount_minor, refunded_amount_minor
    from public.order_payments
    where order_id = 'd8000000-0000-0000-0000-000000000001'
  $$,
  $$values ('captured'::text, 2800::bigint, 0::bigint)$$,
  'capture records the exact immutable order amount'
);
select lives_ok(
  $$
    select private.transition_order_status(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'accepted',
      'd1000000-0000-0000-0000-000000000001',
      'aal2'
    )
  $$,
  'a captured online order may be accepted'
);

select lives_ok(
  $$
    select private.apply_verified_payment_event(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'testpay',
      'pay_online_0001',
      'evt_partial_refund_0001',
      'payment.partially_refunded',
      'partially_refunded',
      1000,
      'EUR',
      repeat('f', 64),
      '2099-01-01 10:04:00+00'
    )
  $$,
  'a cumulative partial refund is recorded'
);
select lives_ok(
  $$
    select private.apply_verified_payment_event(
      'd2000000-0000-0000-0000-000000000001',
      'd3000000-0000-0000-0000-000000000001',
      'd8000000-0000-0000-0000-000000000001',
      'testpay',
      'pay_online_0001',
      'evt_full_refund_0001',
      'payment.refunded',
      'refunded',
      2800,
      'EUR',
      repeat('0', 64),
      '2099-01-01 10:05:00+00'
    )
  $$,
  'a full cumulative refund is recorded'
);

reset role;

select results_eq(
  $$
    select status, captured_amount_minor, refunded_amount_minor
    from public.order_payments
    where order_id = 'd8000000-0000-0000-0000-000000000001'
  $$,
  $$values ('refunded'::text, 2800::bigint, 2800::bigint)$$,
  'refund totals cannot exceed the captured amount'
);
select results_eq(
  $$
    select event_sequence, to_status, source_kind
    from public.payment_status_events
    where payment_id = (
      select id
      from public.order_payments
      where order_id = 'd8000000-0000-0000-0000-000000000001'
    )
    order by event_sequence
  $$,
  $$
    values
      (1, 'created'::text, 'system'::text),
      (2, 'pending_customer'::text, 'system'::text),
      (3, 'authorized'::text, 'verified_provider'::text),
      (4, 'captured'::text, 'verified_provider'::text),
      (5, 'partially_refunded'::text, 'verified_provider'::text),
      (6, 'refunded'::text, 'verified_provider'::text)
  $$,
  'payment history remains complete and ordered'
);
select is(
  (
    select count(*)::integer
    from public.payment_provider_events
    where payment_id = (
      select id
      from public.order_payments
      where order_id = 'd8000000-0000-0000-0000-000000000001'
    )
  ),
  4,
  'duplicate and rejected provider events create no extra records'
);
select is(
  (
    select count(*)::integer
    from public.outbox_events
    where aggregate_id = (
      select id
      from public.order_payments
      where order_id = 'd8000000-0000-0000-0000-000000000001'
    )
      and event_type = 'payment.status_changed'
  ),
  4,
  'every accepted provider transition emits one outbox event'
);
select ok(
  not (
    select bool_or(
      payload ?| array[
        'provider_payment_reference',
        'provider_event_id',
        'payload_sha256',
        'customer',
        'email',
        'card'
      ]
    )
    from public.outbox_events
    where aggregate_id = (
      select id
      from public.order_payments
      where order_id = 'd8000000-0000-0000-0000-000000000001'
    )
  ),
  'payment outbox payloads exclude provider references, digests and payer data'
);

select throws_ok(
  $$
    update public.order_payments
    set amount_due_minor = amount_due_minor + 1
    where order_id = 'd8000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'payment obligation is immutable',
  'stored payment amounts cannot be rewritten'
);
select throws_ok(
  $$
    update public.payment_attempts
    set provider_payment_reference = 'rewritten'
    where attempt_key = 'payment-attempt-0001'
  $$,
  '23514',
  'payment records are append-only',
  'payment attempts cannot be rewritten'
);
select throws_ok(
  $$
    delete from public.payment_provider_events
    where provider_event_id = 'evt_captured_0001'
  $$,
  '23514',
  'payment records are append-only',
  'verified provider events cannot be deleted'
);
select throws_ok(
  $$
    delete from public.payment_status_events
    where payment_id = (
      select id
      from public.order_payments
      where order_id = 'd8000000-0000-0000-0000-000000000001'
    )
      and event_sequence = 1
  $$,
  '23514',
  'payment records are append-only',
  'payment status history cannot be deleted'
);

set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000001","aal":"aal2"}';

select is(
  (select count(*)::integer from public.order_payments),
  3,
  'an aal2 owner can read payments for its restaurant'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-000000000002';
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000002","aal":"aal1"}';

select is(
  (select count(*)::integer from public.order_payments),
  0,
  'kitchen personnel cannot read payment records'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000003","aal":"aal2"}';

select is(
  (select count(*)::integer from public.order_payments),
  0,
  'an owner from another tenant cannot read payment records'
);

reset role;

select * from finish();
rollback;
