begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select no_plan();
\ir fixtures/storefront.fixture.inc

select has_function(
  'private',
  'read_dashboard_orders',
  array['uuid','text','uuid','uuid','text','timestamptz','uuid','integer'],
  'dashboard order list function exists'
);
select has_function(
  'private',
  'read_dashboard_order',
  array['uuid','text','uuid','uuid','uuid'],
  'dashboard order detail function exists'
);
select has_function(
  'private',
  'transition_dashboard_order_status',
  array['uuid','text','uuid','uuid','uuid','text','text'],
  'dashboard order status command exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.read_dashboard_orders(uuid,text,uuid,uuid,text,timestamptz,uuid,integer)',
    'execute'
  ),
  'service role may read the bounded order queue'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.transition_dashboard_order_status(uuid,text,uuid,uuid,uuid,text,text)',
    'execute'
  ),
  'authenticated browsers cannot issue SQL status commands directly'
);

set local role service_role;
select private.submit_public_guest_pickup_order(
  'storefront-restaurant-a',
  'storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001',
  'f5000000-0000-0000-0000-000000000001',
  date_trunc('hour', now()) + interval '2 hours',
  '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2}]',
  'dashboard-order-key-0001',
  '{"contact_name":"Synthetic Dashboard Guest","phone_e164":"+999100000001","email":"guest@example.invalid"}',
  'preview-v1',
  30
) as first_confirmation \gset
select private.submit_public_guest_pickup_order(
  'storefront-restaurant-a',
  'storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001',
  'f5000000-0000-0000-0000-000000000001',
  date_trunc('hour', now()) + interval '3 hours',
  '[{"menu_item_id":"f6000000-0000-0000-0000-000000000002","quantity":1}]',
  'dashboard-order-key-0002',
  '{"contact_name":"Second Synthetic Guest","phone_e164":"+999100000002","email":null}',
  'preview-v1',
  30
) as second_confirmation \gset

select is(
  private.read_dashboard_orders(
    'f1000000-0000-0000-0000-000000000001','aal2',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
    null,null,null,25
  ) ->> 'outcome',
  'allowed',
  'owner with aal2 may read the location queue'
);
select is(
  jsonb_array_length(
    private.read_dashboard_orders(
      'f1000000-0000-0000-0000-000000000002','aal2',
      'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
      'submitted',null,null,25
    ) #> '{data,orders}'
  ),
  2,
  'assigned manager sees the two submitted synthetic orders'
);
select is(
  private.read_dashboard_orders(
    'f1000000-0000-0000-0000-000000000002','aal1',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
    null,null,null,25
  ) ->> 'outcome',
  'forbidden',
  'manager without aal2 is denied'
);
select is(
  private.read_dashboard_orders(
    'f1000000-0000-0000-0000-000000000004','aal2',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
    null,null,null,25
  ) ->> 'outcome',
  'forbidden',
  'driver is denied operational order access'
);
select is(
  private.read_dashboard_orders(
    'f1000000-0000-0000-0000-000000000005','aal2',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
    null,null,null,25
  ) ->> 'outcome',
  'forbidden',
  'another tenant owner cannot cross the restaurant boundary'
);
select is(
  private.read_dashboard_order(
    'f1000000-0000-0000-0000-000000000003','aal1',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
    (:'first_confirmation'::jsonb ->> 'orderId')::uuid
  ) #> '{data,contactName}',
  'null'::jsonb,
  'kitchen receives no customer contact data'
);
select is(
  private.read_dashboard_order(
    'f1000000-0000-0000-0000-000000000002','aal2',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
    (:'first_confirmation'::jsonb ->> 'orderId')::uuid
  ) #>> '{data,contactName}',
  'Synthetic Dashboard Guest',
  'management receives only the operational pickup name'
);
select ok(
  position(
    '+999100000001' in private.read_dashboard_order(
      'f1000000-0000-0000-0000-000000000002','aal2',
      'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
      (:'first_confirmation'::jsonb ->> 'orderId')::uuid
    )::text
  ) = 0,
  'detail projection never exposes phone or email values'
);
select is(
  jsonb_array_length(
    private.read_dashboard_order(
      'f1000000-0000-0000-0000-000000000003','aal1',
      'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
      (:'first_confirmation'::jsonb ->> 'orderId')::uuid
    ) #> '{data,lines}'
  ),
  1,
  'kitchen receives immutable item snapshots'
);

select private.read_dashboard_orders(
  'f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  null,null,null,1
) as first_page \gset
select ok(
  :'first_page'::jsonb #>> '{data,nextCursor}' is not null,
  'bounded first page returns a cursor when another order exists'
);
select is(
  jsonb_array_length(
    private.read_dashboard_orders(
      'f1000000-0000-0000-0000-000000000001','aal2',
      'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
      null,
      split_part(:'first_page'::jsonb #>> '{data,nextCursor}','|',1)::timestamptz,
      split_part(:'first_page'::jsonb #>> '{data,nextCursor}','|',2)::uuid,
      1
    ) #> '{data,orders}'
  ),
  1,
  'cursor reads the next page without repeating the first order'
);

select is(
  private.transition_dashboard_order_status(
    'f1000000-0000-0000-0000-000000000003','aal1',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
    (:'first_confirmation'::jsonb ->> 'orderId')::uuid,'submitted','rejected'
  ) ->> 'outcome',
  'forbidden',
  'kitchen cannot reject an order'
);
select is(
  private.transition_dashboard_order_status(
    'f1000000-0000-0000-0000-000000000003','aal1',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
    (:'first_confirmation'::jsonb ->> 'orderId')::uuid,'submitted','accepted'
  ) #>> '{data,status}',
  'accepted',
  'kitchen may accept a submitted order'
);
select is(
  private.transition_dashboard_order_status(
    'f1000000-0000-0000-0000-000000000003','aal1',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
    (:'first_confirmation'::jsonb ->> 'orderId')::uuid,'submitted','accepted'
  ) ->> 'outcome',
  'conflict',
  'stale duplicate action is rejected without a second event'
);
select is(
  private.transition_dashboard_order_status(
    'f1000000-0000-0000-0000-000000000003','aal1',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
    (:'first_confirmation'::jsonb ->> 'orderId')::uuid,'accepted','preparing'
  ) #>> '{data,status}',
  'preparing',
  'kitchen may start preparation'
);
select is(
  private.transition_dashboard_order_status(
    'f1000000-0000-0000-0000-000000000002','aal2',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
    (:'first_confirmation'::jsonb ->> 'orderId')::uuid,'preparing','cancelled'
  ) #>> '{data,status}',
  'cancelled',
  'manager may cancel an in-progress order'
);
reset role;

select is(
  (
    select count(*)::integer
    from public.order_status_events
    where order_id = (:'first_confirmation'::jsonb ->> 'orderId')::uuid
      and actor_kind = 'personnel'
  ),
  3,
  'three successful actions append exactly three personnel status events'
);
select is(
  (
    select count(*)::integer
    from public.outbox_events
    where aggregate_id = (:'first_confirmation'::jsonb ->> 'orderId')::uuid
      and event_type = 'order.status_changed'
  ),
  3,
  'successful dashboard actions append matching outbox events'
);
select ok(
  not exists (
    select 1
    from public.outbox_events
    where payload::text like '%Synthetic Dashboard Guest%'
       or payload::text like '%999100000001%'
  ),
  'status events do not leak personal data into the outbox'
);

select * from finish();
rollback;
