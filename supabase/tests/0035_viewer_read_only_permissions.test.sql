-- A3: disposable fixtures only; no remote project or provider. All changes roll back.
begin;
select no_plan();
\ir fixtures/storefront.fixture.inc

create function pg_temp.v_uid(n int default 21) returns uuid language sql as $$
 select ('f1000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.v_r() returns uuid language sql as $$select 'f2000000-0000-0000-0000-000000000001'::uuid$$;
create function pg_temp.v_l() returns uuid language sql as $$select 'f3000000-0000-0000-0000-000000000001'::uuid$$;
insert into auth.users(id,email,email_confirmed_at) values
 (pg_temp.v_uid(),'a3-viewer@example.invalid',now()),
 (pg_temp.v_uid(22),'a3-invited-viewer@example.invalid',now());
insert into public.locations(id,restaurant_id,slug,display_name)
 values('f3000000-0000-0000-0000-000000000021',pg_temp.v_r(),'a3-unassigned','Unassigned');
insert into public.restaurant_memberships(restaurant_id,user_id,role)
 values(pg_temp.v_r(),pg_temp.v_uid(),'viewer');
insert into public.restaurant_membership_locations(restaurant_id,user_id,location_id)
 values(pg_temp.v_r(),pg_temp.v_uid(),pg_temp.v_l());
create temporary table v_order as
 select (private.submit_public_guest_pickup_order(
 'storefront-restaurant-a','storefront-a-mitte','f4000000-0000-0000-0000-000000000001',
 'f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+interval '2 hours',
 '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2}]',
 'a3-viewer-order-001','{"contact_name":"A3 Private Guest","phone_e164":"+999100000021","email":"private@example.invalid"}',
 'preview-v1',30)->>'orderId')::uuid id;
create function pg_temp.v_detail(n int default 21,aal text default 'aal1') returns jsonb language sql as $$
 select private.read_dashboard_order(pg_temp.v_uid(n),aal,pg_temp.v_r(),pg_temp.v_l(),(select id from v_order)) $$;
create function pg_temp.v_list(aal text default 'aal1') returns jsonb language sql as $$
 select private.read_dashboard_orders(pg_temp.v_uid(),aal,pg_temp.v_r(),pg_temp.v_l(),null,null,null,25) $$;
create function pg_temp.v_pc(action text,extra jsonb,actor int default 1) returns jsonb language sql as $$
 select private.command_personnel(pg_temp.v_uid(actor),'aal2',jsonb_build_object(
 'action',action,'restaurantId',pg_temp.v_r(),'requestId',gen_random_uuid(),
 'expectedRevision',(select revision from private.personnel_revisions where restaurant_id=pg_temp.v_r()),
 'reason','Synthetic A3 authorization review')||extra) $$;

select is(pg_temp.v_list()->>'outcome','allowed','assigned Viewer reads with verified aal1');
select is(pg_temp.v_list('aal2')->>'outcome','allowed','Viewer also reads with aal2');
select is(pg_temp.v_list('invalid')->>'outcome','forbidden','unknown AAL fails closed');
select is(pg_temp.v_list(null)->>'outcome','forbidden','missing AAL fails closed');
select is(pg_temp.v_list()->'data'->'orders'->0->'allowedTransitions','[]'::jsonb,'list grants no transitions');
select is(pg_temp.v_list()->'data'->'orders'->0->'paymentState','null'::jsonb,'list hides online payment state');
select is(pg_temp.v_detail()->>'outcome','allowed','Viewer reads minimised detail');
select is(pg_temp.v_detail()->'data'->'contactName','null'::jsonb,'contact name is null');
select is(pg_temp.v_detail()->'data'->'delivery','null'::jsonb,'delivery recipient/address/phone are null');
select is(pg_temp.v_detail()->'data'->'paymentState','null'::jsonb,'detail hides payment state');
select is(pg_temp.v_detail()->'data'->'allowedTransitions','[]'::jsonb,'detail grants no transitions');
select ok(not (pg_temp.v_detail()->'data' ? 'communication'),'no communication/revision data');
select ok(pg_temp.v_detail()->'data' ? 'taxSummary','immutable order tax summary remains readable');
select is(pg_temp.v_detail()->'data'->'lines'->0->>'displayName','Gemüsecurry','Viewer reads immutable article snapshot');
select ok(pg_temp.v_detail()->'data'->'lines'->0 ? 'selectionSnapshot','bounded selection snapshot retained');
select ok(pg_temp.v_detail()::text !~ 'Private Guest|private@example.invalid|999100000021|phone|email|provider','no private customer/provider values in projection');
select is(private.dashboard_order_actor_role(pg_temp.v_r(),pg_temp.v_l(),pg_temp.v_uid(),'aal2'),null::text,'Viewer is never a write actor');
select is(private.dashboard_order_reader_role(pg_temp.v_r(),pg_temp.v_l(),pg_temp.v_uid(),'aal1'),'viewer','explicit reader capability');
select is(private.dashboard_order_reader_role(pg_temp.v_r(),'f3000000-0000-0000-0000-000000000021',pg_temp.v_uid(),'aal2'),null::text,'other own-tenant site denied');
select is(private.dashboard_order_reader_role('f2000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000002',pg_temp.v_uid(),'aal2'),null::text,'foreign tenant denied');
select is(private.dashboard_order_reader_role(pg_temp.v_r(),'f3000000-0000-0000-0000-000000000002',pg_temp.v_uid(),'aal2'),null::text,'mismatched tenant/site denied');
select is(private.read_dashboard_order(pg_temp.v_uid(),'aal1',pg_temp.v_r(),pg_temp.v_l(),gen_random_uuid())->>'outcome','not_found','unknown scoped order is not found');
select is(private.read_dashboard_fulfillment_orders(pg_temp.v_uid(),'aal1',pg_temp.v_r(),pg_temp.v_l(),null,null,null,25,'pickup')->>'outcome','allowed','fulfillment list read permitted');
select is(private.read_dashboard_orders_by_number(pg_temp.v_uid(),'aal1',pg_temp.v_r(),pg_temp.v_l(),null,null,null,25,null,(select order_number from public.orders where id=(select id from v_order)))->'data'->'orders'->0->'allowedTransitions','[]'::jsonb,'exact number search remains read only');
select is(private.read_dashboard_orders(pg_temp.v_uid(),'aal1',pg_temp.v_r(),pg_temp.v_l(),null,null,null,51)->>'outcome','invalid','bounded pagination enforced');
select is(private.read_dashboard_access_context(pg_temp.v_uid(),'aal1')->'memberships'->0->>'access','allowed','access context accepts Viewer at aal1');
select is(jsonb_array_length(private.read_dashboard_access_context(pg_temp.v_uid(),'aal1')->'memberships'->0->'locations'),1,'context exposes only granted site');
select is(private.read_dashboard_acceptance(pg_temp.v_uid(),'aal1',pg_temp.v_r(),pg_temp.v_l())->>'outcome','allowed','PII-free acceptance snapshot is readable');

-- Every state, including unknown role/null, must fail closed for Viewer.
select is(private.dashboard_order_allowed_transitions(status,'viewer'),'[]'::jsonb,'Viewer has no transition from '||status)
 from unnest(array['submitted','accepted','preparing','ready','completed','rejected','cancelled']) status;
select is(private.dashboard_order_allowed_transitions('submitted','superadmin'),'[]'::jsonb,'unknown role has no transition');
select is(private.dashboard_order_allowed_transitions('submitted',null),'[]'::jsonb,'null role has no transition');
create temporary table v_before as select status,updated_at from public.orders where id=(select id from v_order);
select is(private.transition_dashboard_order_with_reason(pg_temp.v_uid(),'aal2',pg_temp.v_r(),pg_temp.v_l(),(select id from v_order),'submitted',target,null)->>'outcome','forbidden','Viewer direct status command denied: '||target)
 from unnest(array['accepted','preparing','ready','completed','rejected','cancelled']) target;
select is(private.update_order_communication(pg_temp.v_uid(),'aal2',pg_temp.v_r(),pg_temp.v_l(),(select id from v_order),'submitted',0,'confirm_time',now()+interval '3 hours')->>'outcome','forbidden','Viewer cannot change confirmed time');
select is(private.retry_online_refund(pg_temp.v_uid(),'aal2',pg_temp.v_r(),pg_temp.v_l(),(select id from v_order))->>'outcome','forbidden','Viewer cannot request refund');
select is(private.read_personnel(pg_temp.v_uid(),'aal2',jsonb_build_object('action','read','restaurantId',pg_temp.v_r()))->>'outcome','forbidden','personnel management denied');
select is(pg_temp.v_pc('member',jsonb_build_object('userId',pg_temp.v_uid(),'role','owner','status','active','locationIds','[]'::jsonb),21)->>'outcome','forbidden','Viewer cannot self-elevate');
select is(private.menu_dashboard(pg_temp.v_uid(),'aal2',pg_temp.v_r(),pg_temp.v_l(),null)->>'outcome','forbidden','menu administration denied');
select is(private.location_operations_dashboard(pg_temp.v_uid(),'aal2',pg_temp.v_r(),pg_temp.v_l(),null)->>'outcome','forbidden','configuration/operations denied');
select is(private.read_order_history(pg_temp.v_uid(),'aal2',pg_temp.v_r(),pg_temp.v_l(),'{"action":"history"}')->>'outcome','forbidden','history and metrics role gate remains denied');
select is(private.read_provide_administration(pg_temp.v_uid(),'aal2',jsonb_build_object('action','read','restaurantId',pg_temp.v_r()))->>'outcome','forbidden','no PROVIDE platform grant inherited');
select ok((select (o.status,o.updated_at)=(b.status,b.updated_at) from public.orders o cross join v_before b where o.id=(select id from v_order)),'denied commands leave order unchanged');

-- Owner administration uses existing revision/audit/invitation contracts, not a new bypass.
select ok(private.personnel_scope_allowed(pg_temp.v_r(),pg_temp.v_uid(1),'viewer',array[pg_temp.v_l()]),'owner may administer explicit Viewer scope');
select ok(not private.personnel_scope_allowed(pg_temp.v_r(),pg_temp.v_uid(2),'viewer',array[pg_temp.v_l()]),'manager does not inherit Viewer administration');
select is(pg_temp.v_pc('invite',jsonb_build_object('email','a3-invited-viewer@example.invalid','role','viewer','locationIds',jsonb_build_array(pg_temp.v_l())),2)->>'outcome','forbidden','manager cannot reserve Viewer invitation');
create temporary table v_dispatch as select gen_random_uuid() id;
select is(pg_temp.v_pc('invite',jsonb_build_object('email','a3-invited-viewer@example.invalid','role','viewer','locationIds',jsonb_build_array(pg_temp.v_l()),'requestId',(select id from v_dispatch)))->>'outcome','allowed','owner reserves Viewer invitation');
select ok(private.claim_personnel_dispatch(pg_temp.v_uid(1),'aal2',pg_temp.v_r(),(select id from v_dispatch)) is not null,'existing dispatch workflow claims Viewer invitation');
select is(private.finish_personnel_dispatch(pg_temp.v_uid(1),'aal2',pg_temp.v_r(),(select id from v_dispatch),'sent')->>'outcome','allowed','Viewer invitation finalized after simulated dispatch');
select is(private.accept_personnel(pg_temp.v_uid(22),'aal1',(select id from public.restaurant_invitations where invited_user_id=pg_temp.v_uid(22)))->>'outcome','allowed','Viewer recipient consciously accepts at aal1');
select is(private.dashboard_order_reader_role(pg_temp.v_r(),pg_temp.v_l(),pg_temp.v_uid(22),'aal1'),'viewer','accepted Viewer receives only explicit reader role');
select is(private.dashboard_order_actor_role(pg_temp.v_r(),pg_temp.v_l(),pg_temp.v_uid(22),'aal1'),null::text,'accepted Viewer still cannot write');
select is(pg_temp.v_pc('member',jsonb_build_object('userId',pg_temp.v_uid(),'role','viewer','status','suspended','locationIds',jsonb_build_array(pg_temp.v_l())))->>'outcome','allowed','owner suspends Viewer through audited command');
select is(pg_temp.v_list()->>'outcome','forbidden','existing token loses read access immediately');
select is(private.read_dashboard_access_context(pg_temp.v_uid(),'aal1')->'memberships'->0->>'access','suspended','suspension hides context profiles');
select is(jsonb_array_length(private.read_dashboard_access_context(pg_temp.v_uid(),'aal1')->'memberships'->0->'locations'),0,'suspended Viewer has no context sites');
select is(pg_temp.v_pc('member',jsonb_build_object('userId',pg_temp.v_uid(),'role','viewer','status','active','locationIds',jsonb_build_array(pg_temp.v_l())))->>'outcome','allowed','owner reactivates Viewer through audited command');
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.v_uid();
select is(pg_temp.v_list()->>'outcome','forbidden','banned user cannot retain Viewer reads');
update auth.users set banned_until=null where id=pg_temp.v_uid();

select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_uid(),'aal','aal1','role','authenticated')::text,true);
select ok(private.dashboard_order_topic_allowed('orders:v1:'||pg_temp.v_r()||':'||pg_temp.v_l()),'Viewer private Broadcast join is scoped read-only');
select ok(not private.dashboard_order_topic_allowed('orders:v1:'||pg_temp.v_r()||':f3000000-0000-0000-0000-000000000021'),'unassigned Broadcast topic denied');
select ok(not private.dashboard_order_topic_allowed('orders:v1:f2000000-0000-0000-0000-000000000002:f3000000-0000-0000-0000-000000000002'),'foreign Broadcast topic denied');
select ok(not private.dashboard_order_topic_allowed('orders:v1:malformed'),'malformed topic denied');
set local role authenticated;
select is((select count(*) from public.orders),0::bigint,'raw order table remains denied under Viewer RLS');
select is((select count(*) from public.order_lines),0::bigint,'raw lines remain denied under Viewer RLS');
select is((select count(*) from public.order_customer_contacts),0::bigint,'raw customer contacts remain denied under Viewer RLS');
select is((select count(*) from public.order_delivery_details),0::bigint,'raw delivery details remain denied under Viewer RLS');
select throws_ok($$insert into realtime.messages(topic,extension,event,payload,private) values('orders:v1:f2000000-0000-0000-0000-000000000001:f3000000-0000-0000-0000-000000000001','broadcast','orders.invalidated.v1','{}',true)$$,'42501',null,'Viewer cannot forge Broadcast events');
reset role;
select ok(not has_function_privilege('authenticated','private.dashboard_order_reader_role(uuid,uuid,uuid,text)','execute'),'browser cannot spoof explicit reader identity');
select ok(not has_function_privilege('service_role','private.read_dashboard_order_before_viewer(uuid,text,uuid,uuid,uuid)','execute'),'server cannot bypass new reader boundary');
select throws_ok($$insert into public.restaurant_memberships(restaurant_id,user_id,role) values('f2000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000021','superadmin')$$,'23514',null,'unknown roles remain rejected');
select throws_ok($$insert into public.restaurant_membership_locations(restaurant_id,user_id,location_id) values('f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000021','f3000000-0000-0000-0000-000000000002')$$,'23503',null,'cross-tenant Viewer assignment rejected by composite FK');
delete from public.restaurant_membership_locations where user_id=pg_temp.v_uid();
select is(pg_temp.v_list()->>'outcome','forbidden','removed site assignment revokes reads with same identity');
select ok(not private.dashboard_order_topic_allowed('orders:v1:'||pg_temp.v_r()||':'||pg_temp.v_l()),'removed assignment denies next Broadcast authorization');
select * from finish();
rollback;
