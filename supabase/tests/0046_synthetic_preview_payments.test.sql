begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc
insert into private.synthetic_test_environment(project_ref,expires_at) values('aaaaaaaaaaaaaaaaaaaa',now()+interval '6 days');
update public.restaurants set slug='test-synthetic-a',display_name='TEST Synthetic A' where id='f2000000-0000-0000-0000-000000000001';
update public.locations set slug='test-synthetic-a-mitte',display_name='TEST Synthetic Mitte' where id='f3000000-0000-0000-0000-000000000001';
select private.configure_synthetic_test_location('aaaaaaaaaaaaaaaaaaaa','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',now()+interval '2 days','Synthetic payment test scope');
insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled) values
 ('f2000000-0000-0000-0000-000000000001','payment.online',true),
 ('f2000000-0000-0000-0000-000000000001','fulfillment.delivery',true);
create function pg_temp.enabled() returns boolean language sql as $$
 select private.is_location_feature_enabled('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','payment.online')
$$;
create function pg_temp.configure(project text default 'aaaaaaaaaaaaaaaaaaaa',until_at timestamptz default now()+interval '1 day') returns void language sql as $$
 select private.configure_synthetic_test_online_payments(project,'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',until_at,'Synthetic payment opt-in test')
$$;
select ok(not pg_temp.enabled(),'migration and restaurant feature alone grant no synthetic payments');
select ok(not has_table_privilege('service_role','private.synthetic_test_online_payments','insert'),'runtime cannot opt in');
select ok(not has_table_privilege('authenticated','private.synthetic_test_online_payments','select'),'browser cannot read opt-in');
select ok(not has_function_privilege('service_role','private.configure_synthetic_test_online_payments(text,uuid,uuid,timestamptz,text)','execute'),'runtime cannot configure opt-in');
select throws_ok($$select pg_temp.configure()$$,'P0001','Explicit active synthetic scope and merchant mapping required','missing merchant mapping rejected');
insert into private.restaurant_test_payment_accounts(restaurant_id,platform_account_id,merchant_account_id,enabled,expires_at,reason)
 values('f2000000-0000-0000-0000-000000000001','acct_platform','acct_merchantA',true,now()+interval '3 days','Synthetic payment mapping');
select ok(not pg_temp.enabled(),'merchant mapping alone still grants nothing');
select throws_ok($$select pg_temp.configure('bbbbbbbbbbbbbbbbbbbb')$$,'P0001','Explicit active synthetic scope and merchant mapping required','wrong project rejected');
select throws_ok($$select pg_temp.configure('aaaaaaaaaaaaaaaaaaaa',now()+interval '4 days')$$,'P0001','Explicit active synthetic scope and merchant mapping required','opt-in cannot outlive location scope');
select throws_ok($$select pg_temp.configure('aaaaaaaaaaaaaaaaaaaa',now()+interval '8 days')$$,'P0001','Invalid synthetic payment configuration','seven day upper bound enforced');
select lives_ok($$select pg_temp.configure()$$,'operator can explicitly enable mapped test scope');
select ok(pg_temp.enabled(),'explicit payment opt-in works');
select ok(not private.is_location_feature_enabled('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','fulfillment.delivery'),'payment opt-in never enables delivery');
select ok(not private.is_location_go_live('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001'),'production remains blocked');
select ok(not private.is_synthetic_test_online_payment_location('f2000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000001'),'cross-restaurant opt-in denied');
select ok(exists(select 1 from private.provide_admin_audit where action='synthetic_test_online_payments.insert' and actor_user_id is null),'opt-in audited without impersonating a user');
update private.synthetic_test_online_payments set enabled=false;
select ok(not pg_temp.enabled(),'disabled opt-in closes payments');
select ok(private.is_location_ordering_enabled('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001'),'payment disablement leaves pickup ordering available');
select pg_temp.configure();
update private.restaurant_test_payment_accounts set enabled=false;
select ok(not pg_temp.enabled(),'disabled merchant mapping closes payments');
select throws_ok($$select pg_temp.configure()$$,'P0001','Explicit active synthetic scope and merchant mapping required','disabled merchant cannot be opted in again');
update private.restaurant_test_payment_accounts set enabled=true,merchant_account_id='acct_replacement';
select ok(not pg_temp.enabled(),'remapping cannot inherit earlier payment opt-in');
select pg_temp.configure();
select ok(pg_temp.enabled(),'operator can explicitly approve changed mapping');
update public.restaurant_feature_flags set enabled=false where feature_key='payment.online';
select ok(not pg_temp.enabled(),'restaurant feature denial still wins');
update public.restaurant_feature_flags set enabled=true where feature_key='payment.online';
insert into private.location_feature_flags(restaurant_id,location_id,feature_key,enabled,reason,changed_by_user_id)
 values('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','payment.online',false,'Synthetic location denial test','f1000000-0000-0000-0000-000000000001');
select ok(not pg_temp.enabled(),'location feature denial still wins');
update private.location_feature_flags set enabled=true where feature_key='payment.online';
update public.locations set status='suspended' where id='f3000000-0000-0000-0000-000000000001';
select ok(not pg_temp.enabled(),'suspension immediately closes payments');
update public.locations set status='active' where id='f3000000-0000-0000-0000-000000000001';
update private.synthetic_test_online_payments set created_at=now()-interval '2 days',expires_at=now()-interval '1 day';
select ok(not pg_temp.enabled(),'expired payment opt-in fails closed');
select pg_temp.configure();
update private.restaurant_test_payment_accounts set created_at=now()-interval '2 days',expires_at=now()-interval '1 day';
select ok(not pg_temp.enabled(),'expired merchant mapping fails closed');
update private.restaurant_test_payment_accounts set created_at=now(),expires_at=now()+interval '3 days';
update private.synthetic_test_environment set created_at=now()-interval '2 days',expires_at=now()-interval '1 day';
select ok(not pg_temp.enabled(),'expired preview environment fails closed');
select * from finish();
rollback;
