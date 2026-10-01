begin;
select plan(42);
\ir fixtures/storefront.fixture.inc
create function pg_temp.history(q jsonb default '{}',actor uuid default 'f1000000-0000-0000-0000-000000000001',aal text default 'aal2') returns jsonb language sql as $$
select private.read_order_history(actor,aal,'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',q);
$$;
create table history_test_orders(n integer,id uuid);
insert into history_test_orders select n,private.submit_order_with_payment('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001','pickup',date_trunc('hour',statement_timestamp())+interval '4 hours'+n*interval '15 minutes','[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]','history-synthetic-'||n) from generate_series(1,4) n;
select private.transition_order_status('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(select id from history_test_orders where n=1),'accepted','f1000000-0000-0000-0000-000000000001','aal2');
select private.transition_order_status('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(select id from history_test_orders where n=1),'preparing','f1000000-0000-0000-0000-000000000001','aal2');
select private.transition_order_status('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(select id from history_test_orders where n=1),'ready','f1000000-0000-0000-0000-000000000001','aal2');
select private.transition_order_status('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(select id from history_test_orders where n=1),'completed','f1000000-0000-0000-0000-000000000001','aal2');
select private.transition_order_status('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(select id from history_test_orders where n=2),'rejected','f1000000-0000-0000-0000-000000000001','aal2');
select private.transition_order_status('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',(select id from history_test_orders where n=3),'cancelled','f1000000-0000-0000-0000-000000000001','aal2');
-- Expired synthetic personal data is seeded by the disposable database admin, never a production writer.
insert into public.order_customer_contacts(restaurant_id,location_id,order_id,contact_name,phone_e164,privacy_notice_version,created_at,retention_until)
select 'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',id,
case when n=1 then 'Expired Synthetic' when n=2 then 'Literal %_ Name' else 'Current Synthetic' end,
'+999100000081','preview-v1',now()-interval '2 days',case when n=1 or n=4 then now()-interval '1 day' else now()+interval '30 days' end from history_test_orders;
select ok(not has_function_privilege('authenticated','private.read_order_history(uuid,text,uuid,uuid,jsonb)','execute'),'browser cannot forge history actor');
select ok(not has_function_privilege('anon','private.run_guest_retention_purge()','execute'),'anonymous purge denied');
select ok(not has_table_privilege('service_role','private.guest_purge_runs','insert'),'purge audit cannot be forged directly');
select is(pg_temp.history()->>'outcome','allowed','owner history allowed');
select is(pg_temp.history('{}','f1000000-0000-0000-0000-000000000001','aal1')->>'outcome','forbidden','owner needs MFA');
select is(pg_temp.history('{}','f1000000-0000-0000-0000-000000000003')->>'outcome','forbidden','kitchen has no history/search metrics');
select is(pg_temp.history('{}','f1000000-0000-0000-0000-000000000004')->>'outcome','forbidden','driver denied');
select is(pg_temp.history('{}','f1000000-0000-0000-0000-000000000006')->>'outcome','forbidden','unassigned manager denied');
select is(pg_temp.history('{}','f1000000-0000-0000-0000-000000000005')->>'outcome','forbidden','foreign owner denied');
select is(private.read_order_history('f1000000-0000-0000-0000-000000000001','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002','{}')->>'outcome','forbidden','foreign location denied');
select is(pg_temp.history('{}','f1000000-0000-0000-0000-000000000002')->>'outcome','allowed','assigned manager allowed');
select is(jsonb_array_length(pg_temp.history()#>'{data,orders}'),4,'all statuses included without truncation');
select is(pg_temp.history()#>>'{data,timezone}','Europe/Berlin','location calendar exposed');
select is(pg_temp.history()#>>'{data,fromDate}',date_trunc('week',now() at time zone 'Europe/Berlin')::date::text,'default starts Monday');
select jsonb_path_query_first(pg_temp.history()#>'{data,metrics}','$[*] ? (@.period == "total")') as total \gset
select is((:'total'::jsonb->>'orderCount')::integer,4,'cohort counts each order once');
select is((:'total'::jsonb->>'completedGrossMinor')::integer,1250,'gross excludes pending rejected cancelled');
select is((:'total'::jsonb->>'averageCompletedMinor')::integer,1250,'average denominator completed');
select is((:'total'::jsonb->>'rejectionBasisPoints')::integer,2500,'rejection denominator all submitted orders');
select is((:'total'::jsonb->>'cancelledCount')::integer,1,'cancellations separate');
select is((:'total'::jsonb->>'capturedMinor')::integer,0,'cash fulfilment not silently confirmed as paid');
select is(jsonb_array_length(pg_temp.history('{"limit":2}')#>'{data,orders}'),2,'bounded page');
select pg_temp.history('{"limit":2}') as page1 \gset
select pg_temp.history(jsonb_build_object('limit',2,'cursor',:'page1'::jsonb#>>'{data,nextCursor}')) as page2 \gset
select is(jsonb_array_length(:'page2'::jsonb#>'{data,orders}'),2,'tie timestamp next page complete');
select is((select count(distinct o->>'orderId')::integer from jsonb_array_elements((:'page1'::jsonb#>'{data,orders}')||(:'page2'::jsonb#>'{data,orders}')) o),4,'keyset pages no duplicate');
select is(:'page1'::jsonb#>'{data,metrics}',:'page2'::jsonb#>'{data,metrics}','metrics independent of cursor page');
select is(jsonb_array_length(pg_temp.history('{"customerName":"%_"}')#>'{data,orders}'),1,'literal wildcard symbols not LIKE wildcards');
select is(jsonb_array_length(pg_temp.history('{"customerName":"Expired"}')#>'{data,orders}'),0,'expired names not searchable before batch');
select is(jsonb_array_length(pg_temp.history('{"status":"completed"}')#>'{data,orders}'),1,'status filter');
select is(jsonb_array_length(pg_temp.history('{"fulfillmentType":"delivery"}')#>'{data,orders}'),0,'fulfilment filter');
select is(pg_temp.history('{"fromDate":"2026-01-01","toDate":"2026-12-31"}')->>'outcome','invalid','range bound enforced in SQL');
select is(pg_temp.history('{"customerName":"x"}')->>'outcome','invalid','minimum search length enforced in SQL');
select is(pg_temp.history('{"actor":"forged"}')->>'outcome','invalid','unknown query field rejected');
select is((select end_at-start_at from private.history_calendar_bounds('2026-03-29','2026-03-29','Europe/Berlin')),interval '23 hours','spring local day 23 hours');
select is((select end_at-start_at from private.history_calendar_bounds('2026-10-25','2026-10-25','Europe/Berlin')),interval '25 hours','autumn local day 25 hours');
select pg_temp.history(jsonb_build_object('orderId',(select id from history_test_orders where n=1))) as detail \gset
select is(jsonb_array_length(:'detail'::jsonb#>'{data,detail,events}'),5,'complete append-only status sequence');
select is(:'detail'::jsonb#>'{data,detail,order,contactName}','null'::jsonb,'expired contact hidden in detail');
select is(private.run_guest_retention_purge(),1,'regular bounded purge removes terminal expired contacts');
select is(private.run_guest_retention_purge(),0,'repeat within cadence does not process again');
select is((select count(*)::integer from private.guest_purge_runs),1,'exactly one committed audit record');
select is((select contact_name from public.order_customer_contacts where order_id=(select id from history_test_orders where n=4)),'Current Synthetic','nonterminal expired contact retained for fulfilment');
select ok((pg_temp.history()#>>'{data,purge,lastRunAt}') is not null,'minimized last-run proof available');
select throws_ok('delete from private.guest_purge_runs','23514','order records are append-only','purge audit immutable');
update public.restaurant_memberships set status='suspended' where restaurant_id='f2000000-0000-0000-0000-000000000001' and user_id='f1000000-0000-0000-0000-000000000001';
select is(pg_temp.history()->>'outcome','forbidden','rights revocation checked freshly');
select * from finish();
rollback;
