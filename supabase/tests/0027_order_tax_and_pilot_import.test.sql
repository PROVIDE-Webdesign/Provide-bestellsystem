\set ON_ERROR_STOP on
begin;
select no_plan();
\ir fixtures/storefront.fixture.inc
\ir fixtures/menu-selection.fixture.inc
create function pg_temp.menu(command jsonb,actor uuid default 'f1000000-0000-0000-0000-000000000001',aal text default 'aal2') returns jsonb language sql as $$
 select private.menu_dashboard(actor,aal,'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-000000000001',command);
$$;
select jsonb_set(:'menu_configuration','{optionGroups,0,options,1,taxRateBasisPoints}','1900') as mixed_config \gset
select ok(private.valid_menu_configuration(:'mixed_config'),'explicit extra rate is valid');
select ok(not private.valid_menu_configuration(jsonb_set(:'mixed_config','{optionGroups,0,options,1,taxRateBasisPoints}','null')),'null extra rate rejected');
select ok(not private.valid_menu_configuration(jsonb_set(:'mixed_config','{optionGroups,0,options,1,taxRateBasisPoints}','10001')),'out of range extra rate rejected');
select jsonb_build_object('action','import_draft','menuId','f4000000-0000-0000-0000-000000000001','source',jsonb_build_object('name','synthetic.json','sha256',repeat('a',64)),
 'sections',jsonb_build_array(jsonb_build_object('key','dishes','name','Synthetic dishes')),
 'items',jsonb_build_array(jsonb_build_object('id','fc600000-0000-0000-0000-000000000001','sectionKey','dishes','name','Synthetic mixed curry','description',null,'priceAmountMinor',1250,'isActive',true,'configuration',:'mixed_config'::jsonb))) as import_command \gset
select is(pg_temp.menu(:'import_command',null)->>'outcome','forbidden','import requires actor');
select is(pg_temp.menu(:'import_command','f1000000-0000-0000-0000-000000000001','aal1')->>'outcome','forbidden','import requires MFA');
select is(pg_temp.menu(:'import_command','f1000000-0000-0000-0000-000000000005')->>'outcome','forbidden','foreign actor cannot import');
select is(pg_temp.menu(jsonb_set(:'import_command','{items,0,configuration}','null'))->>'outcome','invalid','missing declarations block active import');
select is(pg_temp.menu(:'import_command')->>'outcome','allowed','configured import creates scoped draft');
select pg_temp.menu(null)#>>'{data,menus,0,versions,0,id}' as draft \gset
select is((select status from public.menu_versions where id=:'draft'),'draft','import never publishes');
select is((select count(*) from public.outbox_events where event_type='menu.draft.imported' and payload->'source'->>'sha256'=repeat('a',64)),1::bigint,'source provenance audited');
select is(pg_temp.menu(jsonb_build_object('action','publish','menuId','f4000000-0000-0000-0000-000000000001','versionId',:'draft','expectedRevision',1,'effectiveAt',now(),'note','Synthetic')) ->>'outcome','allowed','imported draft passes publication separately');
select '[{"menu_item_id":"fc600000-0000-0000-0000-000000000001","quantity":1,"variant_id":"ea100000-0000-0000-0000-000000000002","option_ids":["ea300000-0000-0000-0000-000000000002"]}]'::jsonb as lines \gset
select private.price_menu_lines('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',:'draft',:'lines') as price \gset
select is(:'price'::jsonb#>>'{lines,0,selection_snapshot,taxAmountMinor}','103','mixed product and extra taxes sum per rate');
select is(:'price'::jsonb#>>'{lines,0,selection_snapshot,taxComponents,2,taxRateBasisPoints}','1900','extra declaration reaches immutable component');
select private.build_tax_summary(:'price'::jsonb->'lines',119,'{"mode":"fixed","taxRateBasisPoints":1900}') as fixed \gset
select is(:'fixed'::jsonb->>'totalAmountMinor','1619','gross components and delivery conserved');
select is(:'fixed'::jsonb->>'taxAmountMinor','122','declared fee included in tax sum');
select is(:'fixed'::jsonb->>'knownNetAmountMinor','1497','net plus tax equals gross');
select is(:'fixed'::jsonb->>'status','complete','all declarations complete');
select is(private.build_tax_summary(:'price'::jsonb->'lines',119,null)->>'undeclaredGrossAmountMinor','119','missing fee rule remains unknown');
select is(private.build_tax_summary('[{"line_amount_minor":200,"selection_snapshot":null}]',0,null)->>'status','partial','legacy tax is not inferred');
select private.build_tax_summary(:'price'::jsonb->'lines',101,'{"mode":"proportional"}') as proportional \gset
select is((select sum((value->>'grossAmountMinor')::bigint) from jsonb_array_elements(:'proportional'::jsonb->'buckets')),1601::numeric,'proportional rounding conserves all fee cents');
select private.submit_order('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',:'draft','pickup',date_trunc('hour',now())+interval '4 hours',:'lines','tax-pilot-synthetic-order-001') as order_id \gset
select is((select tax_summary->>'taxAmountMinor' from public.orders where id=:'order_id'),'103','order header stores full tax snapshot');
select throws_ok(format('update public.orders set tax_summary=null where id=%L',:'order_id'), 'P0001','order tax snapshot is immutable','tax header cannot be rewritten');
select is(private.submit_order('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',:'draft','pickup',date_trunc('hour',now())+interval '4 hours',:'lines','tax-pilot-synthetic-order-001'),:'order_id'::uuid,'exact retry preserves order and taxes');
select is(private.read_dashboard_order('f1000000-0000-0000-0000-000000000001','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',:'order_id')#>>'{data,taxSummary,taxAmountMinor}','103','authorized dashboard reads header taxes');
select ok(not has_table_privilege('authenticated','private.delivery_tax_declarations','SELECT'),'delivery tax table is not a browser endpoint');
select ok(not has_function_privilege('authenticated','private.menu_dashboard(uuid,text,uuid,uuid,jsonb)','EXECUTE'),'import endpoint remains backend only');
select * from finish();
rollback;
