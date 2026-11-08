begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc

insert into public.outbox_events(id,restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key,created_at)
values
 ('fc990000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','menu','fc980000-0000-0000-0000-000000000001','menu.version.published','{}','domain-webhook-first',statement_timestamp()),
 ('fc990000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000001','menu','fc980000-0000-0000-0000-000000000001','menu.version.published','{}','domain-webhook-second',statement_timestamp()+interval '1 millisecond'),
 ('fc990000-0000-0000-0000-000000000003','f2000000-0000-0000-0000-000000000001','menu','fc980000-0000-0000-0000-000000000003','menu.version.published','{}','domain-webhook-old',statement_timestamp()-interval '2 days');
select ok(not has_function_privilege('authenticated','private.domain_webhook_claim(uuid,timestamptz,uuid)','execute'),'browser cannot claim events');
select ok(not has_function_privilege('service_role','private.recover_domain_webhook(uuid,uuid,integer,text,text)','execute'),'dispatcher cannot authorize manual recovery');
set local role service_role;
select results_eq($$select id from private.domain_webhook_claim('f2000000-0000-0000-0000-000000000001',statement_timestamp()-interval '1 day','fc970000-0000-0000-0000-000000000001')$$,
 $$select 'fc990000-0000-0000-0000-000000000001'::uuid$$,'only first current event for the aggregate is claimed');
select is(private.domain_webhook_finish('fc990000-0000-0000-0000-000000000001','fc970000-0000-0000-0000-000000000002','accepted'),'conflict','wrong lease cannot finish');
select is(private.domain_webhook_finish('fc990000-0000-0000-0000-000000000001','fc970000-0000-0000-0000-000000000001','confirmation_unknown'),'retry','unknown confirmation is recorded for stable-id retry');
select is((select count(*) from private.domain_webhook_claim('f2000000-0000-0000-0000-000000000001',statement_timestamp()-interval '1 day','fc970000-0000-0000-0000-000000000002')),0::bigint,'backoff and earlier event block later sends');
reset role;
update public.outbox_events set status='dead_letter'
where id='fc990000-0000-0000-0000-000000000001';
select is(private.recover_domain_webhook('f2000000-0000-0000-0000-000000000001','fc990000-0000-0000-0000-000000000001',1,'confirmation_unknown','receiver_fixed'),false,'unknown acceptance requires confirmation from receiver');
select is(private.recover_domain_webhook('f2000000-0000-0000-0000-000000000001','fc990000-0000-0000-0000-000000000001',1,'confirmation_unknown','receiver_confirmed_absent'),true,'operator can recover the confirmed specific event');
select is((select count(*) from private.domain_webhook_recoveries),1::bigint,'recovery is audited');
set local role service_role;
select is((select attempt_count from private.domain_webhook_claim('f2000000-0000-0000-0000-000000000001',statement_timestamp()-interval '1 day','fc970000-0000-0000-0000-000000000002')),1,'the event retains its original ID and starts a new bounded cycle');
select is(private.domain_webhook_finish('fc990000-0000-0000-0000-000000000001','fc970000-0000-0000-0000-000000000002','accepted'),'published','matching lease confirms delivery');
select results_eq($$select id from private.domain_webhook_claim('f2000000-0000-0000-0000-000000000001',statement_timestamp()-interval '1 day','fc970000-0000-0000-0000-000000000003')$$,
 $$select 'fc990000-0000-0000-0000-000000000002'::uuid$$,'next event is now available in order');
select * from finish();
rollback;
