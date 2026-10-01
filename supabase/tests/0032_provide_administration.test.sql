begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc
insert into auth.users(id,email) values ('f1000000-0000-0000-0000-000000000007','provide-admin@example.invalid');
insert into private.provide_admin_grants(user_id,restaurant_id) values
('f1000000-0000-0000-0000-000000000007','f2000000-0000-0000-0000-000000000001');
insert into private.provide_admin_grants(user_id,restaurant_id,location_id) values
('f1000000-0000-0000-0000-000000000006','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001');
create function pg_temp.admin(q jsonb,l uuid default null) returns jsonb language sql as $$
 select private.command_provide_administration('f1000000-0000-0000-0000-000000000007','aal2',
 jsonb_build_object('restaurantId','f2000000-0000-0000-0000-000000000001','locationId',l,
 'requestId',gen_random_uuid(),'reason','Synthetic administration review',
 'expectedRevision',(select revision from private.provide_admin_revisions where restaurant_id='f2000000-0000-0000-0000-000000000001'))||q,false);
$$;
select is(private.read_provide_administration('f1000000-0000-0000-0000-000000000001','aal2','{}')->>'outcome','forbidden','restaurant owner is not a PROVIDE administrator');
select is(private.read_provide_administration('f1000000-0000-0000-0000-000000000007','aal1','{}')->>'outcome','forbidden','PROVIDE grant still requires MFA');
select is(private.read_provide_administration('f1000000-0000-0000-0000-000000000007','aal2','{"restaurantId":"f2000000-0000-0000-0000-000000000002"}')->>'outcome','forbidden','tenant grant cannot cross tenant boundary');
select is(jsonb_array_length(private.read_provide_administration('f1000000-0000-0000-0000-000000000007','aal2','{}')->'data'->'restaurants'),1,'list contains only granted restaurant');
select is(private.read_provide_administration('f1000000-0000-0000-0000-000000000006','aal2','{"restaurantId":"f2000000-0000-0000-0000-000000000001"}')->'data'->'selected'->>'canManageRestaurant','false','site grant cannot manage restaurant');
select is(private.read_provide_administration('f1000000-0000-0000-0000-000000000006','aal2','{"restaurantId":"f2000000-0000-0000-0000-000000000001"}')->'data'->'selected'->'configuration','null'::jsonb,'site grant does not expose critical configuration');
select is(jsonb_array_length(private.read_provide_administration('f1000000-0000-0000-0000-000000000006','aal2','{"restaurantId":"f2000000-0000-0000-0000-000000000001"}')->'data'->'selected'->'checks'),0,'site grant does not expose parent checks');
select is(pg_temp.admin('{"action":"feature","featureKey":"unknown.feature","mode":"disabled","expiresAt":null}')->>'outcome','invalid','unregistered feature rejected');
select is(pg_temp.admin('{"action":"feature","featureKey":"ordering.accept_orders","mode":"enabled","expiresAt":null}')->>'outcome','invalid','enable requires expiry');
select is(pg_temp.admin(jsonb_build_object('action','feature','featureKey','ordering.accept_orders','mode','enabled','expiresAt',now()+interval '31 days'))->>'outcome','invalid','expiry cannot exceed thirty days');
select is(pg_temp.admin('{"action":"feature","featureKey":"ordering.accept_orders","mode":"disabled","expiresAt":null,"expectedRevision":-1}')->>'outcome','conflict','stale revision rejected');
select is(pg_temp.admin('{"action":"feature","featureKey":"catalog.public_menu","mode":"disabled","expiresAt":null}', 'f3000000-0000-0000-0000-000000000002')->>'outcome','forbidden','foreign site rejected');
create temporary table retry(command jsonb);
insert into retry select jsonb_build_object('action','feature','restaurantId','f2000000-0000-0000-0000-000000000001','locationId','f3000000-0000-0000-0000-000000000001',
 'requestId',gen_random_uuid(),'reason','Synthetic site kill switch','expectedRevision',(select revision from private.provide_admin_revisions where restaurant_id='f2000000-0000-0000-0000-000000000001'),
 'featureKey','catalog.public_menu','mode','disabled','expiresAt',null);
select is(private.command_provide_administration('f1000000-0000-0000-0000-000000000007','aal2',(select command from retry),false)->>'outcome','allowed','site feature change accepted');
select ok(not private.is_location_feature_enabled('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','catalog.public_menu'),'site disable effective immediately');
select ok(private.is_restaurant_feature_enabled('f2000000-0000-0000-0000-000000000001','catalog.public_menu'),'site disable preserves parent feature');
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte'),null::jsonb,'real public catalog consumes site guard');
create temporary table counts as select (select count(*) from private.provide_admin_audit) a,(select count(*) from public.outbox_events) o,(select revision from private.provide_admin_revisions where restaurant_id='f2000000-0000-0000-0000-000000000001') r;
select is(private.command_provide_administration('f1000000-0000-0000-0000-000000000007','aal2',(select command from retry),false)->>'outcome','allowed','identical retry accepted before stale revision check');
select is((select count(*) from private.provide_admin_audit),(select a from counts),'retry adds no audit rows');
select is((select count(*) from public.outbox_events),(select o from counts),'retry adds no outbox rows');
select is((select revision from private.provide_admin_revisions where restaurant_id='f2000000-0000-0000-0000-000000000001'),(select r from counts),'retry does not increment revision');
select is(private.command_provide_administration('f1000000-0000-0000-0000-000000000007','aal2',(select command||'{"mode":"enabled"}'::jsonb from retry),false)->>'outcome','conflict','same receipt cannot be reused for another command');
select ok(exists(select 1 from private.provide_admin_audit where action='location_feature_flags.insert' and actor_user_id='f1000000-0000-0000-0000-000000000007' and before_state is null and after_state->>'enabled'='false' and reason='Synthetic site kill switch'),'native before/after audit retains verified actor and reason');
update private.provide_admin_grants set active=false where user_id='f1000000-0000-0000-0000-000000000007';
select is(private.command_provide_administration('f1000000-0000-0000-0000-000000000007','aal2',(select command from retry),false)->>'outcome','forbidden','revocation blocks existing receipt retry');
update private.provide_admin_grants set active=true where user_id='f1000000-0000-0000-0000-000000000007';
select is(pg_temp.admin('{"action":"feature","featureKey":"catalog.public_menu","mode":"inherit","expiresAt":null}','f3000000-0000-0000-0000-000000000001')->>'outcome','allowed','inherit removes override');
select ok(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte') is not null,'inherit restores parent catalog');
select is(pg_temp.admin(jsonb_build_object('action','feature','featureKey','catalog.public_menu','mode','enabled','expiresAt',now()+interval '1 hour'),'f3000000-0000-0000-0000-000000000001')->>'outcome','allowed','time-limited site enable accepted');
select is(pg_temp.admin('{"action":"feature","featureKey":"catalog.public_menu","mode":"disabled","expiresAt":null}')->>'outcome','allowed','restaurant kill switch accepted');
select ok(not private.is_location_feature_enabled('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','catalog.public_menu'),'site enable cannot bypass restaurant kill switch');
select is(pg_temp.admin(jsonb_build_object('action','feature','featureKey','catalog.public_menu','mode','enabled','expiresAt',now()+interval '1 hour'))->>'outcome','allowed','time-limited parent enable accepted');
update private.location_feature_flags set enabled=false,expires_at=now()-interval '1 second';
select ok(private.is_location_feature_enabled('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','catalog.public_menu'),'expired site override returns to parent');
update public.restaurant_feature_flags set expires_at=now()-interval '1 second' where feature_key='catalog.public_menu';
select ok(not private.is_location_feature_enabled('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','catalog.public_menu'),'expired parent enable returns to safe default');
select ok(not private.is_location_feature_enabled('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002','catalog.public_menu'),'unknown or foreign location fails closed');
select is(pg_temp.admin('{"action":"goLive","status":"live","confirmation":"storefront-restaurant-a"}')->>'outcome','forbidden','live activation is blocked at database boundary');
select is(pg_temp.admin('{"action":"critical","configuration":{"merchantRole":"restaurant","payoutAccountReference":"fixture:payout-a","productionDomain":"a.example.invalid","dataRegion":"eu-central-1","responsibleUserId":"f1000000-0000-0000-0000-000000000007"}}')->>'outcome','allowed','critical declaration update accepted');
select is((select go_live_status from public.restaurant_activation_states where restaurant_id='f2000000-0000-0000-0000-000000000001'),'blocked','critical declaration blocks restaurant');
select is((select go_live_status from public.location_activation_states where restaurant_id='f2000000-0000-0000-0000-000000000001'),'blocked','critical declaration blocks child site');
select is((select count(*)::integer from public.onboarding_check_results where restaurant_id='f2000000-0000-0000-0000-000000000001' and status='pending' and evidence_reference is null),21,'all twenty-one required checks reopened with evidence cleared');
select is(pg_temp.admin('{"action":"onboarding","status":"ready_for_review"}')->>'outcome','conflict','incomplete evidence blocks review');
select is(pg_temp.admin('{"action":"check","checkKey":"restaurant.owner","status":"passed","evidenceKind":"test","evidenceReference":"fixture:owner"}')->>'outcome','allowed','structured owner check accepted');
select is(pg_temp.admin('{"action":"check","checkKey":"location.address","status":"passed","evidenceKind":"test","evidenceReference":"fixture:address"}')->>'outcome','invalid','check cannot cross scope');
do $$ declare k text;result jsonb;begin
 for k in select check_key from public.onboarding_check_results where restaurant_id='f2000000-0000-0000-0000-000000000001' and location_id is null loop
  result:=pg_temp.admin(jsonb_build_object('action','check','checkKey',k,'status','passed','evidenceKind','test','evidenceReference','fixture:review'));
  if result->>'outcome'<>'allowed' then raise exception 'check % failed: %',k,result;end if;
 end loop;end;$$;
select is(pg_temp.admin('{"action":"onboarding","status":"ready_for_review"}')->>'outcome','allowed','complete structured checks permit review');
select is(pg_temp.admin('{"action":"onboarding","status":"approved"}')->>'outcome','allowed','complete critical configuration permits approval');
select is(pg_temp.admin('{"action":"check","checkKey":"restaurant.owner","status":"failed","evidenceKind":null,"evidenceReference":null}')->>'outcome','conflict','approved checks cannot be changed without reopening');
select is(pg_temp.admin('{"action":"reopen","checkKeys":["restaurant.owner"]}')->>'outcome','allowed','explicit recheck accepted');
select is((select status from public.onboarding_check_results where restaurant_id='f2000000-0000-0000-0000-000000000001' and check_key='restaurant.owner'),'pending','selected check reopened');
select is((select status from public.onboarding_check_results where restaurant_id='f2000000-0000-0000-0000-000000000001' and check_key='restaurant.privacy'),'passed','unselected check evidence preserved');
select ok(not has_function_privilege('service_role','private.transition_restaurant_go_live(uuid,text,uuid,text)','execute'),'legacy service RPC cannot bypass audited command');
select ok(not has_table_privilege('authenticated','private.provide_admin_grants','insert,update,delete'),'browser cannot self-grant PROVIDE authority');
select ok(not has_table_privilege('service_role','private.provide_admin_audit','update,delete'),'service role cannot rewrite audit');
select ok(not has_table_privilege('service_role','public.onboarding_check_results','insert,update,delete'),'service table API cannot forge evidence');
select ok(not has_table_privilege('service_role','public.restaurant_activation_states','insert,update,delete'),'service table API cannot bypass live gate');
select ok(not has_function_privilege('anon','private.command_provide_administration(uuid,text,jsonb,boolean)','execute'),'anonymous caller cannot execute administration');
select throws_ok($$delete from private.provide_admin_audit$$,'23514','order records are append-only','audit entries are immutable even for table owner');
select is(pg_temp.admin('{"action":"profileStatus","status":"suspended"}')->>'outcome','allowed','restaurant suspension is an audited command');
select is((select status from public.restaurants where id='f2000000-0000-0000-0000-000000000001'),'suspended','suspension updates only the selected profile');
select is(pg_temp.admin('{"action":"createLocation","displayName":"Neue Testküche","slug":"new-test-site","timezone":"Europe/Berlin"}','f3000000-0000-0000-0000-000000000003')->>'outcome','allowed','restaurant grant may create a setup location');
select is((select status from public.locations where id='f3000000-0000-0000-0000-000000000003'),'setup','created location remains in setup');
select is((select count(*)::integer from public.onboarding_check_results where location_id='f3000000-0000-0000-0000-000000000003' and status='pending'),12,'created location starts with all twelve checks pending');
select is(pg_temp.admin('{"action":"createRestaurant","restaurantId":"f2000000-0000-0000-0000-000000000003","expectedRevision":0,"displayName":"Neue Testküche","slug":"new-test-restaurant","timezone":"Europe/Berlin"}')->>'outcome','forbidden','tenant grant cannot create another tenant');
insert into private.provide_admin_grants(user_id) values ('f1000000-0000-0000-0000-000000000007');
select is(pg_temp.admin('{"action":"createRestaurant","restaurantId":"f2000000-0000-0000-0000-000000000003","expectedRevision":0,"displayName":"Neue Testküche","slug":"new-test-restaurant","timezone":"Europe/Berlin"}')->>'outcome','allowed','explicit global grant creates a setup tenant');
select is((select status from public.restaurants where id='f2000000-0000-0000-0000-000000000003'),'setup','new tenant is never automatically activated');
select is((select count(*)::integer from public.restaurant_memberships where restaurant_id='f2000000-0000-0000-0000-000000000003'),0,'global setup does not invent an owner membership');
select is((select count(*)::integer from public.onboarding_check_results where restaurant_id='f2000000-0000-0000-0000-000000000003' and status='pending'),9,'new tenant starts with nine required checks pending');
select * from finish();
rollback;
