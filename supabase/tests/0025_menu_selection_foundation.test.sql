\set ON_ERROR_STOP on
begin;
select no_plan();
\ir fixtures/storefront.fixture.inc
\ir fixtures/menu-selection.fixture.inc
select ok(not has_function_privilege('anon','private.quote_public_cart(text,text,uuid,uuid,text,timestamptz,jsonb,text)','execute'),'browser cannot invoke cart SQL');
select ok(not has_function_privilege('service_role','private.price_menu_lines(uuid,uuid,uuid,uuid,jsonb)','execute'),'internal pricer is not a service entry point');
select ok(not has_table_privilege('authenticated','public.menu_version_items','update'),'browser cannot change configurations');
select ok(private.valid_menu_configuration(:'menu_configuration'::jsonb),'complete configuration valid');
select ok(not private.valid_menu_configuration(:'menu_configuration'::jsonb||'{"informationConfirmed":false}'),'unconfirmed information rejected');
select ok(not private.valid_menu_configuration(:'menu_configuration'::jsonb||'{"taxRateBasisPoints":null}'),'missing tax rejected');
select ok(not private.valid_menu_configuration(:'menu_configuration'::jsonb||'{"taxRateBasisPoints":10001}'),'tax bound');
select ok(not private.valid_menu_configuration(:'menu_configuration'::jsonb||'{"extra":"bad"}'),'configuration allowlist');
select ok(not private.valid_menu_configuration(jsonb_set(:'menu_configuration'::jsonb,'{optionGroups,0,minSelections}','3')),'impossible minimum rejected');
select private.create_menu_draft('f2000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','aal2') as configured_version \gset
select throws_ok(format('select private.set_menu_item_configuration(%L,%L,%L,%L,%L,%L,0,%L)',
'f2000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',:'configured_version','f6000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','aal1',:'menu_configuration'),'P0001','menu administration requires aal2','MFA required');
select throws_ok(format('select private.set_menu_item_configuration(%L,%L,%L,%L,%L,null,0,%L)',
'f2000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',:'configured_version','f6000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001',:'menu_configuration'),'P0001','menu administration requires aal2','missing MFA claim rejected');
select throws_ok(format('select private.set_menu_item_configuration(%L,%L,%L,%L,%L,%L,0,%L)',
'f2000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',:'configured_version','f6000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000005','aal2',:'menu_configuration'),'P0001','menu actor must be an active owner or manager','foreign restaurant owner rejected');
select is(private.set_menu_item_configuration('f2000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',:'configured_version','f6000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','aal2',0,:'menu_configuration'),'updated','owner configures draft');
select is(private.set_menu_item_configuration('f2000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',:'configured_version','f6000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','aal2',0,:'menu_configuration'),'conflict','stale editing revision rejected');
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte')#>'{menus,0,sections,0,items,0,configuration}',null::jsonb,'draft configuration stays private');
select private.publish_menu_version('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',:'configured_version',statement_timestamp(),'f1000000-0000-0000-0000-000000000001','aal2');
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte')#>'{menus,0,sections,0,items,0,configuration}',:'menu_configuration'::jsonb,'published configuration public');
select throws_ok(format('update public.menu_version_items set configuration=null where menu_version_id=%L',:'configured_version'),'23514','published menu content is immutable','published configuration immutable');
select private.create_menu_draft('f2000000-0000-0000-0000-000000000001','f4000000-0000-0000-000000000001',:'configured_version','f1000000-0000-0000-0000-000000000001','aal2') as copied_version \gset
select is((select configuration from public.menu_version_items where menu_version_id=:'copied_version' and menu_item_id='f6000000-0000-0000-0000-000000000001'),:'menu_configuration'::jsonb,'draft copy retains selection information');
select set_config('test.configured_version',:'configured_version',true);
create function pg_temp.price(lines jsonb) returns jsonb language sql as $$ select private.price_menu_lines('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',current_setting('test.configured_version')::uuid,lines) $$;
select '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":2,"variant_id":"ea100000-0000-0000-0000-000000000002","option_ids":["ea300000-0000-0000-0000-000000000002"]}]'::jsonb as selection_lines \gset
select is(pg_temp.price(:'selection_lines')->>'subtotal','3000','base variant and extra multiplied by quantity');
select is(pg_temp.price(:'selection_lines')#>>'{lines,0,selection_snapshot,taxAmountMinor}','196','configured included tax rounded once per line');
select is(pg_temp.price(:'selection_lines')#>>'{lines,0,selection_snapshot,variant,name}','Large','variant name snapshotted');
select is(pg_temp.price(:'selection_lines')#>>'{lines,0,selection_snapshot,options,0,name}','Extra B','extra name snapshotted');
select throws_ok(format('select pg_temp.price(%L)',(:'selection_lines'::jsonb #- '{0,variant_id}')::text),'P0001','invalid menu selection','required variant');
select throws_ok(format('select pg_temp.price(%L)',(:'selection_lines'::jsonb #- '{0,option_ids}')::text),'P0001','invalid menu selection','group minimum');
select throws_ok(format('select pg_temp.price(%L)',jsonb_set(:'selection_lines','{0,variant_id}','"eb100000-0000-0000-0000-000000000002"')::text),'P0001','invalid menu selection','foreign choice rejected');
select throws_ok(format('select pg_temp.price(%L)',jsonb_set(:'selection_lines','{0,option_ids}','["ea300000-0000-0000-0000-000000000002","ea300000-0000-0000-0000-000000000002"]')::text),'P0001','invalid menu selection','duplicate option rejected');
select throws_ok(format('select pg_temp.price(%L)',jsonb_set(:'selection_lines','{0,price_amount_minor}','1')::text),'P0001','order item quantity is invalid','forged line price rejected at SQL boundary');
select is(pg_temp.price(:'selection_lines'::jsonb||jsonb_set(:'selection_lines'::jsonb,'{0,variant_id}','"ea100000-0000-0000-0000-000000000001"'))->>'subtotal','5600','different configurations of one item remain distinct');
select is(private.canonical_menu_lines('[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1,"option_ids":["ea300000-0000-0000-0000-000000000002","ea300000-0000-0000-0000-000000000001"]}]'),private.canonical_menu_lines('[{"menu_item_id":"F6000000-0000-0000-0000-000000000001","quantity":1,"option_ids":["EA300000-0000-0000-0000-000000000001","ea300000-0000-0000-0000-000000000002"]}]'),'option order and identifier case canonicalized');
update public.menu_version_items set configuration=jsonb_set(configuration,'{variants,1,isActive}','false') where menu_version_id=:'copied_version' and menu_item_id='f6000000-0000-0000-0000-000000000001';
select set_config('test.configured_version',:'copied_version',true);
select throws_ok(format('select pg_temp.price(%L)',:'selection_lines'),'P0001','invalid menu selection','inactive variant rejected');
update public.menu_version_items set configuration=jsonb_set(:'menu_configuration'::jsonb,'{optionGroups,0,options,1,isActive}','false') where menu_version_id=:'copied_version' and menu_item_id='f6000000-0000-0000-0000-000000000001';
select throws_ok(format('select pg_temp.price(%L)',:'selection_lines'),'P0001','invalid menu selection','inactive option rejected');
update public.menu_version_items set configuration=jsonb_set(:'menu_configuration'::jsonb,'{optionGroups,0,maxSelections}','1') where menu_version_id=:'copied_version' and menu_item_id='f6000000-0000-0000-0000-000000000001';
select throws_ok(format('select pg_temp.price(%L)',jsonb_set(:'selection_lines','{0,option_ids}','["ea300000-0000-0000-0000-000000000001","ea300000-0000-0000-0000-000000000002"]')::text),'P0001','invalid menu selection','group maximum enforced');
update public.menu_version_items set configuration=jsonb_set(:'menu_configuration'::jsonb,'{variants,1,priceDeltaAmountMinor}','1000000000') where menu_version_id=:'copied_version' and menu_item_id='f6000000-0000-0000-0000-000000000001';
select throws_ok(format('select pg_temp.price(%L)',:'selection_lines'),'P0001','menu selection amount is invalid','combined unit amount bound enforced');
select set_config('test.configured_version',:'configured_version',true);
select private.quote_public_cart('storefront-restaurant-a','storefront-a-mitte','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001','pickup',date_trunc('hour',now())+interval '3 hours',:'selection_lines',null) as review \gset
select is(:'review'::jsonb->>'status','changed','stale version receives current authorized quote');
select is(:'review'::jsonb->>'subtotalAmountMinor','3000','review uses shared server pricing');
select is((select count(*)::integer from public.orders),0,'quote creates no order');
select is((select count(*)::integer from public.ordering_capacity_claims),0,'quote reserves no capacity');
select is(private.quote_public_cart('storefront-restaurant-b','storefront-a-mitte','f4000000-0000-0000-0000-000000000001',:'configured_version','pickup',now()+interval '3 hours',:'selection_lines',null),null::jsonb,'cross-tenant quote hidden');
select is(private.quote_public_cart('storefront-restaurant-a','storefront-a-mitte','f4000000-0000-0000-0000-000000000001',:'configured_version','pickup',now()+interval '3 hours',(:'selection_lines'::jsonb #- '{0,variant_id}'),null)->>'status','unavailable','invalid choice has structured review conflict');
select private.submit_public_guest_pickup_order('storefront-restaurant-a','storefront-a-mitte','f4000000-0000-0000-0000-000000000001',:'configured_version',date_trunc('hour',now())+interval '3 hours',:'selection_lines','configured-pickup-0001','{"contact_name":"Synthetic","phone_e164":"+999100000001","email":"synthetic@example.invalid"}','preview-v1',30) as configured_order \gset
select is(:'configured_order'::jsonb->>'totalAmountMinor','3000','pickup matches quote');
select is((select selection_snapshot->>'taxAmountMinor' from public.order_lines where order_id=(:'configured_order'::jsonb->>'orderId')::uuid),'196','tax snapshot persisted');
select throws_ok(format('update public.order_lines set selection_snapshot=null where order_id=%L',:'configured_order'::jsonb->>'orderId'),'23514','order records are append-only','new snapshot immutable');
select private.rollback_menu_version('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',statement_timestamp(),'f1000000-0000-0000-0000-000000000001','aal2');
select is((select selection_snapshot->'variant'->>'name' from public.order_lines where order_id=(:'configured_order'::jsonb->>'orderId')::uuid),'Large','rollback does not mutate selection snapshot');
select is(private.submit_public_guest_pickup_order('storefront-restaurant-a','storefront-a-mitte','f4000000-0000-0000-0000-000000000001',:'configured_version',date_trunc('hour',now())+interval '3 hours',:'selection_lines','configured-pickup-0001','{"contact_name":"Synthetic","phone_e164":"+999100000001","email":"synthetic@example.invalid"}','preview-v1',30)->>'orderId',:'configured_order'::jsonb->>'orderId','exact retry succeeds after rollback');
select ok(exists(select 1 from public.outbox_events where event_type='menu.item.configuration_changed'),'configuration mutation audited through outbox');
select * from finish();
rollback;
