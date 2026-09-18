begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc
\ir fixtures/delivery.fixture.inc
create function pg_temp.submit(key text,hours integer default 6) returns jsonb language sql as $$
 select private.submit_public_guest_online_order('storefront-restaurant-a','storefront-a-mitte',
 'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+make_interval(hours=>hours),
 '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2}]',key,
 '{"contact_name":"Synthetic Online Guest","phone_e164":"+999100000041","email":null}',
 'pickup',null,null,'preview-v1',30,'acct_synthetic')
$$;
select ok(not has_table_privilege('service_role','public.online_payment_jobs','update'),'service cannot directly modify orchestration');
select ok(not has_table_privilege('authenticated','public.online_payment_jobs','select'),'browser cannot read provider references');
select ok(not has_function_privilege('service_role','private.close_online_order(uuid,text)','execute'),'system closure not a service entry point');
set local role service_role;
select throws_ok($$select pg_temp.submit('online-disabled')$$,'P0001','online checkout unavailable','online feature defaults closed');
reset role;
insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled) values('f2000000-0000-0000-0000-000000000001','payment.online',true);
set local role service_role;
select pg_temp.submit('online-valid-order') as confirmation \gset
select is(pg_temp.submit('online-valid-order')->>'orderId',:'confirmation'::jsonb->>'orderId','lost order response returns same order');
select is(:'confirmation'::jsonb->>'paymentCollectionMode','online','online mode is explicit');
select ok(private.allow_online_payment_resume('acct_synthetic',(:'confirmation'::jsonb->>'orderId')::uuid),'first resume is allowed');
select ok(not private.allow_online_payment_resume('acct_synthetic',(:'confirmation'::jsonb->>'orderId')::uuid),'immediate duplicate resume cannot force provider calls');
select private.claim_online_payment_job('acct_synthetic',(:'confirmation'::jsonb->>'orderId')::uuid,'fc100000-0000-0000-0000-000000000001') as job \gset
select ok(:'job'::jsonb->>'session_id' is null,'durable job exists before provider session');
select is(private.claim_online_payment_job('acct_synthetic',(:'confirmation'::jsonb->>'orderId')::uuid,'fc100000-0000-0000-0000-000000000002'),null::jsonb,'lease excludes simultaneous workers');
select is(private.claim_online_payment_job('acct_foreign',null,'fc100000-0000-0000-0000-000000000002'),null::jsonb,'provider account isolation');
select is(private.transition_dashboard_order_status('f1000000-0000-0000-0000-000000000001','aal2',
 'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(:'confirmation'::jsonb->>'orderId')::uuid,'submitted','accepted')->>'outcome','conflict','unpaid online order cannot be accepted');
select is(jsonb_array_length(private.claim_notification_deliveries('fc100000-0000-0000-0000-000000000003',25,statement_timestamp())),0,'unpaid order sends no submitted notification');
select throws_ok(format('select private.bind_online_payment_session(%L,%L,%L)',:'job'::jsonb->>'id','fc100000-0000-0000-0000-000000000002','cs_test_one'),
 'P0001','payment lease invalid','wrong lease cannot bind a provider session');
select private.bind_online_payment_session((:'job'::jsonb->>'id')::uuid,'fc100000-0000-0000-0000-000000000001','cs_test_one');
select private.sync_online_payment((:'job'::jsonb->>'id')::uuid,'fc100000-0000-0000-0000-000000000001','paid','pi_one',null,repeat('a',64));
select is(private.read_public_guest_order_status('storefront-restaurant-a','storefront-a-mitte',(:'confirmation'::jsonb->>'orderId')::uuid)->>'paymentState','paid','public view reports verified payment');
select is(private.transition_dashboard_order_status('f1000000-0000-0000-0000-000000000001','aal2',
 'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(:'confirmation'::jsonb->>'orderId')::uuid,'submitted','rejected')->>'outcome','updated','paid order can be rejected');
select private.claim_online_payment_job('acct_synthetic',(:'confirmation'::jsonb->>'orderId')::uuid,'fc100000-0000-0000-0000-000000000004') as refund_job \gset
select is(:'refund_job'::jsonb->>'refund_state','requested','rejection durably requests full refund');
select private.sync_online_payment((:'job'::jsonb->>'id')::uuid,'fc100000-0000-0000-0000-000000000004','refund_failed','pi_one','re_one',repeat('b',64));
select is(private.retry_online_refund('f1000000-0000-0000-0000-000000000003','aal1','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(:'confirmation'::jsonb->>'orderId')::uuid)->>'outcome','forbidden','kitchen cannot retry refunds');
select is(private.retry_online_refund('f1000000-0000-0000-0000-000000000001','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(:'confirmation'::jsonb->>'orderId')::uuid)->>'outcome','allowed','owner can explicitly retry failed refund');
select private.claim_online_payment_job('acct_synthetic',(:'confirmation'::jsonb->>'orderId')::uuid,'fc100000-0000-0000-0000-000000000005') as retry_job \gset
select is((:'retry_job'::jsonb->>'refund_sequence')::integer,1,'new refund command has a new stable generation');
select private.sync_online_payment((:'job'::jsonb->>'id')::uuid,'fc100000-0000-0000-0000-000000000005','refunded','pi_one','re_two',repeat('c',64));
select is(private.read_public_guest_order_status('storefront-restaurant-a','storefront-a-mitte',(:'confirmation'::jsonb->>'orderId')::uuid)->>'paymentState','refunded','successful full refund is displayed');
select private.receive_online_payment_event('acct_synthetic','evt_one','refund.updated','re_two',repeat('d',64));
select lives_ok($$select private.receive_online_payment_event('acct_synthetic','evt_one','refund.updated','re_two',repeat('d',64))$$,'duplicate webhook is harmless');
select throws_ok($$select private.receive_online_payment_event('acct_synthetic','evt_one','refund.updated','re_two',repeat('e',64))$$,'P0001','conflicting payment event','changed duplicate rejected');
select pg_temp.submit('online-expire-order',7) as exp_confirmation \gset
select private.transition_dashboard_order_status('f1000000-0000-0000-0000-000000000001','aal2',
 'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(:'exp_confirmation'::jsonb->>'orderId')::uuid,'submitted','cancelled') as requested \gset
select is(:'requested'::jsonb#>>'{data,status}','submitted','cancellation waits for provider confirmation');
select private.claim_online_payment_job('acct_synthetic',(:'exp_confirmation'::jsonb->>'orderId')::uuid,'fc100000-0000-0000-0000-000000000006') as exp_job \gset
reset role;
update public.restaurant_feature_flags set enabled=false where restaurant_id='f2000000-0000-0000-0000-000000000001' and feature_key='payment.online';
set local role service_role;
select throws_ok($$select pg_temp.submit('online-disabled-again',8)$$,'P0001','online checkout unavailable','disabled feature rejects new orders');
select private.bind_online_payment_session((:'exp_job'::jsonb->>'id')::uuid,'fc100000-0000-0000-0000-000000000006','cs_test_two');
select private.sync_online_payment((:'exp_job'::jsonb->>'id')::uuid,'fc100000-0000-0000-0000-000000000006','expired',null,null,repeat('e',64));
select is(private.read_public_guest_order_status('storefront-restaurant-a','storefront-a-mitte',(:'exp_confirmation'::jsonb->>'orderId')::uuid)->>'status','cancelled','verified expiry closes the order');
reset role;
select is((select count(*)::integer from public.online_refund_retries),1,'explicit retry has immutable actor audit');
select is((select refunded_amount_minor from public.order_payments where order_id=(:'confirmation'::jsonb->>'orderId')::uuid),2500::bigint,'refund equals full order total');
select ok(not exists(select 1 from public.outbox_events where payload::text like '%cs_test_%' or payload::text like '%999100000041%'),'outbox excludes provider references and contact data');
select ok((select deadline<=created_at+interval '10 minutes' from public.online_payment_jobs where order_id=(:'confirmation'::jsonb->>'orderId')::uuid),'payment deadline bounded to ten minutes');
select * from finish();
rollback;
