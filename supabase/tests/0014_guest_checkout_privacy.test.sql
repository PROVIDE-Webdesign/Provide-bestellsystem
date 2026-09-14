begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(64);

select has_table('public', 'order_customer_contacts', 'guest order contact table exists');
select has_table('public', 'order_delivery_details', 'delivery handover table exists');
select has_function(
  'private',
  'store_guest_checkout_snapshot',
  array['uuid', 'uuid', 'uuid', 'jsonb', 'jsonb', 'text', 'timestamptz'],
  'internal guest checkout snapshot function exists'
);
select has_function(
  'private',
  'submit_guest_order',
  array[
    'uuid',
    'uuid',
    'uuid',
    'uuid',
    'text',
    'timestamptz',
    'jsonb',
    'text',
    'jsonb',
    'jsonb',
    'text',
    'timestamptz',
    'timestamptz',
    'text'
  ],
  'atomic guest order submission function exists'
);
select has_function(
  'private',
  'purge_expired_guest_checkout_data',
  array['timestamptz', 'integer'],
  'bounded personal data purge function exists'
);
select has_trigger(
  'public',
  'order_customer_contacts',
  'order_customer_contacts_protect_update',
  'customer contacts are immutable before purge'
);
select has_trigger(
  'public',
  'order_customer_contacts',
  'order_customer_contacts_prevent_delete',
  'customer contacts cannot be deleted directly'
);
select has_trigger(
  'public',
  'order_delivery_details',
  'order_delivery_details_protect_update',
  'delivery details are immutable before purge'
);
select has_trigger(
  'public',
  'order_delivery_details',
  'order_delivery_details_prevent_delete',
  'delivery details cannot be deleted directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.submit_guest_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,jsonb,jsonb,text,timestamptz,timestamptz,text)',
    'execute'
  ),
  'service role may use the controlled guest order boundary'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.purge_expired_guest_checkout_data(timestamptz,integer)',
    'execute'
  ),
  'service role may run the bounded personal data purge'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.store_guest_checkout_snapshot(uuid,uuid,uuid,jsonb,jsonb,text,timestamptz)',
    'execute'
  ),
  'service role cannot attach personal data outside guest order submission'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.submit_guest_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,jsonb,jsonb,text,timestamptz,timestamptz,text)',
    'execute'
  ),
  'authenticated browsers cannot submit through the server boundary'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.submit_guest_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,jsonb,jsonb,text,timestamptz,timestamptz,text)',
    'execute'
  ),
  'anonymous callers cannot invoke the server boundary directly'
);
select ok(
  has_table_privilege('authenticated', 'public.order_customer_contacts', 'select'),
  'authenticated personnel receive RLS-filtered contact reads'
);
select ok(
  has_table_privilege('authenticated', 'public.order_delivery_details', 'select'),
  'authenticated personnel receive RLS-filtered delivery reads'
);
select ok(
  not has_table_privilege('service_role', 'public.order_customer_contacts', 'select'),
  'service role cannot read customer contacts directly'
);
select ok(
  not has_table_privilege('service_role', 'public.order_delivery_details', 'select'),
  'service role cannot read delivery details directly'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.order_customer_contacts',
    'insert,update,delete'
  ),
  'service role cannot write customer contacts directly'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.order_delivery_details',
    'insert,update,delete'
  ),
  'service role cannot write delivery details directly'
);
select hasnt_column(
  'public',
  'order_customer_contacts',
  'date_of_birth',
  'guest checkout does not collect a date of birth'
);
select hasnt_column(
  'public',
  'order_delivery_details',
  'delivery_instructions',
  'free-form delivery instructions are excluded from the privacy foundation'
);
select hasnt_column(
  'public',
  'orders',
  'customer_name',
  'personal contact data remains outside the operational order table'
);

insert into auth.users (id, email)
values
  ('e1000000-0000-0000-0000-000000000001', 'checkout-owner-a@example.invalid'),
  ('e1000000-0000-0000-0000-000000000002', 'checkout-manager-a@example.invalid'),
  ('e1000000-0000-0000-0000-000000000003', 'checkout-kitchen-a@example.invalid'),
  ('e1000000-0000-0000-0000-000000000004', 'checkout-driver-a@example.invalid'),
  ('e1000000-0000-0000-0000-000000000005', 'checkout-owner-b@example.invalid');

insert into public.restaurants (id, slug, display_name, status)
values
  (
    'e2000000-0000-0000-0000-000000000001',
    'checkout-restaurant-a',
    'Checkout Restaurant A',
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000002',
    'checkout-restaurant-b',
    'Checkout Restaurant B',
    'active'
  );

insert into public.restaurant_memberships (restaurant_id, user_id, role, status)
values
  (
    'e2000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'owner',
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000002',
    'manager',
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000003',
    'kitchen',
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000004',
    'driver',
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000002',
    'e1000000-0000-0000-0000-000000000005',
    'owner',
    'active'
  );

insert into public.locations (id, restaurant_id, slug, display_name, status)
values
  (
    'e3000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000001',
    'checkout-a-mitte',
    'Checkout A Mitte',
    'active'
  ),
  (
    'e3000000-0000-0000-0000-000000000002',
    'e2000000-0000-0000-0000-000000000002',
    'checkout-b-mitte',
    'Checkout B Mitte',
    'active'
  );

insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
values
  (
    'e2000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000002',
    'e3000000-0000-0000-0000-000000000001'
  ),
  (
    'e2000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000003',
    'e3000000-0000-0000-0000-000000000001'
  ),
  (
    'e2000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000004',
    'e3000000-0000-0000-0000-000000000001'
  );

insert into public.menus (id, restaurant_id, slug, display_name)
values (
  'e4000000-0000-0000-0000-000000000001',
  'e2000000-0000-0000-0000-000000000001',
  'checkout-menu',
  'Checkout Menu'
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
  'e5000000-0000-0000-0000-000000000001',
  'e2000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000001',
  1,
  'EUR',
  'e1000000-0000-0000-0000-000000000001'
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
  'e6000000-0000-0000-0000-000000000001',
  'e2000000-0000-0000-0000-000000000001',
  'e3000000-0000-0000-0000-000000000001',
  1,
  10,
  100,
  'e1000000-0000-0000-0000-000000000001'
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
    'e7000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000001',
    'pickup',
    '2099-01-01 11:00:00+00',
    'checkout-order-claim-0001',
    'reserve',
    1,
    1
  ),
  (
    'e7000000-0000-0000-0000-000000000002',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000001',
    'delivery',
    '2099-01-01 11:15:00+00',
    'checkout-order-claim-0002',
    'reserve',
    1,
    1
  ),
  (
    'e7000000-0000-0000-0000-000000000003',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000001',
    'delivery',
    '2099-01-01 11:30:00+00',
    'checkout-order-claim-0003',
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
  status,
  currency_code,
  subtotal_amount_minor,
  total_amount_minor,
  item_count,
  created_at,
  updated_at
)
values
  (
    'e8000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e4000000-0000-0000-0000-000000000001',
    'e5000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000001',
    'e7000000-0000-0000-0000-000000000001',
    'checkout-pickup-0001',
    '{}',
    'pickup',
    '2099-01-01 11:00:00+00',
    'completed',
    'EUR',
    1000,
    1000,
    1,
    '2099-01-01 09:00:00+00',
    '2099-01-01 09:00:00+00'
  ),
  (
    'e8000000-0000-0000-0000-000000000002',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e4000000-0000-0000-0000-000000000001',
    'e5000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000001',
    'e7000000-0000-0000-0000-000000000002',
    'checkout-delivery-0002',
    '{}',
    'delivery',
    '2099-01-01 11:15:00+00',
    'completed',
    'EUR',
    1500,
    1500,
    1,
    '2099-01-01 09:15:00+00',
    '2099-01-01 09:15:00+00'
  ),
  (
    'e8000000-0000-0000-0000-000000000003',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e4000000-0000-0000-0000-000000000001',
    'e5000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000001',
    'e7000000-0000-0000-0000-000000000003',
    'checkout-active-0003',
    '{}',
    'delivery',
    '2099-01-01 11:30:00+00',
    'submitted',
    'EUR',
    2000,
    2000,
    1,
    '2099-01-01 09:30:00+00',
    '2099-01-01 09:30:00+00'
  );

select is(
  private.store_guest_checkout_snapshot(
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e8000000-0000-0000-0000-000000000001',
    '{"contact_name":"  Pickup Guest  ","phone_e164":"+999100000001","email":"PICKUP@EXAMPLE.INVALID"}',
    null,
    'privacy-v1',
    '2099-02-01 09:00:00+00'
  ),
  'e8000000-0000-0000-0000-000000000001'::uuid,
  'pickup guest checkout snapshot is stored'
);
select is(
  private.store_guest_checkout_snapshot(
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e8000000-0000-0000-0000-000000000002',
    '{"contact_name":"Delivery Guest","phone_e164":"+999100000002","email":null}',
    '{"address_line_1":"Main Street 2","address_line_2":" Rear ","postal_code":"52062","city":"Aachen","country_code":"de"}',
    'privacy-v1',
    '2099-02-01 09:15:00+00'
  ),
  'e8000000-0000-0000-0000-000000000002'::uuid,
  'delivery guest checkout snapshot is stored'
);
select is(
  private.store_guest_checkout_snapshot(
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e8000000-0000-0000-0000-000000000003',
    '{"contact_name":"Active Guest","phone_e164":"+999100000003","email":"active@example.invalid"}',
    '{"address_line_1":"Open Street 3","postal_code":"52064","city":"Aachen","country_code":"DE"}',
    'privacy-v1',
    '2099-02-01 09:30:00+00'
  ),
  'e8000000-0000-0000-0000-000000000003'::uuid,
  'active order guest checkout snapshot is stored'
);

select results_eq(
  $$
    select contact_name, phone_e164, email, privacy_notice_version
    from public.order_customer_contacts
    where order_id = 'e8000000-0000-0000-0000-000000000001'
  $$,
  $$values ('Pickup Guest'::text, '+999100000001'::text, 'pickup@example.invalid'::text, 'privacy-v1'::text)$$,
  'customer contact values are normalized'
);
select results_eq(
  $$
    select recipient_name, phone_e164, address_line_1, address_line_2, postal_code, city, country_code
    from public.order_delivery_details
    where order_id = 'e8000000-0000-0000-0000-000000000002'
  $$,
  $$values ('Delivery Guest'::text, '+999100000002'::text, 'Main Street 2'::text, 'Rear'::text, '52062'::text, 'Aachen'::text, 'DE'::text)$$,
  'delivery handover values are normalized and purpose-limited'
);
select is(
  (
    select count(*)::integer
    from public.order_delivery_details
    where order_id = 'e8000000-0000-0000-0000-000000000001'
  ),
  0,
  'pickup orders do not store delivery details'
);
select is(
  private.store_guest_checkout_snapshot(
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e8000000-0000-0000-0000-000000000001',
    '{"contact_name":"Pickup Guest","phone_e164":"+999100000001","email":"pickup@example.invalid"}',
    '{}',
    'privacy-v1',
    '2099-02-01 09:00:00+00'
  ),
  'e8000000-0000-0000-0000-000000000001'::uuid,
  'an identical guest checkout retry is idempotent'
);
select throws_ok(
  $$
    select private.store_guest_checkout_snapshot(
      'e2000000-0000-0000-0000-000000000001',
      'e3000000-0000-0000-0000-000000000001',
      'e8000000-0000-0000-0000-000000000001',
      '{"contact_name":"Pickup Guest","phone_e164":"+999100000004"}',
      null,
      'privacy-v1',
      '2099-02-01 09:00:00+00'
    )
  $$,
  'P0001',
  'guest checkout snapshot conflicts with the existing order',
  'an idempotency retry cannot replace customer data'
);
select throws_ok(
  $$
    select private.store_guest_checkout_snapshot(
      'e2000000-0000-0000-0000-000000000001',
      'e3000000-0000-0000-0000-000000000001',
      'e8000000-0000-0000-0000-000000000002',
      '{"contact_name":"Delivery Guest","phone_e164":"+999100000002"}',
      null,
      'privacy-v1',
      '2099-02-01 09:15:00+00'
    )
  $$,
  'P0001',
  'delivery address is required',
  'delivery orders require an address'
);
select throws_ok(
  $$
    select private.store_guest_checkout_snapshot(
      'e2000000-0000-0000-0000-000000000001',
      'e3000000-0000-0000-0000-000000000001',
      'e8000000-0000-0000-0000-000000000001',
      '{"contact_name":"Pickup Guest","phone_e164":"+999100000001"}',
      '{"address_line_1":"Wrong Street 1","postal_code":"52062","city":"Aachen","country_code":"DE"}',
      'privacy-v1',
      '2099-02-01 09:00:00+00'
    )
  $$,
  'P0001',
  'pickup orders cannot store delivery data',
  'pickup orders reject delivery details'
);
select throws_ok(
  $$
    select private.store_guest_checkout_snapshot(
      'e2000000-0000-0000-0000-000000000001',
      'e3000000-0000-0000-0000-000000000001',
      'e8000000-0000-0000-0000-000000000003',
      '{"contact_name":"Bad Phone","phone_e164":"0170 123"}',
      '{"address_line_1":"Open Street 3","postal_code":"52064","city":"Aachen","country_code":"DE"}',
      'privacy-v1',
      '2099-02-01 09:30:00+00'
    )
  $$,
  'P0001',
  'guest checkout phone number is invalid',
  'non-E.164 phone numbers are rejected'
);
select throws_ok(
  $$
    select private.store_guest_checkout_snapshot(
      'e2000000-0000-0000-0000-000000000001',
      'e3000000-0000-0000-0000-000000000001',
      'e8000000-0000-0000-0000-000000000003',
      '{"contact_name":"Bad Email","phone_e164":"+999100000003","email":"not-an-email"}',
      '{"address_line_1":"Open Street 3","postal_code":"52064","city":"Aachen","country_code":"DE"}',
      'privacy-v1',
      '2099-02-01 09:30:00+00'
    )
  $$,
  'P0001',
  'guest checkout email is invalid',
  'invalid optional email addresses are rejected'
);
select throws_ok(
  $$
    select private.store_guest_checkout_snapshot(
      'e2000000-0000-0000-0000-000000000001',
      'e3000000-0000-0000-0000-000000000001',
      'e8000000-0000-0000-0000-000000000003',
      '{"contact_name":"Extra Data","phone_e164":"+999100000003","birth_date":"2000-01-01"}',
      '{"address_line_1":"Open Street 3","postal_code":"52064","city":"Aachen","country_code":"DE"}',
      'privacy-v1',
      '2099-02-01 09:30:00+00'
    )
  $$,
  'P0001',
  'guest checkout customer data contains unsupported fields',
  'unsupported customer fields are rejected'
);
select throws_ok(
  $$
    select private.store_guest_checkout_snapshot(
      'e2000000-0000-0000-0000-000000000001',
      'e3000000-0000-0000-0000-000000000001',
      'e8000000-0000-0000-0000-000000000003',
      '{"contact_name":"Extra Address","phone_e164":"+999100000003"}',
      '{"address_line_1":"Open Street 3","postal_code":"52064","city":"Aachen","country_code":"DE","instructions":"door"}',
      'privacy-v1',
      '2099-02-01 09:30:00+00'
    )
  $$,
  'P0001',
  'delivery address contains unsupported fields',
  'unsupported free-form delivery fields are rejected'
);
select throws_ok(
  $$
    select private.store_guest_checkout_snapshot(
      'e2000000-0000-0000-0000-000000000001',
      'e3000000-0000-0000-0000-000000000001',
      'e8000000-0000-0000-0000-000000000003',
      '{"contact_name":"Notice Guest","phone_e164":"+999100000003"}',
      '{"address_line_1":"Open Street 3","postal_code":"52064","city":"Aachen","country_code":"DE"}',
      'invalid notice version',
      '2099-02-01 09:30:00+00'
    )
  $$,
  'P0001',
  'privacy notice version is invalid',
  'privacy notice versions are constrained'
);
select throws_ok(
  $$
    select private.store_guest_checkout_snapshot(
      'e2000000-0000-0000-0000-000000000001',
      'e3000000-0000-0000-0000-000000000001',
      'e8000000-0000-0000-0000-000000000003',
      '{"contact_name":"Retention Guest","phone_e164":"+999100000003"}',
      '{"address_line_1":"Open Street 3","postal_code":"52064","city":"Aachen","country_code":"DE"}',
      'privacy-v1',
      '2102-01-01 09:30:00+00'
    )
  $$,
  'P0001',
  'guest checkout retention date is invalid',
  'retention dates beyond the safety ceiling are rejected'
);
select throws_ok(
  $$
    select private.store_guest_checkout_snapshot(
      'e2000000-0000-0000-0000-000000000002',
      'e3000000-0000-0000-0000-000000000002',
      'e8000000-0000-0000-0000-000000000003',
      '{"contact_name":"Foreign Guest","phone_e164":"+999100000003"}',
      '{"address_line_1":"Open Street 3","postal_code":"52064","city":"Aachen","country_code":"DE"}',
      'privacy-v1',
      '2099-02-01 09:30:00+00'
    )
  $$,
  'P0001',
  'guest checkout order was not found',
  'tenant and location boundaries cannot be crossed'
);
select throws_ok(
  $$
    update public.order_customer_contacts
    set phone_e164 = '+999100000099'
    where order_id = 'e8000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'order customer contact is immutable',
  'stored customer contacts cannot be rewritten'
);
select throws_ok(
  $$
    update public.order_delivery_details
    set city = 'Cologne'
    where order_id = 'e8000000-0000-0000-0000-000000000002'
  $$,
  '23514',
  'order delivery detail is immutable',
  'stored delivery details cannot be rewritten'
);
select throws_ok(
  $$
    delete from public.order_customer_contacts
    where order_id = 'e8000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'order personal data cannot be deleted directly',
  'customer contacts cannot be deleted directly'
);
select throws_ok(
  $$
    delete from public.order_delivery_details
    where order_id = 'e8000000-0000-0000-0000-000000000002'
  $$,
  '23514',
  'order personal data cannot be deleted directly',
  'delivery details cannot be deleted directly'
);

set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000001","aal":"aal2"}';

select is(
  (select count(*)::integer from public.order_customer_contacts),
  3,
  'an owner can read customer contacts for its restaurant'
);
select is(
  (select count(*)::integer from public.order_delivery_details),
  2,
  'an owner can read delivery details for its restaurant'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-000000000002';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000002","aal":"aal2"}';

select is(
  (select count(*)::integer from public.order_customer_contacts),
  3,
  'an assigned manager can read location customer contacts'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-000000000004';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000004","aal":"aal1"}';

select is(
  (select count(*)::integer from public.order_customer_contacts),
  0,
  'drivers cannot read the broader customer contact table'
);
select is(
  (select count(*)::integer from public.order_delivery_details),
  2,
  'an assigned driver can read delivery handover details'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000003","aal":"aal1"}';

select is(
  (select count(*)::integer from public.order_customer_contacts),
  0,
  'kitchen personnel cannot read customer contacts'
);
select is(
  (select count(*)::integer from public.order_delivery_details),
  0,
  'kitchen personnel cannot read delivery details'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-000000000005';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000005","aal":"aal2"}';

select is(
  (select count(*)::integer from public.order_customer_contacts),
  0,
  'an owner from another tenant cannot read customer contacts'
);

reset role;
set local role service_role;

select is(
  private.purge_expired_guest_checkout_data('2100-01-01 00:00:00+00', 10),
  2,
  'expired personal data for terminal orders is purged'
);
select is(
  private.purge_expired_guest_checkout_data('2100-01-01 00:00:00+00', 10),
  0,
  'personal data purge is idempotent'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.order_customer_contacts
    where purged_at = '2100-01-01 00:00:00+00'
      and contact_name is null
      and phone_e164 is null
      and email is null
  ),
  2,
  'purged customer rows retain only non-personal audit structure'
);
select is(
  (
    select count(*)::integer
    from public.order_delivery_details
    where purged_at = '2100-01-01 00:00:00+00'
      and recipient_name is null
      and phone_e164 is null
      and address_line_1 is null
  ),
  1,
  'purged delivery rows no longer contain handover data'
);
select is(
  (
    select count(*)::integer
    from public.order_customer_contacts
    where order_id = 'e8000000-0000-0000-0000-000000000003'
      and purged_at is null
      and contact_name = 'Active Guest'
  ),
  1,
  'active orders keep required customer data past the nominal retention date'
);
select is(
  (
    select count(*)::integer
    from public.order_delivery_details
    where order_id = 'e8000000-0000-0000-0000-000000000003'
      and purged_at is null
      and city = 'Aachen'
  ),
  1,
  'active delivery handover data is not purged'
);

set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000001","aal":"aal2"}';

select is(
  (select count(*)::integer from public.order_customer_contacts),
  1,
  'purged customer contacts disappear from management reads'
);
select is(
  (select count(*)::integer from public.order_delivery_details),
  1,
  'purged delivery details disappear from fulfillment reads'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.orders
    where id in (
      'e8000000-0000-0000-0000-000000000001',
      'e8000000-0000-0000-0000-000000000002',
      'e8000000-0000-0000-0000-000000000003'
    )
  ),
  3,
  'personal data purge does not remove operational order records'
);
select is(
  (
    select count(*)::integer
    from public.outbox_events
    where payload::text like '%Pickup Guest%'
      or payload::text like '%Delivery Guest%'
      or payload::text like '%Main Street%'
  ),
  0,
  'personal guest checkout values never enter outbox payloads'
);
select hasnt_column(
  'public',
  'orders',
  'delivery_address',
  'delivery addresses remain outside the operational order table'
);
select throws_ok(
  $$select private.purge_expired_guest_checkout_data('2100-01-01 00:00:00+00', 5001)$$,
  'P0001',
  'personal data purge batch size is invalid',
  'purge batch sizes are bounded'
);

select * from finish();
rollback;
