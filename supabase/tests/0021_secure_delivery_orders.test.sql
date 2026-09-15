begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc
\ir fixtures/delivery.fixture.inc

create function pg_temp.policy(fee integer, minimum integer default 2500, postal text default '52062') returns uuid language sql as $$
  select private.create_delivery_policy('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('postalCodes',jsonb_build_array(postal),'minimumAmountMinor',minimum,'feeAmountMinor',fee)))
$$;
create function pg_temp.publish(policy uuid) returns void language sql as $$
  select private.publish_delivery_policy('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',policy)
$$;
create function pg_temp.quote(postal text default '52062', quantity integer default 2) returns jsonb language sql as $$
  select private.quote_public_delivery_order('storefront-restaurant-a','storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+interval '2 hours',
  jsonb_build_array(jsonb_build_object('menu_item_id','f6000000-0000-0000-0000-000000000001','quantity',quantity)),postal)
$$;
create function pg_temp.submit(key text,q jsonb,street text default 'Synthetic Lieferweg 10') returns jsonb language sql as $$
  select private.submit_public_guest_delivery_order('storefront-restaurant-a','storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+interval '2 hours',
  '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2}]',key,
  '{"contact_name":"Synthetic Delivery Guest","phone_e164":"+999100000021","email":null}',
  jsonb_build_object('address_line_1',street,'address_line_2',null,'postal_code','52062','city','Aachen','country_code','DE'),q,'preview-v1',30)
$$;
select ok(not has_table_privilege('service_role','public.delivery_policy_versions','insert'),'no direct service policy writes');
select ok(not has_function_privilege('authenticated','private.quote_public_delivery_order(text,text,uuid,uuid,timestamptz,jsonb,text)','execute'),'browser cannot call quote SQL');
select ok(not has_function_privilege('service_role','private.submit_priced_delivery_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz,uuid,bigint)','execute'),'priced internal writer is not a service entry point');
set local role service_role;
select throws_ok($$select pg_temp.quote()$$,'P0001','delivery area unavailable','missing policy closes delivery');
select pg_temp.policy(350) as policy \gset
select throws_ok($$select pg_temp.quote()$$,'P0001','delivery area unavailable','draft policy is not live');
select pg_temp.publish(:'policy');
select throws_ok($$select pg_temp.policy(0,0,'5206')$$,'P0001','ambiguous or invalid delivery postal code','short postal code rejected');
select throws_ok($$select private.create_delivery_policy('f1000000-0000-0000-0000-000000000003','aal1','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','[]')$$,'P0001','delivery policy access denied','kitchen cannot configure delivery');
select throws_ok($$select private.create_delivery_policy('f1000000-0000-0000-0000-000000000005','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','[]')$$,'P0001','delivery policy access denied','foreign owner denied');
select throws_ok($$select private.create_delivery_policy('f1000000-0000-0000-0000-000000000006','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','[]')$$,'P0001','delivery policy access denied','unassigned manager denied');
select throws_ok($$select private.create_delivery_policy('f1000000-0000-0000-0000-000000000001','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','[{"postalCodes":["52062","52062"],"minimumAmountMinor":0,"feeAmountMinor":0}]')$$,'P0001','ambiguous or invalid delivery postal code','overlapping postal codes rejected');
select throws_ok($$select pg_temp.quote('50667')$$,'P0001','delivery area unavailable','outside area rejected');
select throws_ok($$select pg_temp.quote('52062',1)$$,'P0001','delivery minimum not reached','fee does not count toward minimum');
select pg_temp.quote() as quote \gset
select is((:'quote'::jsonb->>'totalAmountMinor')::integer,2850,'exact minimum accepted and fee added');
select throws_ok(format('select pg_temp.submit(%L,%L::jsonb)','tampered-fee-key',jsonb_set(:'quote'::jsonb,'{deliveryFeeAmountMinor}','0')),'P0001','delivery quote changed','client cannot change fee');
reset role;
select is((select count(*)::integer from public.orders),0,'rejected write leaves no order');
set local role service_role;
select throws_ok(format('select pg_temp.submit(%L,%L::jsonb,%L)','invalid-address-key',:'quote',''),'P0001','delivery address is invalid','bad address rolls back entire transaction');
reset role;
select is((select count(*)::integer from public.ordering_capacity_claims),0,'bad address leaves no capacity claim');
select is((select count(*)::integer from public.notification_deliveries),0,'bad address leaves no notification');
set local role service_role;
select pg_temp.submit('valid-delivery-key',:'quote') as confirmation \gset
select is(pg_temp.submit('valid-delivery-key',:'quote')->>'orderId',:'confirmation'::jsonb->>'orderId','identical retry returns same order');
select throws_ok(format('select pg_temp.submit(%L,%L::jsonb,%L)','valid-delivery-key',:'quote','Different street'),'P0001','guest checkout snapshot conflicts with the existing order','different retry address rejected');
select throws_ok($$select pg_temp.quote()$$,'P0001','delivery time unavailable','full delivery slot is unavailable');
reset role;
select is((select total_amount_minor from public.orders limit 1),2850::bigint,'order total includes fee');
select is((select amount_due_minor from public.order_payments limit 1),2850::bigint,'payment amount agrees with order');
select ok(not exists(select 1 from public.orders where submission_payload::text like '%52062%' or submission_payload::text like '%Lieferweg%'),'no address in submission payload');
select ok(not exists(select 1 from public.outbox_events where payload::text like '%Lieferweg%' or payload::text like '%999100000021%'),'no address or phone in outbox');
select throws_ok($$update public.delivery_policy_versions set published=false$$,'P0001','delivery policy is immutable','published rules immutable');
set local role service_role;
select private.read_dashboard_order('f1000000-0000-0000-0000-000000000003','aal1','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(:'confirmation'::jsonb->>'orderId')::uuid) as kitchen \gset
select is(:'kitchen'::jsonb#>'{data,delivery}','null'::jsonb,'kitchen receives no delivery details');
select private.read_dashboard_order('f1000000-0000-0000-0000-000000000001','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(:'confirmation'::jsonb->>'orderId')::uuid) as owner \gset
select is(:'owner'::jsonb#>>'{data,delivery,addressLine1}','Synthetic Lieferweg 10','authorized owner receives delivery address');
select private.read_public_guest_order_status('storefront-restaurant-a','storefront-a-mitte',(:'confirmation'::jsonb->>'orderId')::uuid) as public_status \gset
select is(:'public_status'::jsonb->>'fulfillmentType','delivery','public status supports delivery');
select ok(position('Lieferweg' in :'public_status')=0,'public status excludes address');
select pg_temp.policy(450) as next_policy \gset
select pg_temp.publish(:'next_policy');
select is(pg_temp.submit('valid-delivery-key',:'quote')->>'orderId',:'confirmation'::jsonb->>'orderId','lost response recovers after policy change');
select private.transition_order_status('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(:'confirmation'::jsonb->>'orderId')::uuid,'cancelled','f1000000-0000-0000-0000-000000000001','aal2');
select throws_ok(format('select pg_temp.submit(%L,%L::jsonb)','stale-policy-key',:'quote'),'P0001','delivery quote changed','new submission must reconfirm updated rules');
select is((pg_temp.quote()->>'deliveryFeeAmountMinor')::integer,450,'new quote uses new fee after capacity release');
reset role;
select is((select delivery_fee_amount_minor from public.orders limit 1),350::bigint,'historic fee unchanged');
select * from finish();
rollback;
