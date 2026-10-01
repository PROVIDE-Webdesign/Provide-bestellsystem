begin;
select plan(26);
\ir fixtures/storefront.fixture.inc

select ok((select is_identity='YES' and identity_generation='ALWAYS' and is_nullable='NO'
  from information_schema.columns where table_schema='public' and table_name='orders' and column_name='order_number'),
  'all orders have a server-generated non-null identity');
select ok(exists(select 1 from pg_constraint where conrelid='public.orders'::regclass and conname='orders_order_number_unique' and contype='u'),
  'database uniqueness is independent of UUID suffixes');
select is(private.format_order_number(1),'BS-00000001','short numbers are readable and padded');
select is(private.format_order_number(123456789),'BS-123456789','nine digits are never truncated');
select is(private.format_order_number(9223372036854775807),'BS-9223372036854775807','bigint maximum is not rounded or truncated');
select ok(not has_function_privilege('anon','private.attach_order_number(jsonb)','EXECUTE'),'anonymous cannot look up numbers');
select ok(not has_function_privilege('authenticated','private.attach_order_number(jsonb)','EXECUTE'),'personnel browser cannot use backend enrichment');
select ok(has_function_privilege('service_role','private.attach_order_number(jsonb)','EXECUTE'),'verified API can enrich authorized projections');
select is(private.attach_order_number(null),null::jsonb,'not-found output remains not-found');
select is(private.attach_order_number('{"outcome":"forbidden"}'),'{}'::jsonb||'{"outcome":"forbidden"}'::jsonb,'authorization failure is not enriched');

select private.attach_order_number(private.submit_public_guest_pickup_order(
  'storefront-restaurant-a','storefront-a-mitte','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
  date_trunc('hour',now())+interval '4 hours','[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
  'number-pickup-synthetic-001','{"contact_name":"Synthetic","phone_e164":"+999100000031","email":"synthetic@example.invalid"}','preview-v1',30)) as first \gset
select private.attach_order_number(private.submit_public_guest_pickup_order(
  'storefront-restaurant-a','storefront-a-mitte','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
  date_trunc('hour',now())+interval '4 hours','[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
  'number-pickup-synthetic-002','{"contact_name":"Synthetic","phone_e164":"+999100000032","email":"synthetic@example.invalid"}','preview-v1',30)) as second \gset
select ok(:'first'::jsonb->>'orderNumber' ~ '^BS-[0-9]{8,19}$','new pickup exposes stored reference immediately after INSERT');
select isnt(:'first'::jsonb->>'orderNumber',:'second'::jsonb->>'orderNumber','distinct orders receive distinct numbers');
select is(private.attach_order_number(private.submit_public_guest_pickup_order(
  'storefront-restaurant-a','storefront-a-mitte','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
  date_trunc('hour',now())+interval '4 hours','[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
  'number-pickup-synthetic-001','{"contact_name":"Synthetic","phone_e164":"+999100000031","email":"synthetic@example.invalid"}','preview-v1',30))->>'orderNumber',
  :'first'::jsonb->>'orderNumber','idempotent replay retains the original number');
select throws_ok(format('update public.orders set order_number=default where id=%L',:'first'::jsonb->>'orderId'),
  'P0001','order number is immutable','even DEFAULT cannot renumber an existing order');
select throws_ok('insert into public.orders(order_number) values (1)',
  '428C9','cannot insert a non-DEFAULT value into column "order_number"','ordinary writes cannot supply their own identity');
select is(private.attach_order_number(private.read_public_guest_order_status('storefront-restaurant-a','storefront-a-mitte',(:'first'::jsonb->>'orderId')::uuid))->>'orderNumber',
  :'first'::jsonb->>'orderNumber','guest status retains the same reference');
select is(private.attach_order_number(private.read_dashboard_order('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(:'first'::jsonb->>'orderId')::uuid))#>>'{data,orderNumber}',
  :'first'::jsonb->>'orderNumber','authorized detail retains the same reference');
select is(private.attach_order_number(jsonb_build_object('data',jsonb_build_object('orders',jsonb_build_array(:'first'::jsonb))))#>>'{data,orders,0,orderNumber}',
  :'first'::jsonb->>'orderNumber','list envelope retains the same reference');
select is(private.attach_order_number(private.read_dashboard_order('f1000000-0000-0000-0000-000000000001','aal1',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(:'first'::jsonb->>'orderId')::uuid))->>'outcome','forbidden','number enrichment cannot bypass MFA');
select is(private.attach_order_number('[{"mode":"reconcile","templateVersion":1}]'),'[{"mode":"reconcile","templateVersion":1}]'::jsonb,'reconciliation job gains no order information');
select (select order_number from public.orders where id=(:'first'::jsonb->>'orderId')::uuid) as stored_number \gset
select private.attach_order_number(private.read_dashboard_orders_by_number('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',null,null,null,25,null,:'stored_number')) as searched \gset
select is(:'searched'::jsonb#>>'{data,orders,0,orderNumber}',:'first'::jsonb->>'orderNumber','number search returns the exact scoped order');
select ok(not ((:'searched'::jsonb#>'{data,orders,0}') ? 'contactName'),'number search contains no contact projection');
select is(jsonb_array_length(private.read_dashboard_orders_by_number('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','accepted',null,null,25,null,:'stored_number')#>'{data,orders}'),0,'status filter is applied to exact number search');
select is(private.read_dashboard_orders_by_number('f1000000-0000-0000-0000-000000000001','aal1',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',null,null,null,25,null,:'stored_number')->>'outcome','forbidden','number search requires MFA for management');
select is(private.read_dashboard_orders_by_number('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000003',null,null,null,25,null,:'stored_number')->>'outcome','forbidden','foreign tenant cannot search a known reference');
select ok(not has_function_privilege('authenticated','private.read_dashboard_orders_by_number(uuid,text,uuid,uuid,text,timestamptz,uuid,integer,text,bigint)','EXECUTE'),'number search stays backend-only');
select * from finish();
rollback;
