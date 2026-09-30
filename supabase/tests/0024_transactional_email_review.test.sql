begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc
\ir fixtures/delivery.fixture.inc

create function pg_temp.pickup(key text,email text default 'synthetic@example.invalid') returns jsonb language sql as $$
 select private.submit_public_guest_pickup_order('storefront-restaurant-a','storefront-a-mitte',
 'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
 date_trunc('hour',now())+interval '2 hours','[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
 key,jsonb_build_object('contact_name','Synthetic','phone_e164','+999100000011','email',email),'preview-v1',30)
$$;
set local role service_role;
select throws_ok($$select pg_temp.pickup('email-control-0001',E'guest\b@example.invalid')$$,
  'P0001','guest checkout email is invalid','database rejects non-whitespace email controls');
select pg_temp.pickup('email-review-pickup-0001') as pickup \gset
select private.transition_dashboard_order_status('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'pickup'::jsonb->>'orderId')::uuid,'submitted','accepted');
select private.transition_dashboard_order_status('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'pickup'::jsonb->>'orderId')::uuid,'accepted','preparing');
select private.claim_email_deliveries('fd200000-0000-0000-0000-000000000001',25,now()+interval '1 second') as preparing \gset
select is(jsonb_array_length(:'preparing'::jsonb),1,'preparing preserves the still-current acceptance');
select is(:'preparing'::jsonb#>>'{0,templateKey}','order_accepted','accepted email still carries the confirmation');
select is(:'preparing'::jsonb#>>'{0,confirmedFor}',:'pickup'::jsonb->>'requestedFor','confirmation time is retained');
select private.finish_email_delivery((:'preparing'::jsonb#>>'{0,deliveryId}')::uuid,
  'fd200000-0000-0000-0000-000000000001','temporary_failure','provider_unavailable',null,now()+interval '1 second');
select private.transition_dashboard_order_status('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'pickup'::jsonb->>'orderId')::uuid,'preparing','ready');
select private.claim_email_deliveries('fd200000-0000-0000-0000-000000000002',25,now()+interval '32 seconds') as ready \gset
select ok(exists(select 1 from jsonb_array_elements(:'ready'::jsonb) x(value) where value->>'templateKey'='order_accepted'),
  'ready also preserves an unchanged confirmation');
select private.finish_email_delivery((value->>'deliveryId')::uuid,'fd200000-0000-0000-0000-000000000002',
  'accepted',null,'synthetic-'||(value->>'deliveryId'),now()+interval '32 seconds') from jsonb_array_elements(:'ready'::jsonb) x(value);
reset role;

insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled)
 values('f2000000-0000-0000-0000-000000000001','payment.online',true);
set local role service_role;
select private.create_delivery_policy('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  '[{"postalCodes":["52062"],"minimumAmountMinor":0,"feeAmountMinor":350}]') as policy \gset
select private.publish_delivery_policy('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',:'policy');
select private.quote_public_delivery_order('storefront-restaurant-a','storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+interval '6 hours',
  '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]','52062') as quote \gset
select private.submit_public_guest_online_order('storefront-restaurant-a','storefront-a-mitte',
 'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+interval '6 hours',
 '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]','email-review-online-0001',
 '{"contact_name":"Synthetic","phone_e164":"+999100000041","email":"synthetic@example.invalid"}',
 'delivery','{"address_line_1":"Synthetic Lieferweg 10","address_line_2":null,"postal_code":"52062","city":"Aachen","country_code":"DE"}',
 :'quote','preview-v1',30,'acct_synthetic') as online \gset
select private.claim_online_payment_job('acct_synthetic',(:'online'::jsonb->>'orderId')::uuid,
  'fc200000-0000-0000-0000-000000000001') as payment_job \gset
select private.bind_online_payment_session((:'payment_job'::jsonb->>'id')::uuid,
  'fc200000-0000-0000-0000-000000000001','cs_test_emailreview');
select private.sync_online_payment((:'payment_job'::jsonb->>'id')::uuid,
  'fc200000-0000-0000-0000-000000000001','paid','pi_emailreview',null,repeat('a',64));
select private.claim_email_deliveries('fd200000-0000-0000-0000-000000000003',25,now()+interval '1 second') as submitted \gset
select private.finish_email_delivery((:'submitted'::jsonb#>>'{0,deliveryId}')::uuid,
  'fd200000-0000-0000-0000-000000000003','unknown','provider_timeout',null,now()+interval '1 second');
reset role;
-- Fault injection: closure was requested while its provider observation is unresolved.
update public.online_payment_jobs set close_requested='cancelled',provider_terminal=false where id=(:'payment_job'::jsonb->>'id')::uuid;
set local role service_role;
select private.claim_email_deliveries('fd200000-0000-0000-0000-000000000004',25,now()+interval '31 seconds') as closing_lookup \gset
select is(:'closing_lookup'::jsonb#>>'{0,mode}','reconcile','closure does not block an unknown submission lookup');
select is((select count(*)::integer from jsonb_object_keys(:'closing_lookup'::jsonb->0)),4,'lookup projects only the four key fields');
select private.finish_email_delivery((:'submitted'::jsonb#>>'{0,deliveryId}')::uuid,
  'fd200000-0000-0000-0000-000000000004','accepted',null,'synthetic-found',now()+interval '31 seconds');
reset role;
update public.online_payment_jobs set close_requested=null,provider_terminal=true where id=(:'payment_job'::jsonb->>'id')::uuid;
set local role service_role;
select private.transition_dashboard_order_status('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'online'::jsonb->>'orderId')::uuid,'submitted','accepted');
reset role;
update public.online_payment_jobs set close_requested='cancelled',provider_terminal=false where id=(:'payment_job'::jsonb->>'id')::uuid;
set local role service_role;
select is(private.update_order_communication('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'online'::jsonb->>'orderId')::uuid,'accepted',1,'confirm_time',now()+interval '6 hours')->>'outcome',
  'conflict','pending closure forbids a new time confirmation');
select is(jsonb_array_length(private.claim_email_deliveries('fd200000-0000-0000-0000-000000000005',25,now()+interval '1 second')),0,
  'pending closure sends no operational confirmation');
reset role;
select is((select last_error_code from private.email_deliveries where order_id=(:'online'::jsonb->>'orderId')::uuid and template_key='order_accepted'),
  'payment_closing','operational confirmation records its suppression reason');
set local role service_role;
select is(private.transition_dashboard_order_with_reason('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'online'::jsonb->>'orderId')::uuid,'accepted','preparing',null)->>'outcome',
  'conflict','pending closure cannot be bypassed through the status command');
reset role;
update public.online_payment_jobs set close_requested=null,provider_terminal=true where id=(:'payment_job'::jsonb->>'id')::uuid;
set local role service_role;
select private.transition_dashboard_order_with_reason('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'online'::jsonb->>'orderId')::uuid,'accepted','preparing',null);
select private.transition_dashboard_order_with_reason('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'online'::jsonb->>'orderId')::uuid,'preparing','ready',null);
reset role;
update public.online_payment_jobs set close_requested='cancelled',provider_terminal=false where id=(:'payment_job'::jsonb->>'id')::uuid;
set local role service_role;
select is(private.update_order_communication('f1000000-0000-0000-0000-000000000001','aal2',
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'online'::jsonb->>'orderId')::uuid,'ready',1,'dispatch',null)->>'outcome',
  'conflict','pending closure prevents a dispatch command');
reset role;
select * from finish();
rollback;
