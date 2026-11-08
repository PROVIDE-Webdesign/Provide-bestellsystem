begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc

select ok(not has_function_privilege('authenticated','private.reconcile_support_sources(uuid)','execute'), 'browser cannot run the support job');
select ok(not has_function_privilege('anon','private.claim_domain_webhooks_with_activations(uuid,timestamptz,uuid)','execute'), 'guest cannot claim activation webhooks');

select private.submit_public_guest_pickup_order('storefront-restaurant-a','storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
  date_trunc('hour',now())+interval '2 hours','[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
  'support-reconciliation-test','{"contact_name":"Synthetic","phone_e164":"+999100000011","email":"synthetic@example.invalid"}',
  'preview-v1',30) as order_result \gset
update private.email_deliveries set status='uncertain' where order_id=(:'order_result'::jsonb->>'orderId')::uuid;
set local role service_role;
select is(private.reconcile_support_sources('f2000000-0000-0000-0000-000000000002'),0,'another restaurant sees no issue');
select is(private.reconcile_support_sources('f2000000-0000-0000-0000-000000000001'),1,'uncertain delivery opens one case');
select is(private.reconcile_support_sources('f2000000-0000-0000-0000-000000000001'),0,'unchanged input does not duplicate cases');
reset role;
select ok(exists(select 1 from private.support_audit a join private.support_cases c on c.id=a.case_id
  where c.kind='email_uncertain' and a.actor_user_id is null and a.provenance='system_observed' and a.action='create'), 'system provenance is explicit');
select is((select status from private.email_deliveries where order_id=(:'order_result'::jsonb->>'orderId')::uuid),'uncertain','escalation leaves source unchanged');
update private.email_deliveries set status='suppressed' where order_id=(:'order_result'::jsonb->>'orderId')::uuid;
select is(private.reconcile_support_sources('f2000000-0000-0000-0000-000000000001'),0,'source recovery observes without opening another case');
select is((select evidence->>'stateCode' from private.support_cases where kind='email_uncertain'),'suppressed','recovery refreshes the evidence');

insert into public.menu_publications(id,restaurant_id,location_id,menu_id,menu_version_id,publication_kind,effective_at,actor_user_id,authentication_assurance)
select v.id,'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001','rollback',now()+v.delay,
  'f1000000-0000-0000-0000-000000000001','aal2'
from (values ('e5100000-0000-0000-0000-000000000001'::uuid,interval '1 millisecond'),
             ('e5100000-0000-0000-0000-000000000002'::uuid,interval '2 milliseconds'),
             ('e5100000-0000-0000-0000-000000000003'::uuid,interval '1 hour')) v(id,delay);
insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
select restaurant_id,'menu',menu_id,'menu.version.scheduled',jsonb_build_object('publication_id',id), 'menu-publication:'||id::text
from public.menu_publications where id::text like 'e5100000%';

select pg_sleep(0.01);
set local role service_role;
select count(*) from private.claim_domain_webhooks_with_activations('f2000000-0000-0000-0000-000000000002',now()-interval '1 minute',gen_random_uuid());
select is((select count(*) from public.outbox_events where idempotency_key like 'menu-activation:%'),0::bigint,'foreign claim does not create activation');
select count(*) from private.claim_domain_webhooks_with_activations('f2000000-0000-0000-0000-000000000001',now()-interval '1 minute',gen_random_uuid());
select is((select array_agg(idempotency_key order by idempotency_key) from public.outbox_events where idempotency_key like 'menu-activation:%'),
  array['menu-activation:e5100000-0000-0000-0000-000000000002'],'only the effective publication emits an activation');
select count(*) from private.claim_domain_webhooks_with_activations('f2000000-0000-0000-0000-000000000001',now()-interval '1 minute',gen_random_uuid());
select is((select count(*) from public.outbox_events where idempotency_key like 'menu-activation:%'),1::bigint,'repeated activation check is idempotent');
reset role;
select * from finish();
rollback;
