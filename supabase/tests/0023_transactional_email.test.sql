begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc

select ok(not has_table_privilege('service_role','private.email_deliveries','select'),'worker cannot read ledger directly');
select ok(not has_function_privilege('authenticated','private.claim_email_deliveries(uuid,integer,timestamptz)','execute'),'browser cannot claim email');
select ok(not has_function_privilege('service_role','private.store_guest_checkout_snapshot_before_email(uuid,uuid,uuid,jsonb,jsonb,text,timestamptz)','execute'),'service cannot bypass new contact validation');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.email_deliveries'::regclass),'email ledger has forced RLS');
select throws_ok($sql$
  select private.submit_public_guest_pickup_order('storefront-restaurant-a','storefront-a-mitte',
    'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
    date_trunc('hour',now())+interval '2 hours','[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
    'email-missing-0001','{"contact_name":"Synthetic","phone_e164":"+999100000011","email":null}','preview-v1',30)
$sql$,'P0001','guest checkout email is required','database rejects a new order without email');
select is((select count(*)::integer from public.orders),0,'contact error rolls back the order and capacity transaction');

set local role service_role;
select private.submit_public_guest_pickup_order('storefront-restaurant-a','storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
  date_trunc('hour',now())+interval '2 hours','[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
  'email-order-0001','{"contact_name":"Synthetic","phone_e164":"+999100000011","email":"synthetic@example.invalid"}','preview-v1',30) as confirmation \gset
reset role;
select is((select count(*)::integer from private.email_deliveries),1,'one submission creates one email job');
select ok(not exists(select 1 from private.email_deliveries d where row_to_json(d)::text like '%@%'),'ledger has no recipient');
select ok(not exists(select 1 from public.outbox_events where payload::text like '%synthetic@example.invalid%'),'outbox has no email address');
set local role service_role;
select private.claim_email_deliveries('fd100000-0000-0000-0000-000000000001',25,now()+interval '1 second') as first_claim \gset
select is(jsonb_array_length(:'first_claim'::jsonb),1,'bounded claim returns the email');
select is(:'first_claim'::jsonb#>>'{0,email}','synthetic@example.invalid','contact is projected only for the worker');
select is(jsonb_array_length(private.claim_email_deliveries('fd100000-0000-0000-0000-000000000002',25,now())),0,'concurrent worker cannot claim locked job');
select is(private.finish_email_delivery((:'first_claim'::jsonb#>>'{0,deliveryId}')::uuid,
  'fd100000-0000-0000-0000-000000000099','accepted',null,'synthetic-1',now()),'conflict','wrong lease cannot complete');
select is(private.finish_email_delivery((:'first_claim'::jsonb#>>'{0,deliveryId}')::uuid,
  'fd100000-0000-0000-0000-000000000001','unknown','provider_timeout',null,now()+interval '1 second'),'uncertain','unclear acceptance does not blindly resend');
select private.claim_email_deliveries('fd100000-0000-0000-0000-000000000003',25,now()+interval '31 seconds') as uncertain_claim \gset
select is(:'uncertain_claim'::jsonb#>>'{0,mode}','reconcile','unknown send is claimed for lookup');
select is(private.finish_email_delivery((:'first_claim'::jsonb#>>'{0,deliveryId}')::uuid,
  'fd100000-0000-0000-0000-000000000003','temporary_failure','provider_unavailable',null,now()+interval '31 seconds'),
  'uncertain','a failed lookup does not authorize a second send');
select private.claim_email_deliveries('fd100000-0000-0000-0000-000000000004',25,now()+interval '3 minutes') as reconcile_claim \gset
select is(:'reconcile_claim'::jsonb#>>'{0,mode}','reconcile','repeated unknown lookup remains reconciliation');
select is(private.finish_email_delivery((:'first_claim'::jsonb#>>'{0,deliveryId}')::uuid,
  'fd100000-0000-0000-0000-000000000004','accepted',null,'synthetic-1',now()+interval '3 minutes'),'accepted','found provider acceptance is persisted');
reset role;
select is((select status from private.email_deliveries where id=(:'first_claim'::jsonb#>>'{0,deliveryId}')::uuid),'accepted','acceptance is not called delivered');
set local role service_role;
select ok(not private.record_email_delivery_receipt((:'first_claim'::jsonb#>>'{0,deliveryId}')::uuid,'foreign-reference','delivered',now()+interval '4 minutes'),'foreign provider reference cannot prove delivery');
select ok(private.record_email_delivery_receipt((:'first_claim'::jsonb#>>'{0,deliveryId}')::uuid,'synthetic-1','delivered',now()+interval '4 minutes'),'explicit receipt proves delivery');
select ok(private.record_email_delivery_receipt((:'first_claim'::jsonb#>>'{0,deliveryId}')::uuid,'synthetic-1','delivered',now()+interval '4 minutes'),'duplicate receipt is idempotent');
select ok(not private.record_email_delivery_receipt((:'first_claim'::jsonb#>>'{0,deliveryId}')::uuid,'synthetic-1','bounced',now()+interval '5 minutes'),'contradictory receipt cannot rewrite final state');
select private.transition_dashboard_order_status('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'confirmation'::jsonb->>'orderId')::uuid,'submitted','accepted');
select is(private.read_dashboard_order('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'confirmation'::jsonb->>'orderId')::uuid)#>>'{data,communication,revision}','1','acceptance confirms the requested time');
select is(private.update_order_communication('f1000000-0000-0000-0000-000000000005','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'confirmation'::jsonb->>'orderId')::uuid,'accepted',1,'confirm_time',now()+interval '3 hours')->>'outcome','forbidden','foreign tenant cannot correct time');
select is(private.update_order_communication('f1000000-0000-0000-0000-000000000001','aal1',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'confirmation'::jsonb->>'orderId')::uuid,'accepted',1,'confirm_time',now()+interval '3 hours')->>'outcome','forbidden','management needs MFA');
select is(private.update_order_communication('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'confirmation'::jsonb->>'orderId')::uuid,'accepted',99,'confirm_time',now()+interval '3 hours')->>'outcome','conflict','stale revision is rejected');
select is(private.update_order_communication('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'confirmation'::jsonb->>'orderId')::uuid,'accepted',1,'confirm_time',now()+interval '3 hours')->>'outcome','updated','confirmed ETA can be corrected');
reset role;
select is((select count(*)::integer from private.order_communication_events where action='confirm_time'),1,'time correction has actor audit');
select is((select count(*)::integer from private.email_deliveries where template_key='order_time_changed'),1,'correction creates one event email');
set local role service_role;
select private.claim_email_deliveries('fd100000-0000-0000-0000-000000000005',25,now()+interval '1 second') as correction_claim \gset
select is(jsonb_array_length(:'correction_claim'::jsonb),1,'obsolete acceptance is suppressed while latest correction remains');
select is(:'correction_claim'::jsonb#>>'{0,templateKey}','order_time_changed','correct message claimed');
select is(private.finish_email_delivery((:'correction_claim'::jsonb#>>'{0,deliveryId}')::uuid,
  'fd100000-0000-0000-0000-000000000005','permanent_failure','destination_rejected',null,now()+interval '1 second'),'dead_letter','permanent failure does not rollback order');
select is(private.retry_email_delivery('f1000000-0000-0000-0000-000000000003','aal1',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'correction_claim'::jsonb#>>'{0,deliveryId}')::uuid),'forbidden','kitchen cannot retry customer delivery');
select is(private.retry_email_delivery('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'correction_claim'::jsonb#>>'{0,deliveryId}')::uuid),'retry','management retry is explicit');
reset role;
select is((select count(*)::integer from private.email_retry_events),1,'manual retry has audit');
select is((select status from public.orders where id=(:'confirmation'::jsonb->>'orderId')::uuid),'accepted','mail failure leaves order intact');
select ok(private.read_public_guest_order_status('storefront-restaurant-a','storefront-a-mitte',(:'confirmation'::jsonb->>'orderId')::uuid) is not null,'status survives mail failure');
-- Exercise actual retry scheduling and the bounded attempt budget.
set local role service_role;
select private.claim_email_deliveries('fd100000-0000-0000-0000-000000000007',25,now()+interval '2 seconds') as retry_claim \gset
select is(private.finish_email_delivery((:'correction_claim'::jsonb#>>'{0,deliveryId}')::uuid,
  'fd100000-0000-0000-0000-000000000007','temporary_failure','provider_rate_limited',null,now()+interval '2 seconds'),
  'retry','explicit temporary refusal permits a scheduled retry');
select is(jsonb_array_length(private.claim_email_deliveries('fd100000-0000-0000-0000-000000000008',25,now()+interval '31 seconds')),0,
  'temporary refusal cannot be retried before its backoff');
reset role;
do $$
declare attempt integer; observed text; claimed jsonb; delivery uuid; lock_id uuid;
begin
  select id into delivery from private.email_deliveries where template_key='order_time_changed';
  for attempt in 2..6 loop
    lock_id:=gen_random_uuid();
    claimed:=private.claim_email_deliveries(lock_id,25,now()+make_interval(hours=>attempt*3));
    if jsonb_array_length(claimed)<>1 then raise exception 'expected exactly one retry'; end if;
    observed:=private.finish_email_delivery(delivery,lock_id,'temporary_failure','provider_unavailable',null,now()+make_interval(hours=>attempt*3));
    if observed<>(case when attempt=6 then 'dead_letter' else 'retry' end) then raise exception 'unexpected retry outcome'; end if;
  end loop;
end;
$$;
select is((select attempt_count from private.email_deliveries where template_key='order_time_changed'),6,'retry budget is six attempts');
select is((select status from private.email_deliveries where template_key='order_time_changed'),'dead_letter','six definite failures end in dead letter');
-- A lost worker must reconcile, even after the contact was purged; it never resends PII.
set local role service_role;
select private.update_order_communication('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'confirmation'::jsonb->>'orderId')::uuid,'accepted',2,'confirm_time',now()+interval '2 hours 55 minutes');
select private.claim_email_deliveries('fd100000-0000-0000-0000-000000000009',25,now()+interval '2 seconds') as lost_claim \gset
select is(private.finish_email_delivery((:'lost_claim'::jsonb#>>'{0,deliveryId}')::uuid,
  'fd100000-0000-0000-0000-000000000009','accepted',null,'late-worker',now()+interval '6 minutes'),
  'conflict','expired worker cannot record acceptance');
reset role;
update public.order_customer_contacts set contact_name=null,phone_e164=null,email=null,purged_at=now()+interval '6 minutes'
  where order_id=(:'confirmation'::jsonb->>'orderId')::uuid;
set local role service_role;
select private.claim_email_deliveries('fd100000-0000-0000-0000-000000000010',25,now()+interval '6 minutes') as lost_reconcile \gset
select is(:'lost_reconcile'::jsonb#>>'{0,mode}','reconcile','expired claim is reconciled rather than sent');
select is(:'lost_reconcile'::jsonb#>>'{0,email}','reconcile@example.invalid','reconciliation needs no purged recipient');
select is(private.finish_email_delivery((:'lost_claim'::jsonb#>>'{0,deliveryId}')::uuid,
  'fd100000-0000-0000-0000-000000000010','not_found',null,null,now()+interval '6 minutes'),
  'retry','authoritative absence permits a fresh eligibility check');
select is(jsonb_array_length(private.claim_email_deliveries('fd100000-0000-0000-0000-000000000011',25,now()+interval '9 minutes')),0,
  'purged recipient prevents a send after authoritative absence');
reset role;
select is((select status from private.email_deliveries where id=(:'lost_claim'::jsonb#>>'{0,deliveryId}')::uuid),'suppressed','purged contact is suppressed');
-- Simulate a contact created before this migration. Its nullable snapshot and exact retry remain valid.
select private.submit_order('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001','pickup',
  date_trunc('hour',now())+interval '4 hours','[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
  'historical-email-null-0001',now()) as legacy_order \gset
select private.initialize_order_payment('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',:'legacy_order','on_fulfillment');
select private.store_guest_checkout_snapshot_before_email('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  :'legacy_order','{"contact_name":"Historical Synthetic","phone_e164":"+999100000011","email":null}',null,'preview-v1',now()+interval '30 days');
select lives_ok(format($sql$select private.store_guest_checkout_snapshot('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  %L::uuid,'{"contact_name":"Historical Synthetic","phone_e164":"+999100000011","email":null}',null,'preview-v1',%L::timestamptz)$sql$,:'legacy_order',now()+interval '30 days'),
  'historical nullable contact remains exactly retryable');
select ok(private.read_public_guest_order_status('storefront-restaurant-a','storefront-a-mitte',:'legacy_order') is not null,'historical status remains readable');
select private.claim_email_deliveries('fd100000-0000-0000-0000-000000000006',25,now()+interval '2 seconds');
select is((select status from private.email_deliveries where order_id=:'legacy_order' and template_key='order_submitted'),'suppressed','historical order without email suppresses delivery');
select * from finish();
rollback;
