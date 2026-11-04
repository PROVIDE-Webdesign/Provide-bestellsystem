begin;
set local search_path=extensions,public;
select plan(31);
\ir fixtures/storefront.fixture.inc
\ir fixtures/delivery.fixture.inc

\set owner_a f1000000-0000-0000-0000-000000000001
\set kitchen_a f1000000-0000-0000-0000-000000000003
\set manager_unassigned f1000000-0000-0000-0000-000000000006
\set owner_b f1000000-0000-0000-0000-000000000005
\set session_a aa000000-0000-0000-0000-000000000001
\set session_b aa000000-0000-0000-0000-000000000002
\set session_manager aa000000-0000-0000-0000-000000000003
\set session_kitchen aa000000-0000-0000-0000-000000000004
\set restaurant_a f2000000-0000-0000-0000-000000000001
\set restaurant_b f2000000-0000-0000-0000-000000000002
\set location_a f3000000-0000-0000-0000-000000000001
\set location_b f3000000-0000-0000-0000-000000000002
\set endpoint_a https://fcm.googleapis.com/fcm/send/order-push-a
\set endpoint_b https://fcm.googleapis.com/fcm/send/order-push-b

insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
select id,id,'synthetic','totp','verified','SYNTHETICTEST',now(),now()
from auth.users where id in (:'owner_a',:'owner_b',:'manager_unassigned') on conflict(id) do nothing;
insert into auth.sessions(id,user_id,created_at,updated_at,aal,factor_id) values
 (:'session_a',:'owner_a',clock_timestamp(),clock_timestamp(),'aal2',:'owner_a'),
 (:'session_b',:'owner_b',clock_timestamp(),clock_timestamp(),'aal2',:'owner_b'),
 (:'session_manager',:'manager_unassigned',clock_timestamp(),clock_timestamp(),'aal2',:'manager_unassigned'),
 (:'session_kitchen',:'kitchen_a',clock_timestamp(),clock_timestamp(),'aal1',null);
select 'B'||repeat('a',86) as p256dh,repeat('b',22) as auth_key \gset

select ok(not has_table_privilege('authenticated','private.order_push_subscriptions','select'),'browser cannot read subscription secrets');
select ok(not has_table_privilege('service_role','private.order_push_subscriptions','select'),'runtime has function-only access');
select ok(not has_function_privilege('authenticated','private.claim_order_push(integer)','execute'),'browser cannot lease push deliveries');
set local role service_role;
select is(private.manage_order_push(:'owner_a',:'session_a','aal1','status',:'restaurant_a',:'location_a','',null,null)->>'outcome','forbidden','mismatched assurance cannot register');
select is(private.manage_order_push(:'owner_a',:'session_a','aal2','status',:'restaurant_b',:'location_b','',null,null)->>'outcome','forbidden','other tenant cannot register');
select is(private.manage_order_push(:'manager_unassigned',:'session_manager','aal2','status',:'restaurant_a',:'location_a','',null,null)->>'outcome','forbidden','manager needs site assignment');
select is(private.manage_order_push(:'owner_a',:'session_a','aal2','subscribe',:'restaurant_a',:'location_a',:'endpoint_a',:'p256dh',:'auth_key')->>'active','true','register authorized device');
select is(private.manage_order_push(:'owner_b',:'session_b','aal2','subscribe',:'restaurant_b',:'location_b',:'endpoint_b',:'p256dh',:'auth_key')->>'active','true','register separate tenant device');
select is(private.manage_order_push(:'owner_a',:'session_a','aal2','status',:'restaurant_a',:'location_a',:'endpoint_a',null,null)->>'active','true','status confirms persisted device');
reset role;

insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled)
values(:'restaurant_a','payment.online',true);
insert into private.restaurant_test_payment_accounts(restaurant_id,platform_account_id,merchant_account_id,enabled,expires_at,reason)
values(:'restaurant_a','acct_platform','acct_merchantA',true,clock_timestamp()+interval '1 day','TEST background alarm');
create function pg_temp.submit_manual(key text,hours integer default 6) returns uuid language sql as $$
 select (private.submit_public_guest_online_order('storefront-restaurant-a','storefront-a-mitte',
 'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+make_interval(hours=>hours),
 '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',key,
 '{"contact_name":"Synthetic","email":"push@example.invalid"}',
 'pickup',null,null,'preview-v1',14,'acct_platform')->>'orderId')::uuid
$$;
select set_config('provide.manual_capture','on',true);
select pg_temp.submit_manual('manual-push-accept') as order_id \gset
select is(private.order_acceptance_eligible(:'order_id'),false,'payment awaiting guest is not actionable');
select 'aa000000-0000-0000-0000-000000000005' as lease \gset
select private.claim_platform_online_payment_job('acct_platform',:'order_id',:'lease')->>'id' as job \gset
select private.bind_online_payment_session(:'job',:'lease','cs_test_manualPushA');
select private.sync_online_payment(:'job',:'lease','authorized','pi_manualPushA',null,repeat('a',64));
select is((select status from public.order_payments where order_id=:'order_id'),'authorized','Stripe reservation is recorded without capture');
select is(private.order_acceptance_eligible(:'order_id'),true,'authorization is actionable before capture');
select is((select a.deadline from private.order_acceptance_alerts a where a.order_id=:'order_id'),
  (select j.acceptance_deadline from public.online_payment_jobs j where j.order_id=:'order_id'),'inbox uses the actual payment deadline');
select is(private.read_dashboard_acceptance(:'owner_a','aal2',:'restaurant_a',:'location_a')#>>'{data,totalPending}','1','authorized order appears in inbox');
select private.claim_order_push(4) as claimed \gset
select is(jsonb_array_length(:'claimed'::jsonb),1,'only the correct tenant device receives a delivery');
select is(:'claimed'::jsonb#>>'{0,endpoint}',:'endpoint_a','delivery is for selected location');
select is(jsonb_array_length(private.claim_order_push(4)),0,'active lease prevents duplicate dispatch');
select (:'claimed'::jsonb#>>'{0,eventId}') as event_id,(:'claimed'::jsonb#>>'{0,subscriptionId}') as subscription_id,
  (:'claimed'::jsonb#>>'{0,lease}') as push_lease \gset
select private.finish_order_push(:'event_id',:'subscription_id',:'push_lease','retry',:'endpoint_a',:'p256dh',:'auth_key');
update private.order_push_deliveries set next_at=statement_timestamp() where event_id=:'event_id';
select private.claim_order_push(4) as retry \gset
select is(:'retry'::jsonb#>>'{0,eventId}',:'event_id','transient failure retries the same event');
select isnt(:'retry'::jsonb#>>'{0,lease}',:'push_lease','retry has a new lease token');
select private.finish_order_push(:'event_id',:'subscription_id',(:'retry'::jsonb#>>'{0,lease}')::uuid,'sent',:'endpoint_a',:'p256dh',:'auth_key');
select is(jsonb_array_length(private.claim_order_push(4)),0,'completed delivery cannot be claimed again');
select is(private.transition_dashboard_order_with_reason(:'owner_a','aal2',:'restaurant_a',:'location_a',
  :'order_id','submitted','accepted',null)->>'outcome','updated','restaurant requests capture');
select is(private.transition_dashboard_order_with_reason(:'owner_a','aal2',:'restaurant_a',:'location_a',
  :'order_id','submitted','accepted',null)->>'outcome','conflict','repeat acceptance does not request another capture');
select is((select status from public.orders where id=:'order_id'),'submitted','order still waits for Stripe settlement');
select ok((select resolved_at is not null from private.order_acceptance_alerts where order_id=:'order_id'),'capture request resolves actionable inbox');
select 'aa000000-0000-0000-0000-000000000006' as capture_lease \gset
select private.claim_platform_online_payment_job('acct_platform',:'order_id',:'capture_lease');
select private.sync_online_payment(:'job',:'capture_lease','paid','pi_manualPushA',null,repeat('b',64));
select is((select status from public.orders where id=:'order_id'),'accepted','Stripe capture confirms acceptance');
select is((select count(*)::integer from private.order_acceptance_events where order_id=:'order_id' and kind='started'),1,'capture never starts a second alarm');

select pg_temp.submit_manual('manual-push-expire',7) as expire_order \gset
select 'aa000000-0000-0000-0000-000000000007' as expire_lease \gset
select private.claim_platform_online_payment_job('acct_platform',:'expire_order',:'expire_lease')->>'id' as expire_job \gset
select private.bind_online_payment_session(:'expire_job',:'expire_lease','cs_test_manualPushB');
select private.sync_online_payment(:'expire_job',:'expire_lease','authorized','pi_manualPushB',null,repeat('c',64));
update public.online_payment_jobs set acceptance_deadline=statement_timestamp()-interval '1 second' where id=:'expire_job';
select is(private.order_acceptance_eligible(:'expire_order'),false,'expired reservation is no longer actionable');
select is(jsonb_array_length(private.claim_order_push(4)),0,'expired order never reaches the push provider');

select pg_temp.submit_manual('manual-push-revoke',8) as revoked_order \gset
select 'aa000000-0000-0000-0000-000000000008' as revoke_lease \gset
select private.claim_platform_online_payment_job('acct_platform',:'revoked_order',:'revoke_lease')->>'id' as revoke_job \gset
select private.bind_online_payment_session(:'revoke_job',:'revoke_lease','cs_test_manualPushC');
select private.sync_online_payment(:'revoke_job',:'revoke_lease','authorized','pi_manualPushC',null,repeat('d',64));
update public.restaurant_memberships set status='suspended' where user_id=:'owner_a';
select is(jsonb_array_length(private.claim_order_push(4)),0,'suspended employee cannot receive pending notification');
update public.restaurant_memberships set status='active' where user_id=:'owner_a';
delete from auth.sessions where id=:'session_a';
select is(jsonb_array_length(private.claim_order_push(4)),0,'signed-out session cannot receive pending notification');
select private.cleanup_order_push();
select is((select count(*)::integer from private.order_push_subscriptions where endpoint=:'endpoint_a'),0,'revoked session subscription is pruned');

select * from finish();
rollback;
