begin;
select plan(40);
\ir fixtures/storefront.fixture.inc
create function pg_temp.ops(c jsonb default null) returns jsonb language sql as $$
 select private.location_operations_dashboard('f1000000-0000-0000-0000-000000000001','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',c);
$$;
create function pg_temp.override(c text,p boolean,minutes integer,lead integer default null,capacity integer default null,maxopen integer default null) returns jsonb language sql as $$
 select pg_temp.ops(jsonb_build_object('action','override','scope',c,'expectedSequence',(pg_temp.ops()#>>'{data,operationSequence}')::integer,'endsAt',statement_timestamp()+make_interval(mins=>minutes),'reason','Synthetic operational test','values',jsonb_build_object('paused',p,'leadMinutes',lead,'orderCapacity',capacity,'itemCapacity',null,'maxOpenOrders',maxopen)));
$$;
select ok(not has_function_privilege('authenticated','private.location_operations_dashboard(uuid,text,uuid,uuid,jsonb)','EXECUTE'),'browser cannot forge actor/AAL on administration');
select ok(not has_table_privilege('service_role','private.location_operation_events','INSERT'),'service cannot write unaudited operations directly');
select ok(not has_table_privilege('authenticated','private.location_configuration_audit','SELECT'),'audit is private and projected by verified API');
select is(private.location_operations_dashboard('f1000000-0000-0000-0000-000000000001','aal1','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',null)->>'outcome','forbidden','owner requires MFA');
select is(private.location_operations_dashboard('f1000000-0000-0000-0000-000000000003','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',null)->>'outcome','forbidden','kitchen cannot manage configuration');
select is(private.location_operations_dashboard('f1000000-0000-0000-0000-000000000006','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',null)->>'outcome','forbidden','unassigned manager denied');
select is(private.location_operations_dashboard('f1000000-0000-0000-0000-000000000001','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002',null)->>'outcome','forbidden','foreign location denied');
select is(pg_temp.ops()->>'outcome','allowed','existing configuration can be read');
select ok((pg_temp.ops()#>>'{data,serverNow}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}.[0-9]{3}Z$','server clock uses the millisecond UTC wire contract');
select is(pg_temp.override('delivery',true,20)->>'outcome','allowed','delivery pause is accepted');
select is(private.location_ordering_paused('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','pickup',statement_timestamp()),false,'delivery pause does not pause pickup');
select is(private.location_ordering_paused('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','delivery',statement_timestamp()),true,'delivery is paused');
select is(pg_temp.override('all',true,20)->>'outcome','allowed','global pause is accepted');
select pg_temp.ops(jsonb_build_object('action','clear_override','scope','pickup','expectedSequence',(pg_temp.ops()#>>'{data,operationSequence}')::integer,'reason','Synthetic pickup resume'));
select is(private.location_ordering_paused('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','pickup',statement_timestamp()),true,'pickup resume cannot cancel global pause');
select is(private.location_ordering_paused('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','pickup',statement_timestamp()+interval '21 minutes'),false,'expiry works without a scheduler');
select is(pg_temp.ops(jsonb_build_object('action','clear_override','scope','all','expectedSequence',0,'reason','Stale synthetic')) ->>'outcome','conflict','stale operation conflict');
select is(pg_temp.override('pickup',false,1441)->>'outcome','invalid','duration above 24 hours is rejected');
select is(pg_temp.override('pickup',false,0)->>'outcome','invalid','already expired override is rejected');
select pg_temp.ops(jsonb_build_object('action','clear_override','scope','all','expectedSequence',(pg_temp.ops()#>>'{data,operationSequence}')::integer,'reason','Synthetic full resume'));
select pg_temp.override('pickup',false,20,120,2);
select is((select reason_code from private.resolve_ordering_availability('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','pickup',statement_timestamp()+interval '1 hour',1,statement_timestamp())),'lead_time','temporary lead time is enforced');
select is((select maximum_orders from private.resolve_ordering_availability('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','pickup',date_trunc('hour',statement_timestamp())+interval '4 hours',1,statement_timestamp())),2,'temporary slot capacity is enforced');
select is((select maximum_orders from private.resolve_ordering_availability('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','pickup',date_trunc('hour',statement_timestamp())+interval '4 hours',1,statement_timestamp()+interval '21 minutes')),10,'expired capacity falls back to regular values');
select throws_ok('delete from private.location_operation_events','23514','ordering availability history is append-only','operation history cannot be deleted');
select pg_temp.ops(jsonb_build_object('action','create_draft','sourceVersionId','f8000000-0000-0000-0000-000000000001','reason','Synthetic configuration')) as created \gset
select (:'created'::jsonb#>>'{data,versions,0,id}') as draft \gset
select is(:'created'::jsonb->>'outcome','allowed','existing schedule copied into a new draft');
select is(private.resolve_availability_schedule_version('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001'),'f8000000-0000-0000-0000-000000000001'::uuid,'draft does not change live rules');
select jsonb_set(jsonb_set(:'created'::jsonb#>'{data,versions,0,configuration}','{acceptanceMinutes}','7'),'{maxOpenOrders}','1') as config \gset
select is(pg_temp.ops(jsonb_build_object('action','save_draft','versionId',:'draft','expectedRevision',0,'configuration',:'config'::jsonb,'reason','Synthetic limits'))->>'outcome','allowed','complete draft saved');
select is(pg_temp.ops(jsonb_build_object('action','save_draft','versionId',:'draft','expectedRevision',0,'configuration',:'config'::jsonb,'reason','Stale synthetic'))->>'outcome','conflict','stale edit is rejected');
select is(pg_temp.ops(jsonb_build_object('action','publish','versionId',:'draft','expectedRevision',1,'expectedPublicationId',null,'expectedDeliveryPolicyId',null,'reason','Stale publication'))->>'outcome','conflict','changed publication requires deliberate review');
select pg_temp.ops() as current \gset
select is(pg_temp.ops(jsonb_build_object('action','publish','versionId',:'draft','expectedRevision',1,'expectedPublicationId',:'current'::jsonb#>'{data,publicationId}','expectedDeliveryPolicyId',:'current'::jsonb#>'{data,deliveryPolicyId}','reason','Synthetic publish'))->>'outcome','allowed','configuration publication reuses native rules');
select is(private.resolve_availability_schedule_version('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',statement_timestamp()),:'draft'::uuid,'published version becomes current');
select is(pg_temp.ops(jsonb_build_object('action','save_draft','versionId',:'draft','expectedRevision',1,'configuration',:'config'::jsonb,'reason','Synthetic overwrite'))->>'outcome','conflict','published version cannot be edited');
select throws_ok('delete from private.location_configuration_audit','23514','ordering availability history is append-only','configuration audit cannot be deleted');
select pg_temp.ops(jsonb_build_object('action','clear_override','scope','pickup','expectedSequence',(pg_temp.ops()#>>'{data,operationSequence}')::integer,'reason','Synthetic resume'));
select private.submit_public_guest_pickup_order('storefront-restaurant-a','storefront-a-mitte','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',statement_timestamp())+interval '4 hours','[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]','b3b4-synthetic-001','{"contact_name":"Synthetic","phone_e164":"+999100000045","email":"synthetic@example.invalid"}','preview-v1',30) as submitted \gset
select (:'submitted'::jsonb->>'orderId') as order_id \gset
select is((select deadline-started_at from private.order_acceptance_alerts where order_id=:'order_id'),interval '7 minutes','new actionable order snapshots configured acceptance deadline');
select is((pg_temp.ops()#>>'{data,openOrders}')::integer,1,'open-order count includes submitted cash order');
select is((select reason_code from private.resolve_ordering_availability('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','pickup',date_trunc('hour',statement_timestamp())+interval '5 hours',1,statement_timestamp())),'capacity_exhausted','open-order limit applies across slots');
select is(private.reserve_ordering_capacity('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','delivery',date_trunc('hour',statement_timestamp())+interval '5 hours',1,'b3b4-new-delivery'),false,'cross-channel reservation cannot bypass global cap');
select private.transition_dashboard_order_with_reason('f1000000-0000-0000-0000-000000000001','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',:'order_id','submitted','accepted',null);
select pg_temp.override('all',true,10);
select is((select status from public.orders where id=:'order_id'),'accepted','new pause leaves accepted order untouched');
select ok((select count(*)>0 from private.location_configuration_audit where before_state is not null and after_state is not null),'audit records before and after states');
select ok(not has_function_privilege('service_role','private.reserve_ordering_capacity_before_location_controls(uuid,uuid,text,timestamptz,integer,text,timestamptz)','EXECUTE'),'unlocked reservation cannot be called directly');
select ok(not has_function_privilege('service_role','private.submit_order_before_location_controls(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz)','EXECUTE'),'pickup cannot bypass the common first lock');
select ok(not has_function_privilege('service_role','private.submit_priced_delivery_order_before_location_controls(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz,uuid,bigint)','EXECUTE'),'priced delivery cannot bypass the common first lock');
select * from finish();
rollback;
