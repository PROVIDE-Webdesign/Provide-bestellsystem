\set ON_ERROR_STOP on
begin;
select no_plan();
\ir fixtures/storefront.fixture.inc
\ir fixtures/menu-selection.fixture.inc
create function pg_temp.menu(command jsonb, actor uuid default 'f1000000-0000-0000-0000-000000000001', aal text default 'aal2') returns jsonb language sql as $$
 select private.menu_dashboard(actor,aal,'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',command);
$$;
select is(pg_temp.menu(null)->>'outcome','allowed','owner reads scoped editor');
select is(pg_temp.menu(null)#>>'{data,timezone}','Europe/Berlin','editor receives authoritative location timezone');
select is(pg_temp.menu(null,null)->>'outcome','forbidden','missing actor rejected');
select is(pg_temp.menu(null,'f1000000-0000-0000-0000-000000000001',null)->>'outcome','forbidden','null MFA rejected');
select is(pg_temp.menu(null,'f1000000-0000-0000-0000-000000000001','aal1')->>'outcome','forbidden','MFA required');
select is(pg_temp.menu(null,'f1000000-0000-0000-0000-000000000005')->>'outcome','forbidden','foreign owner rejected');
select is(pg_temp.menu(null,'f1000000-0000-0000-0000-000000000003')->>'outcome','forbidden','staff cannot edit');
select ok(not has_table_privilege('service_role','private.menu_choice_stops','insert'),'service cannot forge stop history directly');
select ok(not has_function_privilege('authenticated','private.menu_dashboard(uuid,text,uuid,uuid,jsonb)','execute'),'browser cannot forge SQL actor');
select pg_temp.menu('{"action":"create_draft","menuId":"f4000000-0000-0000-0000-000000000001","sourceVersionId":"f5000000-0000-0000-0000-000000000001"}') as created \gset
select :'created'::jsonb#>>'{data,menus,0,versions,0,id}' as draft_version \gset
select jsonb_build_object('action','save_draft','menuId','f4000000-0000-0000-0000-000000000001','versionId',:'draft_version','expectedRevision',0,'sections',jsonb_build_array(jsonb_build_object('key','gerichte','name','Updated dishes')),'items',jsonb_build_array(jsonb_build_object('id','f6000000-0000-0000-0000-000000000001','sectionKey','gerichte','name','Configured curry','description',null,'priceAmountMinor',1250,'isActive',true,'configuration',:'menu_configuration'::jsonb))) as save_command \gset
select is(pg_temp.menu(:'save_command')->>'outcome','allowed','structured complete draft saved');
select is((select edit_revision from public.menu_versions where id=:'draft_version'),1,'revision incremented');
select is(pg_temp.menu(:'save_command')->>'outcome','conflict','stale editor revision rejected');
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte')#>>'{menus,0,sections,0,items,0,name}','Gemüsecurry','draft remains invisible');
select jsonb_build_object('action','publish','menuId','f4000000-0000-0000-0000-000000000001','versionId',:'draft_version','expectedRevision',1,'effectiveAt',clock_timestamp(),'note','Synthetic publication') as publish_command \gset
select is(pg_temp.menu(:'publish_command')->>'outcome','allowed','complete draft published');
select is(pg_temp.menu(jsonb_set(:'save_command','{expectedRevision}','1'))->>'outcome','conflict','published version cannot be edited');
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte')#>>'{menus,0,sections,0,items,0,name}','Configured curry','published editor changes reach catalog');
select jsonb_build_object('action','stop','menuId','f4000000-0000-0000-0000-000000000001','versionId',:'draft_version','itemId','f6000000-0000-0000-0000-000000000001','choiceId','ea100000-0000-0000-0000-000000000002','blocked',true,'endsAt',clock_timestamp()+interval '1 hour','reason','Synthetic stop') as stop_command \gset
select is(pg_temp.menu(:'stop_command')->>'outcome','allowed','variant stop saved');
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte')#>>'{menus,0,sections,0,items,0,configuration,variants,1,isActive}','false','catalog hides stopped variant');
select '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1,"variant_id":"ea100000-0000-0000-0000-000000000002","option_ids":["ea300000-0000-0000-0000-000000000002"]}]'::jsonb as lines \gset
select is(private.quote_public_cart('storefront-restaurant-a','storefront-a-mitte','f4000000-0000-0000-0000-000000000001',:'draft_version','pickup',date_trunc('hour',now())+interval '3 hours',:'lines',null)->>'status','unavailable','quote rejects stopped variant');
select is(pg_temp.menu(jsonb_set(:'stop_command','{choiceId}','"ea100000-0000-0000-0000-000000000001"'))->>'outcome','allowed','last active variant can stop');
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte')#>>'{menus,0,sections,0,items,0,availability}','sold_out','unfulfillable required selection marks item unavailable without corrupting configuration');
select is(pg_temp.menu(jsonb_set(:'stop_command','{choiceId}','"eb100000-0000-0000-0000-000000000001"'))->>'outcome','invalid','foreign choice rejected');
select is(pg_temp.menu(jsonb_set(:'stop_command','{endsAt}',to_jsonb(clock_timestamp()-interval '1 hour')))->>'outcome','invalid','past expiry rejected');
select is(pg_temp.menu(jsonb_set(:'stop_command','{blocked}','false'))->>'outcome','allowed','variant can be released');
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte')#>>'{menus,0,sections,0,items,0,configuration,variants,1,isActive}','true','release immediately reaches catalog');
select pg_temp.menu(jsonb_set(jsonb_set(:'stop_command','{choiceId}','null'),'{endsAt}','null'));
select ok(private.menu_choice_blocked('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f6000000-0000-0000-0000-000000000001',null),'unlimited item stop blocks');
-- Insert an expired later event in the synthetic test transaction. The newest expired event supersedes older unlimited stops.
insert into private.menu_choice_stops(restaurant_id,location_id,menu_id,menu_item_id,choice_id,blocked,ends_at,reason,actor_user_id,created_at)
values('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f6000000-0000-0000-0000-000000000001',null,true,clock_timestamp()+interval '10 milliseconds','Synthetic automatic expiry','f1000000-0000-0000-0000-000000000001',clock_timestamp());
select pg_sleep(0.02);
select ok(not private.menu_choice_blocked('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f6000000-0000-0000-0000-000000000001',null),'expiry automatically restores without reactivating older stop');
select ok(not private.menu_choice_blocked('f2000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000002','f4000000-0000-0000-0000-000000000001','f6000000-0000-0000-0000-000000000001',null),'stop cannot affect foreign tenant');
select is(pg_temp.menu(null)#>>'{data,stops,0,reason}','Synthetic automatic expiry','editor shows latest stop reason and deadline');
select ok(exists(select 1 from public.outbox_events where event_type='menu.admin.changed'),'editor mutations produce audit events');
select * from finish();
rollback;
