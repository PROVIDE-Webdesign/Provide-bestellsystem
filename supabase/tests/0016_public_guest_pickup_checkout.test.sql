begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select no_plan();
\ir fixtures/storefront.fixture.inc

select has_function(
  'private',
  'submit_public_guest_pickup_order',
  array['text','text','uuid','uuid','timestamptz','jsonb','text','jsonb','text','integer','timestamptz'],
  'public pickup checkout function exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.submit_public_guest_pickup_order(text,text,uuid,uuid,timestamptz,jsonb,text,jsonb,text,integer,timestamptz)',
    'execute'
  ),
  'server may execute the controlled pickup checkout'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.submit_public_guest_pickup_order(text,text,uuid,uuid,timestamptz,jsonb,text,jsonb,text,integer,timestamptz)',
    'execute'
  ),
  'anonymous browser cannot execute checkout SQL directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.submit_public_guest_pickup_order(text,text,uuid,uuid,timestamptz,jsonb,text,jsonb,text,integer,timestamptz)',
    'execute'
  ),
  'authenticated browser cannot execute checkout SQL directly'
);

set local role service_role;
select private.submit_public_guest_pickup_order(
  'storefront-restaurant-a',
  'storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001',
  'f5000000-0000-0000-0000-000000000001',
  date_trunc('hour', now()) + interval '2 hours',
  '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2}]',
  'pickup-checkout-key-0001',
  '{"contact_name":"Synthetic Guest","phone_e164":"+999100000001","email":"guest@example.invalid"}',
  'preview-v1',
  30
) as first_confirmation \gset

select is(:'first_confirmation'::jsonb ->> 'status', 'submitted', 'checkout confirms submitted status');
select is(:'first_confirmation'::jsonb ->> 'fulfillmentType', 'pickup', 'checkout is fixed to pickup');
select is(:'first_confirmation'::jsonb ->> 'paymentCollectionMode', 'on_fulfillment', 'checkout cannot choose online payment');
select is(:'first_confirmation'::jsonb ->> 'totalAmountMinor', '2500', 'checkout total comes from published server prices');
select is(:'first_confirmation'::jsonb ->> 'itemCount', '2', 'checkout confirms the server item count');
select is(
  (select count(*)::integer from jsonb_object_keys(:'first_confirmation'::jsonb)),
  8,
  'confirmation exposes only approved fields'
);

select is(
  private.submit_public_guest_pickup_order(
    'storefront-restaurant-a',
    'storefront-a-mitte',
    'f4000000-0000-0000-0000-000000000001',
    'f5000000-0000-0000-0000-000000000001',
    date_trunc('hour', now()) + interval '2 hours',
    '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2}]',
    'pickup-checkout-key-0001',
    '{"contact_name":"Synthetic Guest","phone_e164":"+999100000001","email":"guest@example.invalid"}',
    'preview-v1',
    30
  ) ->> 'orderId',
  :'first_confirmation'::jsonb ->> 'orderId',
  'identical retry returns the same order'
);
reset role;

update public.restaurant_feature_flags
set enabled = false
where restaurant_id = 'f2000000-0000-0000-0000-000000000001'
  and feature_key = 'catalog.public_menu';
set local role service_role;
select is(
  private.submit_public_guest_pickup_order(
    'storefront-restaurant-a',
    'storefront-a-mitte',
    'f4000000-0000-0000-0000-000000000001',
    'f5000000-0000-0000-0000-000000000001',
    date_trunc('hour', now()) + interval '2 hours',
    '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2}]',
    'pickup-checkout-key-0001',
    '{"contact_name":"Synthetic Guest","phone_e164":"+999100000001","email":"guest@example.invalid"}',
    'preview-v1',
    30
  ) ->> 'orderId',
  :'first_confirmation'::jsonb ->> 'orderId',
  'matching retry survives a later public visibility change'
);
reset role;
update public.restaurant_feature_flags
set enabled = true
where restaurant_id = 'f2000000-0000-0000-0000-000000000001'
  and feature_key = 'catalog.public_menu';

select is(
  (select count(*)::integer from public.orders where submission_key = 'pickup-checkout-key-0001'),
  1,
  'idempotent retry creates one order'
);
select is(
  (select total_amount_minor::text from public.orders where submission_key = 'pickup-checkout-key-0001'),
  '2500',
  'persisted total is server-derived'
);
select is(
  (select collection_mode from public.order_payments where order_id = (:'first_confirmation'::jsonb ->> 'orderId')::uuid),
  'on_fulfillment',
  'persisted payment mode is fixed'
);
select is(
  (select contact_name from public.order_customer_contacts where order_id = (:'first_confirmation'::jsonb ->> 'orderId')::uuid),
  'Synthetic Guest',
  'minimal contact snapshot is stored separately'
);
select ok(
  not exists (
    select 1 from public.outbox_events
    where payload::text like '%Synthetic Guest%'
      or payload::text like '%999100000001%'
      or payload::text like '%guest@example.invalid%'
  ),
  'personal data is absent from outbox payloads'
);

set local role service_role;
select throws_ok(
  $$select private.submit_public_guest_pickup_order(
    'storefront-restaurant-b','storefront-a-mitte',
    'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
    date_trunc('hour',now()) + interval '2 hours',
    '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
    'pickup-checkout-key-0002',
    '{"contact_name":"Synthetic Guest","phone_e164":"+999100000001","email":null}',
    'preview-v1',30
  )$$,
  'P0001',
  'public pickup checkout is unavailable',
  'cross-tenant scope is hidden'
);
select throws_ok(
  $$select private.submit_public_guest_pickup_order(
    'storefront-restaurant-a','storefront-a-mitte',
    'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
    date_trunc('hour',now()) + interval '2 hours',
    '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
    'pickup-checkout-key-0001',
    '{"contact_name":"Synthetic Guest","phone_e164":"+999100000001","email":"guest@example.invalid"}',
    'preview-v1',30
  )$$,
  'P0001',
  'order submission key was reused with different values',
  'changed retry is rejected'
);
select throws_ok(
  $$select private.submit_public_guest_pickup_order(
    'storefront-restaurant-a','storefront-a-mitte',
    'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
    date_trunc('hour',now()) + interval '2 hours',
    '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
    'pickup-checkout-key-0003',
    '{"contact_name":"Synthetic Guest","phone_e164":"+999100000001","email":null}',
    'preview-v1',731
  )$$,
  '22023',
  'pickup checkout retention is invalid',
  'retention above the database maximum is rejected'
);
reset role;

select * from finish();
rollback;
