begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc
insert into private.restaurant_test_payment_accounts(restaurant_id,platform_account_id,merchant_account_id,enabled,expires_at,reason) values('f2000000-0000-0000-0000-000000000001','acct_testplatform','acct_synthetic',true,clock_timestamp()+interval '1 day','Synthetic payment routing fixture');
\ir fixtures/delivery.fixture.inc
create function pg_temp.submit(key text,hours integer default 6) returns jsonb language sql as $$
 select private.submit_public_guest_online_order('storefront-restaurant-a','storefront-a-mitte',
 'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+make_interval(hours=>hours),
 '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2}]',key,
 '{"contact_name":"Synthetic Online Guest","phone_e164":"+999100000041","email":"synthetic@example.invalid"}',
 'pickup',null,null,'preview-v1',30,'acct_testplatform')
$$;
insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled) values('f2000000-0000-0000-0000-000000000001','payment.online',true);
set local role service_role;
select pg_temp.submit('online-valid-order') as confirmation \gset
select private.claim_online_payment_job('acct_synthetic',(:'confirmation'::jsonb->>'orderId')::uuid,'fc100000-0000-0000-0000-000000000001') as job \gset
select private.bind_online_payment_session((:'job'::jsonb->>'id')::uuid,'fc100000-0000-0000-0000-000000000001','cs_test_one');
select private.sync_online_payment((:'job'::jsonb->>'id')::uuid,'fc100000-0000-0000-0000-000000000001','paid','pi_one',null,repeat('a',64));
reset role;
select private.transition_order_status('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'confirmation'::jsonb->>'orderId')::uuid,'accepted','f1000000-0000-0000-0000-000000000001','aal2');
select private.transition_order_status('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'confirmation'::jsonb->>'orderId')::uuid,'preparing','f1000000-0000-0000-0000-000000000001','aal2');
select private.transition_order_status('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'confirmation'::jsonb->>'orderId')::uuid,'ready','f1000000-0000-0000-0000-000000000001','aal2');
select private.transition_order_status('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'confirmation'::jsonb->>'orderId')::uuid,'completed','f1000000-0000-0000-0000-000000000001','aal2');
insert into private.support_grants(user_id,can_read,can_manage) values('f1000000-0000-0000-0000-000000000001',true,true);
update private.email_deliveries set status='uncertain' where order_id=(:'confirmation'::jsonb->>'orderId')::uuid and template_key='order_submitted';
select private.reconcile_support_sources('f2000000-0000-0000-0000-000000000001');
select id as case_id from private.support_cases where order_id=(:'confirmation'::jsonb->>'orderId')::uuid and kind='email_uncertain' \gset
create function pg_temp.partial(target_case uuid,rid uuid,amount integer,assurance text default 'aal2') returns jsonb language sql as $$
  select private.request_support_partial_refund('f1000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001',assurance,
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',target_case,rid,amount,'missing_item','acct_testplatform')
$$;
select ok(not has_table_privilege('service_role','private.support_partial_refunds','update'),'worker cannot bypass audit path');
select ok(not has_function_privilege('authenticated','private.claim_support_partial_refund(text,uuid)','execute'),'browser cannot claim a refund');
set local role service_role;
select is(pg_temp.partial(:'case_id','e5200000-0000-0000-0000-000000000001',450,'aal1')->>'outcome','forbidden','MFA required');
select is(pg_temp.partial(:'case_id','e5200000-0000-0000-0000-000000000001',2500)->>'outcome','conflict','whole captured amount is not a partial request');
select is(pg_temp.partial(:'case_id','e5200000-0000-0000-0000-000000000001',450)#>>'{data,state}','queued','authorized partial refund is durably queued');
select is(pg_temp.partial(:'case_id','e5200000-0000-0000-0000-000000000001',450)#>>'{data,state}','queued','lost response returns the same queue item');
select is(pg_temp.partial(:'case_id','e5200000-0000-0000-0000-000000000001',451)->>'outcome','conflict','same request cannot change amount');
select is(pg_temp.partial(:'case_id','e5200000-0000-0000-0000-000000000002',450)->>'outcome','conflict','another request cannot race an active refund');
select is(private.claim_support_partial_refund('acct_other','e5210000-0000-0000-0000-000000000001'),null::jsonb,'account isolation');
select is(private.claim_support_partial_refund('acct_testplatform','e5210000-0000-0000-0000-000000000001')->>'amount','450','worker claims the approved amount');
select is(private.claim_support_partial_refund('acct_testplatform','e5210000-0000-0000-0000-000000000002'),null::jsonb,'second worker cannot claim an active lease');
select is(private.finish_support_partial_refund('e5200000-0000-0000-0000-000000000001','e5210000-0000-0000-0000-000000000002','succeeded','re_first',repeat('a',64)),'conflict','foreign lease cannot report success');
select is(private.finish_support_partial_refund('e5200000-0000-0000-0000-000000000001','e5210000-0000-0000-0000-000000000001','succeeded','re_first',repeat('a',64)),'succeeded','verified provider refund is recorded');
select is(pg_temp.partial(:'case_id','e5200000-0000-0000-0000-000000000001',450)#>>'{data,state}','succeeded','replay returns the verified result');
reset role;
select is((select status from public.order_payments where order_id=(:'confirmation'::jsonb->>'orderId')::uuid),'partially_refunded','ledger reflects partial refund');
select is((select refunded_amount_minor from public.order_payments where order_id=(:'confirmation'::jsonb->>'orderId')::uuid),450::bigint,'ledger retains verified cumulative amount');
select is((select total_amount_minor from public.orders where id=(:'confirmation'::jsonb->>'orderId')::uuid),2500::bigint,'original order total remains intact');
select is(pg_temp.partial(:'case_id','e5200000-0000-0000-0000-000000000002',2100)->>'outcome','conflict','later request cannot exceed remaining balance');
select is(pg_temp.partial(:'case_id','e5200000-0000-0000-0000-000000000002',450)#>>'{data,state}','queued','new explicit request can use the remaining balance');
update private.support_partial_refunds set first_attempt_at=statement_timestamp()-interval '21 hours' where id='e5200000-0000-0000-0000-000000000002';
select is(private.claim_support_partial_refund('acct_testplatform','e5210000-0000-0000-0000-000000000003')->>'review','true','uncertain old request must be reviewed instead of sent again');
select is(pg_temp.partial(:'case_id','e5200000-0000-0000-0000-000000000002',450)#>>'{data,state}','review','review state survives reload');
select * from finish();
rollback;
