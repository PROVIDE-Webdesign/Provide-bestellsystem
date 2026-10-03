-- A3: disposable fixtures only; no remote project or provider. All changes roll back.
begin;

-- Disposable pgTAP fixture only: materialize a provider-shaped session for old role/scope tests.
-- New A4 tests deliberately omit/revoke these rows to exercise the strict product gate.
create function pg_temp.fixture_claims(value text, local_only boolean) returns text
language plpgsql security definer set search_path='' as $$
declare c jsonb := value::jsonb; u uuid; a text; sid uuid;
begin
  u := coalesce(c->>'sub',nullif(current_setting('request.jwt.claim.sub',true),''))::uuid;
  a := coalesce(c->>'aal','aal1');
  if u is not null and exists(select 1 from auth.users where id=u) and a in ('aal1','aal2') then
    sid := case when a='aal2' then u else md5(u::text||'aal1')::uuid end;
    if a='aal2' then
      insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
      values(u,u,'Synthetic test only','totp','verified','SYNTHETICTEST',now(),now()) on conflict(id) do nothing;
    end if;
    insert into auth.sessions(id,user_id,created_at,updated_at,aal,factor_id)
    values(sid,u,clock_timestamp(),clock_timestamp(),a::auth.aal_level,case when a='aal2' then u else null end)
    on conflict(id) do nothing;
    c := c || jsonb_build_object('session_id',sid);
  end if;
  return set_config('request.jwt.claims',c::text,local_only);
end $$;


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

-- Positive fixtures prove actual private delivery/payment data exists but Viewer never sees it.
\ir fixtures/delivery.fixture.inc
create temporary table v_policy as select private.create_delivery_policy(pg_temp.v_uid(1),'aal2',pg_temp.v_r(),pg_temp.v_l(),
 '[{"postalCodes":["52062"],"minimumAmountMinor":2500,"feeAmountMinor":350}]') id;
select private.publish_delivery_policy(pg_temp.v_uid(1),'aal2',pg_temp.v_r(),pg_temp.v_l(),(select id from v_policy));
create temporary table v_quote as select private.quote_public_delivery_order('storefront-restaurant-a','storefront-a-mitte',
 'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+interval '3 hours',
 '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2}]','52062') data;
create temporary table v_delivery as select (private.submit_public_guest_delivery_order('storefront-restaurant-a','storefront-a-mitte',
 'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+interval '3 hours',
 '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2}]','a3-viewer-delivery-001',
 '{"contact_name":"A3 Private Recipient","phone_e164":"+999100000022","email":"delivery-private@example.invalid"}',
 '{"address_line_1":"A3 Private Delivery Address","address_line_2":null,"postal_code":"52062","city":"Aachen","country_code":"DE"}',
 (select data from v_quote),'preview-v1',30)->>'orderId')::uuid id;
create temporary table v_delivery_detail as select private.read_dashboard_order(pg_temp.v_uid(),'aal1',pg_temp.v_r(),pg_temp.v_l(),(select id from v_delivery)) data;
select is(private.read_dashboard_order(pg_temp.v_uid(1),'aal2',pg_temp.v_r(),pg_temp.v_l(),(select id from v_delivery))->'data'->'delivery'->>'addressLine1','A3 Private Delivery Address','owner still receives the actual private delivery address');
select is((select data->'data'->>'fulfillmentType' from v_delivery_detail),'delivery','Viewer sees delivery type');
select is((select data->'data'->'delivery' from v_delivery_detail),'null'::jsonb,'actual delivery details hidden from Viewer');
select is((select data->'data'->'contactName' from v_delivery_detail),'null'::jsonb,'actual delivery recipient hidden');
select ok((select data::text !~ 'Private Recipient|Private Delivery Address|delivery-private|999100000022|postalCode|phone' from v_delivery_detail),'actual address/email/phone never returned to Viewer');
select is((select (data->'data'->>'deliveryFeeAmountMinor')::integer from v_delivery_detail),350,'immutable delivery fee is readable');
insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled) values(pg_temp.v_r(),'payment.online',true);
create temporary table v_online as select (private.submit_public_guest_online_order('storefront-restaurant-a','storefront-a-mitte',
 'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+interval '6 hours',
 '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2}]','a3-viewer-online-001',
 '{"contact_name":"A3 Private Online Guest","phone_e164":"+999100000023","email":"online-private@example.invalid"}',
 'pickup',null,null,'preview-v1',30,'acct_a3synthetic')->>'orderId')::uuid id;
select is(private.read_dashboard_order(pg_temp.v_uid(1),'aal2',pg_temp.v_r(),pg_temp.v_l(),(select id from v_online))->'data'->>'paymentState','open','owner still receives actual payment state');
select is(private.read_dashboard_order(pg_temp.v_uid(),'aal1',pg_temp.v_r(),pg_temp.v_l(),(select id from v_online))->'data'->'paymentState','null'::jsonb,'Viewer never receives actual online payment state');
select is(private.read_dashboard_order(pg_temp.v_uid(),'aal1',pg_temp.v_r(),pg_temp.v_l(),(select id from v_online))->'data'->'allowedTransitions','[]'::jsonb,'unpaid online order grants Viewer no cancellation');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.v_list()->'data'->'orders') x where x->'allowedTransitions'<>'[]'::jsonb or x->'paymentState'<>'null'::jsonb),'all pickup/delivery/online summaries remain read-only and payment-minimised');
select ok(private.read_dashboard_order(pg_temp.v_uid(),'aal1',pg_temp.v_r(),pg_temp.v_l(),(select id from v_online))::text !~ 'Private Online|online-private|acct_a3|provider|phone|999100000023','actual online customer/provider values excluded');


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
select is(private.read_dashboard_access_context(pg_temp.v_uid(),'aal1'),' {"aal":"aal1","memberships":[]}'::jsonb,'R20-01 banned Viewer has no allowed context or profiles at aal1');
select is(private.read_dashboard_access_context(pg_temp.v_uid(),'aal2'),' {"aal":"aal2","memberships":[]}'::jsonb,'R20-01 banned Viewer has no allowed context or profiles at aal2');
select is((select status from public.restaurant_memberships where restaurant_id=pg_temp.v_r() and user_id=pg_temp.v_uid()),'active','Auth ban does not mutate membership status');
select is((select count(*)::integer from public.restaurant_membership_locations where restaurant_id=pg_temp.v_r() and user_id=pg_temp.v_uid()),1,'Auth ban retains explicit site assignment');
update auth.users set banned_until=now()+interval '1 day' where id in (pg_temp.v_uid(1),pg_temp.v_uid(2));
select is(private.read_dashboard_access_context(pg_temp.v_uid(1),'aal2')->'memberships','[]'::jsonb,'banned Owner has no context despite aal2');
select is(private.read_dashboard_access_context(pg_temp.v_uid(2),'aal2')->'memberships','[]'::jsonb,'banned Manager has no context despite aal2');
update auth.users set banned_until=null where id in (pg_temp.v_uid(1),pg_temp.v_uid(2));
select is(private.read_dashboard_access_context(pg_temp.v_uid(1),'aal1')->'memberships'->0->>'access','mfa_required','Owner MFA requirement remains after ban removal');
select is(private.read_dashboard_access_context(pg_temp.v_uid(2),'aal1')->'memberships'->0->>'access','mfa_required','Manager MFA requirement remains after ban removal');
select is(private.read_dashboard_access_context(pg_temp.v_uid(1),'aal2')->'memberships'->0->>'access','allowed','Owner aal2 remains allowed after ban removal');
select is(private.read_dashboard_access_context(pg_temp.v_uid(2),'aal2')->'memberships'->0->>'access','allowed','Manager aal2 remains allowed after ban removal');
update auth.users set banned_until=null where id=pg_temp.v_uid();
select is(private.read_dashboard_access_context(pg_temp.v_uid(),'aal1')->'memberships'->0->>'access','allowed','unbanned Viewer regains context with the same identity');
select is(jsonb_array_length(private.read_dashboard_access_context(pg_temp.v_uid(),'aal1')->'memberships'->0->'locations'),1,'unbanned Viewer regains only assigned site');
select is(pg_temp.v_list()->>'outcome','allowed','unbanned Viewer regains bounded order reads');
update auth.users set banned_until=now()-interval '1 second' where id=pg_temp.v_uid();
select is(private.read_dashboard_access_context(pg_temp.v_uid(),'aal1')->'memberships'->0->>'access','allowed','expired Auth ban does not block Viewer context');
update auth.users set banned_until=null where id=pg_temp.v_uid();

select pg_temp.fixture_claims(jsonb_build_object('sub',pg_temp.v_uid(),'aal','aal1','role','authenticated')::text,true);
select is(private.read_dashboard_access_context('f1000000-0000-0000-0000-000000000099','aal1')->'memberships','[]'::jsonb,'missing Auth identity yields no context profiles');
select ok(has_function_privilege('service_role','private.read_dashboard_access_context(uuid,text)','execute'),'access context retains existing server execute permission');
select ok(not has_function_privilege('authenticated','private.read_dashboard_access_context(uuid,text)','execute'),'access context does not grant browser execute permission');
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
