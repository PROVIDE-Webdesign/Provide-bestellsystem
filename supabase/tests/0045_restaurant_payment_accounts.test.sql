begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc
\ir fixtures/delivery.fixture.inc
insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled)
values('f2000000-0000-0000-0000-000000000001','payment.online',true);
create function pg_temp.submit(key text,hours integer default 6,platform text default 'acct_platform') returns jsonb language sql as $$
 select private.submit_public_guest_online_order('storefront-restaurant-a','storefront-a-mitte',
 'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+make_interval(hours=>hours),
 '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',key,
 '{"contact_name":"TEST Connect Guest","email":"connect@example.invalid"}',
 'pickup',null,null,'preview-v1',14,platform)
$$;
select ok(not has_table_privilege('service_role','private.restaurant_test_payment_accounts','update'),'runtime cannot remap payees');
select ok(not has_table_privilege('authenticated','private.restaurant_test_payment_accounts','select'),'browser cannot read account mapping');
select ok(not has_function_privilege('service_role','private.submit_guest_online_order_for_merchant(text,text,uuid,uuid,timestamptz,jsonb,text,jsonb,text,jsonb,jsonb,text,integer,text,text)','execute'),'runtime cannot bypass restaurant routing');
set local role service_role;
select throws_ok($$select pg_temp.submit('connect-missing-map')$$,'P0001','online checkout unavailable','missing mapping closes new online orders');
reset role;
insert into private.restaurant_test_payment_accounts(restaurant_id,platform_account_id,merchant_account_id,enabled,expires_at,reason)
values('f2000000-0000-0000-0000-000000000001','acct_platform','acct_merchantA',true,clock_timestamp()+interval '1 day','TEST connected restaurant A'),
('f2000000-0000-0000-0000-000000000002','acct_platform','acct_merchantB',true,clock_timestamp()+interval '1 day','TEST connected restaurant B');
select throws_ok($$update private.restaurant_test_payment_accounts set merchant_account_id='acct_merchantA' where merchant_account_id='acct_merchantB'$$,'23505',null,'two restaurants cannot share the same merchant account');
set local role service_role;
select throws_ok($$select pg_temp.submit('connect-wrong-platform',6,'acct_foreign')$$,'P0001','online checkout unavailable','foreign platform cannot submit');
select pg_temp.submit('connect-unpaid-then-late') as first_order \gset
select private.read_platform_online_payment_job('acct_platform',(:'first_order'::jsonb->>'orderId')::uuid) as first_job \gset
select is(:'first_job'::jsonb->>'account_id','acct_merchantA','order snapshots restaurant A merchant');
select is(:'first_job'::jsonb->>'platform_account_id','acct_platform','order snapshots platform');
select is(private.read_platform_online_payment_job('acct_foreign',(:'first_order'::jsonb->>'orderId')::uuid),null::jsonb,'foreign platform cannot read job');
select is(private.read_online_payment_job('acct_merchantB',(:'first_order'::jsonb->>'orderId')::uuid),null::jsonb,'restaurant B account cannot read A job');
select ok(not private.allow_platform_online_payment_resume('acct_foreign',(:'first_order'::jsonb->>'orderId')::uuid),'foreign platform cannot force resume');
select is(private.claim_platform_online_payment_job('acct_foreign',null,'fc450000-0000-0000-0000-000000000001'),null::jsonb,'foreign platform cannot claim jobs');
reset role;
update private.restaurant_test_payment_accounts set merchant_account_id='acct_replacementA',enabled=false
where restaurant_id='f2000000-0000-0000-0000-000000000001';
select throws_ok($$update private.restaurant_test_payment_accounts set merchant_account_id='acct_merchantA' where merchant_account_id='acct_merchantB'$$,'P0001','merchant account already belongs to another restaurant','historical merchant cannot move to another restaurant');
select throws_ok(format('update public.online_payment_jobs set account_id=%L where order_id=%L','acct_merchantB',:'first_order'::jsonb->>'orderId'),'P0001','online payment identity is immutable','existing payment payee cannot change');
select throws_ok(format('update public.online_payment_jobs set platform_account_id=%L where order_id=%L','acct_foreign',:'first_order'::jsonb->>'orderId'),'P0001','online payment identity is immutable','existing payment platform cannot change');
set local role service_role;
select is(pg_temp.submit('connect-unpaid-then-late')->>'orderId',:'first_order'::jsonb->>'orderId','lost response retries original order after mapping change');
select throws_ok($$select pg_temp.submit('connect-disabled-map')$$,'P0001','online checkout unavailable','disabled mapping rejects new orders');
select private.claim_platform_online_payment_job('acct_platform',(:'first_order'::jsonb->>'orderId')::uuid,'fc450000-0000-0000-0000-000000000002') as claimed \gset
select is(:'claimed'::jsonb->>'account_id','acct_merchantA','worker retains historical payee after remap');
select private.bind_online_payment_session((:'first_job'::jsonb->>'id')::uuid,'fc450000-0000-0000-0000-000000000002','cs_test_connectA');
select is(private.receive_platform_online_payment_event('acct_platform','acct_merchantB','evt_wrongmerchant','checkout.session.completed','cs_test_connectA',repeat('b',64),statement_timestamp(),false),null::uuid,'B event cannot wake A order');
select statement_timestamp()-interval '2 minutes' as unpaid_time \gset
select private.receive_platform_online_payment_event('acct_platform','acct_merchantA','evt_completedunpaid','checkout.session.completed','cs_test_connectA',repeat('c',64),:'unpaid_time'::timestamptz,false);
select lives_ok(format('select private.receive_platform_online_payment_event(%L,%L,%L,%L,%L,%L,%L,false)',
 'acct_platform','acct_merchantA','evt_completedunpaid','checkout.session.completed','cs_test_connectA',repeat('c',64),:'unpaid_time'),'same-account duplicate event is idempotent');
select throws_ok(format('select private.receive_platform_online_payment_event(%L,%L,%L,%L,%L,%L,%L,true)',
 'acct_platform','acct_merchantA','evt_completedunpaid','checkout.session.completed','cs_test_connectA',repeat('c',64),:'unpaid_time'),'P0001','conflicting payment event','duplicate cannot promote unpaid event to paid');
reset role;
select throws_ok($$select private.receive_platform_online_payment_event('acct_foreign','acct_merchantA','evt_foreign','payment_intent.succeeded','pi_unknown',repeat('d',64),statement_timestamp(),true)$$,'P0001','online account mismatch','foreign platform event rejected');
update public.online_payment_jobs set deadline=statement_timestamp()-interval '1 second' where order_id=(:'first_order'::jsonb->>'orderId')::uuid;
set local role service_role;
select private.sync_online_payment((:'first_job'::jsonb->>'id')::uuid,'fc450000-0000-0000-0000-000000000002','paid','pi_connectA',null,repeat('d',64));
select is(private.read_platform_online_payment_job('acct_platform',(:'first_order'::jsonb->>'orderId')::uuid)->>'last_error','manual_review','unpaid completed event cannot prove timely payment');
select private.receive_platform_online_payment_event('acct_platform','acct_merchantA','evt_asyncpaidlate','checkout.session.async_payment_succeeded','cs_test_connectA',repeat('e',64),statement_timestamp(),true);
select private.claim_platform_online_payment_job('acct_platform',(:'first_order'::jsonb->>'orderId')::uuid,'fc450000-0000-0000-0000-000000000003');
select private.sync_online_payment((:'first_job'::jsonb->>'id')::uuid,'fc450000-0000-0000-0000-000000000003','paid','pi_connectA',null,repeat('f',64));
select is(private.read_platform_online_payment_job('acct_platform',(:'first_order'::jsonb->>'orderId')::uuid)->>'order_status','cancelled','late asynchronous success cannot revive order');
select is(private.read_platform_online_payment_job('acct_platform',(:'first_order'::jsonb->>'orderId')::uuid)->>'refund_state','requested','late success requests compensation on historical merchant');
reset role;
update private.restaurant_test_payment_accounts set enabled=true where restaurant_id='f2000000-0000-0000-0000-000000000001';
set local role service_role;
select pg_temp.submit('connect-timely-async',7) as timely_order \gset
select private.claim_platform_online_payment_job('acct_platform',(:'timely_order'::jsonb->>'orderId')::uuid,'fc450000-0000-0000-0000-000000000004') as timely_job \gset
select is(:'timely_job'::jsonb->>'account_id','acct_replacementA','new order uses newly configured merchant');
select private.bind_online_payment_session((:'timely_job'::jsonb->>'id')::uuid,'fc450000-0000-0000-0000-000000000004','cs_test_connectTimely');
select private.receive_platform_online_payment_event('acct_platform','acct_replacementA','evt_asynctimely','checkout.session.async_payment_succeeded','cs_test_connectTimely',repeat('1',64),statement_timestamp()-interval '2 minutes',true);
reset role;
update public.online_payment_jobs set deadline=statement_timestamp()-interval '1 second' where order_id=(:'timely_order'::jsonb->>'orderId')::uuid;
set local role service_role;
select private.sync_online_payment((:'timely_job'::jsonb->>'id')::uuid,'fc450000-0000-0000-0000-000000000004','paid','pi_connectTimely',null,repeat('2',64));
select is(private.read_platform_online_payment_job('acct_platform',(:'timely_order'::jsonb->>'orderId')::uuid)->>'payment_status','captured','timely asynchronous success survives delayed processing');
select is(private.read_platform_online_payment_job('acct_platform',(:'timely_order'::jsonb->>'orderId')::uuid)->>'order_status','submitted','timely paid order remains fulfillable');
reset role;
update private.restaurant_test_payment_accounts set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day'
where restaurant_id='f2000000-0000-0000-0000-000000000001';
set local role service_role;
select throws_ok($$select pg_temp.submit('connect-expired-map',8)$$,'P0001','online checkout unavailable','expired test mapping rejects new orders');
select is(pg_temp.submit('connect-timely-async',7)->>'orderId',:'timely_order'::jsonb->>'orderId','expired mapping does not strand order receipt');
reset role;
select ok(exists(select 1 from private.provide_admin_audit where action='restaurant_test_payment_accounts.insert'),'mapping configuration is audited');
select * from finish();
rollback;
