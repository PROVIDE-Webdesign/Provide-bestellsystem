begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select no_plan();
\ir fixtures/storefront.fixture.inc

select has_function(
  'private',
  'read_public_guest_order_status',
  array['text','text','uuid','timestamptz'],
  'public guest order status function exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.read_public_guest_order_status(text,text,uuid,timestamptz)',
    'execute'
  ),
  'server may execute the controlled status read'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.read_public_guest_order_status(text,text,uuid,timestamptz)',
    'execute'
  ),
  'anonymous browser cannot execute status SQL directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.read_public_guest_order_status(text,text,uuid,timestamptz)',
    'execute'
  ),
  'authenticated browser cannot execute status SQL directly'
);

set local role service_role;
select private.submit_public_guest_pickup_order(
  'storefront-restaurant-a',
  'storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001',
  'f5000000-0000-0000-0000-000000000001',
  date_trunc('hour', now()) + interval '2 hours',
  '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2}]',
  'public-status-key-0001',
  '{"contact_name":"Synthetic Status Guest","phone_e164":"+999100000001","email":"status@example.invalid"}',
  'preview-v1',
  30
) as confirmation \gset

select private.read_public_guest_order_status(
  'storefront-restaurant-a',
  'storefront-a-mitte',
  (:'confirmation'::jsonb ->> 'orderId')::uuid,
  statement_timestamp()
) as initial_status \gset

select is(:'initial_status'::jsonb ->> 'status', 'submitted', 'guest reads submitted status');
select is(:'initial_status'::jsonb ->> 'fulfillmentType', 'pickup', 'status remains pickup only');
select is(:'initial_status'::jsonb ->> 'paymentCollectionMode', 'on_fulfillment', 'status exposes fixed payment mode');
select is(:'initial_status'::jsonb ->> 'totalAmountMinor', '2500', 'status exposes server total');
select is(
  (select count(*)::integer from jsonb_object_keys(:'initial_status'::jsonb)),
  10,
  'status exposes exactly ten approved fields'
);
select ok(
  :'initial_status' not like '%Synthetic Status Guest%'
    and :'initial_status' not like '%999100000001%'
    and :'initial_status' not like '%status@example.invalid%'
    and :'initial_status' not like '%actor%',
  'status contains no personal or actor data'
);

select private.transition_order_status(
  'f2000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',
  (:'confirmation'::jsonb ->> 'orderId')::uuid,
  'accepted',
  'f1000000-0000-0000-0000-000000000001',
  'aal2'
);
select is(
  private.read_public_guest_order_status(
    'storefront-restaurant-a','storefront-a-mitte',
    (:'confirmation'::jsonb ->> 'orderId')::uuid,statement_timestamp()
  ) ->> 'status',
  'accepted',
  'guest reads an authorized status transition'
);

select is(
  private.read_public_guest_order_status(
    'storefront-restaurant-b','storefront-b-mitte',
    (:'confirmation'::jsonb ->> 'orderId')::uuid,statement_timestamp()
  ),
  null,
  'cross-tenant scope is hidden'
);
select is(
  private.read_public_guest_order_status(
    'storefront-restaurant-a','storefront-a-mitte',
    '00000000-0000-0000-0000-000000000000',statement_timestamp()
  ),
  null,
  'unknown order is hidden'
);
select is(
  private.read_public_guest_order_status(
    'storefront-restaurant-a','storefront-a-mitte',
    (:'confirmation'::jsonb ->> 'orderId')::uuid,
    (:'initial_status'::jsonb ->> 'statusAvailableUntil')::timestamptz + interval '1 millisecond'
  ),
  null,
  'status expires forty-eight hours after pickup time'
);

update public.restaurants
set status = 'suspended'
where id = 'f2000000-0000-0000-0000-000000000001';
select is(
  private.read_public_guest_order_status(
    'storefront-restaurant-a','storefront-a-mitte',
    (:'confirmation'::jsonb ->> 'orderId')::uuid,statement_timestamp()
  ) ->> 'status',
  'accepted',
  'existing status remains available when the catalog scope is suspended'
);
reset role;

select * from finish();
rollback;
