begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc
insert into private.support_grants(user_id,can_read,can_manage) values('f1000000-0000-0000-0000-000000000006',true,true);
create function pg_temp.support(q jsonb) returns jsonb language sql as $$select private.support_command('f1000000-0000-0000-0000-000000000006','f1000000-0000-0000-0000-000000000006','aal2',jsonb_build_object('restaurantId','f2000000-0000-0000-0000-000000000001','locationId','f3000000-0000-0000-0000-000000000001')||q)$$;
create function pg_temp.scan_all() returns void language plpgsql as $$declare c text;result jsonb;n integer:=0;begin
 loop result:=pg_temp.support(jsonb_build_object('action','scan','requestId',gen_random_uuid(),'cursor',c));
 if result->>'outcome'<>'allowed' then raise exception 'scan failed';end if;
 c:=result#>>'{data,scanCursor}';n:=n+1;exit when c is null;
 if n>50 then raise exception 'scan did not terminate';end if;end loop;
end $$;
create temporary table source_orders(n integer,id uuid);
insert into source_orders select n,(private.submit_public_guest_pickup_order('storefront-restaurant-a','storefront-a-mitte','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',statement_timestamp())+interval '4 hours'+n*interval '15 minutes','[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]','support-synthetic-'||n,'{"contact_name":"Synthetic","phone_e164":"+999100000011","email":"synthetic@example.invalid"}','preview-v1',30)->>'orderId')::uuid from generate_series(1,40)n;
-- Disposable administrator fault fixtures only; O1 is never given DML on these sources.
insert into public.online_payment_jobs(restaurant_id,location_id,order_id,account_id,deadline,last_error,refund_state)
 select 'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',id,'acct_synthetic',now()+interval '30 minutes','manual_review','failed' from source_orders where n=1;
update private.email_deliveries set status=case when order_id=(select id from source_orders where n=1) then 'dead_letter' else 'uncertain' end;
update private.order_acceptance_alerts set started_at=now()-interval '10 minutes',deadline=now()-interval '1 minute';
create temporary table scan_results(n integer,result jsonb);
insert into scan_results values(1,pg_temp.support(jsonb_build_object('action','scan','requestId',gen_random_uuid(),'cursor',null)));
select is(result->>'outcome','allowed','T14 bounded scan permitted') from scan_results where n=1;
select is((result#>>'{data,scanned}')::integer,100,'T14 first step consumes exactly 100 stable source entries') from scan_results where n=1;
select ok(result#>>'{data,scanCursor}' is not null,'T14 opaque continuation is present') from scan_results where n=1;
-- R22-01: the retained UI cursor never weakens server actor/scope/expiry checks.
insert into private.support_grants(user_id,can_read,can_manage) values('f1000000-0000-0000-0000-000000000005',true,true);
select is(private.support_command('f1000000-0000-0000-0000-000000000005','f1000000-0000-0000-0000-000000000005','aal2',
 jsonb_build_object('action','scan','restaurantId','f2000000-0000-0000-0000-000000000001','locationId','f3000000-0000-0000-0000-000000000001','requestId',gen_random_uuid(),'cursor',result#>>'{data,scanCursor}'))->>'outcome',
 'forbidden','R22-01 another authorized actor cannot use the cursor') from scan_results where n=1;
select is(pg_temp.support(jsonb_build_object('action','scan','restaurantId','f2000000-0000-0000-0000-000000000002','locationId','f3000000-0000-0000-0000-000000000002','requestId',gen_random_uuid(),'cursor',result#>>'{data,scanCursor}'))->>'outcome',
 'forbidden','R22-01 another authorized scope cannot use the cursor') from scan_results where n=1;
select is(pg_temp.support(jsonb_build_object('action','scan','requestId',gen_random_uuid(),'cursor',gen_random_uuid()))->>'outcome',
 'forbidden','R22-01 nonexistent cursor denied');
create temporary table cursor_expiry as select id,expires_at from private.support_scan_cursors;
update private.support_scan_cursors set expires_at=clock_timestamp()-interval '1 second';
select is(pg_temp.support(jsonb_build_object('action','scan','requestId',gen_random_uuid(),'cursor',result#>>'{data,scanCursor}'))->>'outcome',
 'forbidden','R22-01 expired cursor denied') from scan_results where n=1;
update private.support_scan_cursors c set expires_at=e.expires_at from cursor_expiry e where c.id=e.id;
insert into scan_results select 2,pg_temp.support(jsonb_build_object('action','scan','requestId',gen_random_uuid(),'cursor',result#>>'{data,scanCursor}')) from scan_results where n=1;
select is(result->>'outcome','allowed','T14 continuation succeeds') from scan_results where n=2;
select ok((result#>>'{data,scanned}')::integer<=100,'T14 every continuation remains bounded') from scan_results where n=2;
select is(result#>'{data,scanCursor}','null'::jsonb,'T14 fixed source set is exhausted without omission') from scan_results where n=2;
select is((select count(*) from private.support_source_observations),(select count(*) from private.support_sources),'T14 every initial source was observed exactly once');
select is(pg_temp.support(jsonb_build_object('action','scan','requestId',gen_random_uuid(),'cursor',result#>>'{data,scanCursor}'))->>'outcome','conflict','T14 consumed continuation cannot skip/re-run with another request') from scan_results where n=1;
select is((select count(*) from private.support_cases where kind='payment_review'),1::bigint,'T38 manual review source becomes case');
select is((select count(*) from private.support_cases where kind='refund_failed'),1::bigint,'T38 failed refund source becomes case');
select ok(exists(select 1 from private.support_cases where kind='email_uncertain'),'T38 uncertain email source becomes case');
select ok(exists(select 1 from private.support_cases where kind='email_dead_letter'),'T38 email dead letter source becomes case');
select ok(exists(select 1 from private.support_cases where kind='acceptance_overdue'),'T38 overdue acceptance source becomes case');
create temporary table counts as select (select count(*) from private.support_cases)c,(select count(*) from private.support_audit)a;
select pg_temp.scan_all();
select is((select count(*) from private.support_cases),(select c from counts),'T15/T16 repeated scan has no duplicate cases');
select is((select count(*) from private.support_audit),(select a from counts),'T16 unchanged evidence adds no audit');
select ok(not exists(select 1 from private.support_cases where evidence::text ~ 'acct_|cs_test_|pi_|guest@example|phone|contact_name|address|provider_reference|last_error_code'),'T10/T12 minimal evidence has no contacts, provider IDs or raw errors');
create temporary table history_before_contact_delete as select md5(jsonb_build_object('cases',(select jsonb_agg(to_jsonb(c) order by id) from private.support_cases c),'audit',(select jsonb_agg(to_jsonb(a) order by id) from private.support_audit a))::text) hash;
-- Physical erasure is an administrator test fixture, never an O1 command.
update public.order_customer_contacts set purged_at=clock_timestamp(),contact_name=null,phone_e164=null,email=null where order_id in(select id from source_orders);
select is((select count(*) from public.order_customer_contacts where order_id in(select id from source_orders) and(contact_name is not null or phone_e164 is not null or email is not null)),0::bigint,'T12 synthetic contact fields physically erased through the permitted purge transition');
select is(md5(jsonb_build_object('cases',(select jsonb_agg(to_jsonb(c) order by id) from private.support_cases c),'audit',(select jsonb_agg(to_jsonb(a) order by id) from private.support_audit a))::text),(select hash from history_before_contact_delete),'T12 physical contact deletion preserves all support references and audit');
create temporary table selected_case as select id,revision,source_id from private.support_cases where kind='payment_review';
create function pg_temp.close_payment(reason text,fp text default null) returns jsonb language sql as $$
 select pg_temp.support(jsonb_build_object('action','update','requestId',gen_random_uuid(),'caseId',id,'expectedRevision',(select revision from private.support_cases where id=s.id),'operation','status','assigneeUserId',null,'state','resolved','severity',null,'deadline',null,'reason',reason,'sourceFingerprint',fp)) from selected_case s
$$;
select is(pg_temp.close_payment('source_confirmed',(select evidence->>'fingerprint' from private.support_cases where id=(select id from selected_case)))->>'outcome','conflict','T23 unknown provider state cannot be technically closed');
create temporary table old_fingerprint as select evidence->>'fingerprint' fp from private.support_cases where id=(select id from selected_case);
update public.online_payment_jobs set last_error=null,refund_state='succeeded',provider_terminal=true;
select is(pg_temp.close_payment('source_confirmed',(select fp from old_fingerprint))->>'outcome','conflict','T24 stale source fingerprint rejected');
select is(pg_temp.close_payment('source_confirmed',(select fingerprint from private.support_sources where kind='payment_review'))->'data'->'cases'->0->>'resolution','technical','T24 current internal terminal proof accepted');
select pg_temp.scan_all();
update public.online_payment_jobs set last_error='manual_review',provider_terminal=false;
select pg_temp.scan_all();
select ok(exists(select 1 from private.support_cases where kind='payment_review' and state='open' and previous_case_id=(select id from selected_case)),'T17 new unhealthy episode after observed healthy state links prior case');
select is((select state from private.support_cases where id=(select id from selected_case)),'resolved','T17 prior episode remains unchanged');
select is(pg_temp.support(jsonb_build_object('action','create','requestId',gen_random_uuid(),'kind','payment_review','sourceId',gen_random_uuid(),'severity','high','reason','triage'))->>'outcome','not_found','T18 missing internal reference rejected');
create temporary table source_before as select md5(jsonb_build_object('payments',(select jsonb_agg(to_jsonb(p) order by id) from public.online_payment_jobs p),'email',(select jsonb_agg(to_jsonb(e) order by id) from private.email_deliveries e),'orders',(select jsonb_agg(to_jsonb(o) order by id) from public.orders o),'alerts',(select jsonb_agg(to_jsonb(a) order by order_id) from private.order_acceptance_alerts a))::text) hash;
select pg_temp.scan_all();
select is(md5(jsonb_build_object('payments',(select jsonb_agg(to_jsonb(p) order by id) from public.online_payment_jobs p),'email',(select jsonb_agg(to_jsonb(e) order by id) from private.email_deliveries e),'orders',(select jsonb_agg(to_jsonb(o) order by id) from public.orders o),'alerts',(select jsonb_agg(to_jsonb(a) order by order_id) from private.order_acceptance_alerts a))::text),(select hash from source_before),'T27/T29/T30 internal scan preserves business jobs, deadlines and orders byte for byte');
select is(pg_temp.support(jsonb_build_object('action','retry_online_refund','requestId',gen_random_uuid()))->>'outcome','invalid','T32 forbidden business action rejected');
select * from finish();
rollback;
