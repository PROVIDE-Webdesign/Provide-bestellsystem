begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select no_plan();
\ir fixtures/storefront.fixture.inc

select ok(has_function_privilege('service_role', 'private.read_storefront_catalog(text,text)', 'execute'), 'server can read public catalog');
select ok(not has_function_privilege('anon', 'private.read_storefront_catalog(text,text)', 'execute'), 'anon cannot execute catalog SQL');
select ok(not has_function_privilege('authenticated', 'private.read_storefront_catalog(text,text)', 'execute'), 'browser cannot execute catalog SQL');
select ok(not has_function_privilege('anon', 'private.read_storefront_availability(text,text,text,timestamptz,integer)', 'execute'), 'anon cannot execute availability SQL');
select ok(not has_function_privilege('authenticated', 'private.read_storefront_availability(text,text,text,timestamptz,integer)', 'execute'), 'browser cannot execute availability SQL');
select ok(not has_table_privilege('anon', 'public.menu_version_items', 'select'), 'no public base-table grant');

set local role service_role;
select is(private.read_storefront_catalog('storefront-restaurant-a', 'storefront-a-mitte') #>> '{restaurant,name}', 'PROVIDE Testküche', 'live public restaurant resolves by scoped slugs');
select is(private.read_storefront_catalog('storefront-restaurant-a', 'storefront-a-mitte') #>> '{menus,0,sections,0,items,0,priceAmountMinor}', '1250', 'price comes from active published version');
select is(private.read_storefront_catalog('storefront-restaurant-a', 'storefront-a-mitte') #>> '{menus,0,sections,0,items,0,availability}', 'available', 'missing override matches existing order resolver default');
select is(private.read_storefront_catalog('unknown', 'storefront-a-mitte'), null::jsonb, 'unknown tenant is hidden');
select is(private.read_storefront_catalog('storefront-restaurant-b', 'storefront-a-mitte'), null::jsonb, 'cross-tenant location cannot be selected');
select is(private.read_storefront_catalog('storefront-restaurant-b', 'storefront-b-mitte'), null::jsonb, 'restaurant without public menu stays hidden');
select is(private.read_storefront_catalog('invalid/slug', 'storefront-a-mitte'), null::jsonb, 'invalid SQL caller input fails closed');
select is(private.read_storefront_catalog(null, 'storefront-a-mitte'), null::jsonb, 'null scope fails closed');
select is(private.read_storefront_availability('storefront-restaurant-a', 'storefront-a-mitte', 'pickup', date_trunc('hour',now()) + interval '2 hours', 2) ->> 'status', 'available', 'valid future pickup is available');
select is(private.read_storefront_availability('storefront-restaurant-a', 'storefront-a-mitte', 'delivery', date_trunc('hour',now()) + interval '2 hours', 2) ->> 'status', 'unavailable', 'disabled delivery is unavailable');
select is(private.read_storefront_availability('storefront-restaurant-a', 'storefront-a-mitte', 'pickup', now() - interval '1 day', 2) ->> 'status', 'unavailable', 'past times fail closed');
select is(private.read_storefront_availability('storefront-restaurant-a', 'storefront-a-mitte', 'pickup', date_trunc('hour',now()) + interval '2 hours', 101) ->> 'status', 'unavailable', 'capacity is enforced');
select is((select count(*)::integer from jsonb_object_keys(private.read_storefront_availability('storefront-restaurant-a', 'storefront-a-mitte', 'pickup', date_trunc('hour',now()) + interval '2 hours', 101))), 5, 'availability emits only five approved fields');
select ok(not (private.read_storefront_availability('storefront-restaurant-a', 'storefront-a-mitte', 'pickup', date_trunc('hour',now()) + interval '2 hours', 101) ?| array['reason_code','maximum_orders','reserved_orders','schedule_version_id','slot_start']), 'no internal reason or capacity information');
select throws_ok($$select private.read_storefront_availability('storefront-restaurant-a', 'storefront-a-mitte', 'pickup', null, 2)$$, '22023', 'invalid storefront availability input', 'null instant rejected');
select throws_ok($$select private.read_storefront_availability('storefront-restaurant-a', 'storefront-a-mitte', 'pickup', 'infinity', 2)$$, '22023', 'invalid storefront availability input', 'infinite instant rejected');
select throws_ok($$select private.read_storefront_availability('storefront-restaurant-a', 'storefront-a-mitte', 'pickup', now(), 1001)$$, '22023', 'invalid storefront availability input', 'oversized item count rejected');
select throws_ok($$select private.read_storefront_availability('storefront-restaurant-a', 'storefront-a-mitte', null, now(), 2)$$, '22023', 'invalid storefront availability input', 'null fulfillment rejected');
reset role;
select ok(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte')::text not like '%Hidden inactive%', 'inactive items are omitted');
select is((select count(*)::integer from public.ordering_capacity_claims where restaurant_id = 'f2000000-0000-0000-0000-000000000001'), 0, 'reads do not reserve capacity');
select is((select count(*)::integer from public.orders where restaurant_id = 'f2000000-0000-0000-0000-000000000001'), 0, 'reads do not create orders');

insert into public.menu_item_location_availability (restaurant_id, location_id, menu_id, menu_item_id, status, updated_by_user_id)
values ('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f6000000-0000-0000-0000-000000000001','sold_out','f1000000-0000-0000-0000-000000000001');
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte') #>> '{menus,0,sections,0,items,0,availability}', 'sold_out', 'sold-out change visible on next read');
update public.menu_item_location_availability set status = 'unavailable' where restaurant_id = 'f2000000-0000-0000-0000-000000000001';
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte') #>> '{menus,0,sections,0,items,0,availability}', 'unavailable', 'unavailable item remains visibly labelled');

-- Future published versions and inactive items must never leak into the current catalog.
insert into public.menu_versions (id, restaurant_id, menu_id, version_number, currency_code, created_by_user_id)
values ('f5000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',2,'EUR','f1000000-0000-0000-0000-000000000001');
insert into public.menu_version_sections (restaurant_id, menu_id, menu_version_id, section_key, display_name)
values ('f2000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000002','future','Future secret');
select ok(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte')::text not like '%Future secret%', 'draft content is hidden');
update public.menu_versions set status = 'published', published_by_user_id = 'f1000000-0000-0000-0000-000000000001', published_at = now() where id = 'f5000000-0000-0000-0000-000000000002';
insert into public.menu_publications (restaurant_id, location_id, menu_id, menu_version_id, publication_kind, effective_at, actor_user_id, authentication_assurance)
values ('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000002','publish',now() + interval '1 day','f1000000-0000-0000-0000-000000000001','aal2');
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte') #>> '{menus,0,versionId}', 'f5000000-0000-0000-0000-000000000001', 'future publication cannot replace current prices early');

update public.restaurant_feature_flags set enabled = false where restaurant_id = 'f2000000-0000-0000-0000-000000000001' and feature_key = 'ordering.accept_orders';
select isnt(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte'), null::jsonb, 'ordering stop does not hide separately enabled public menu');
select is(private.read_storefront_availability('storefront-restaurant-a','storefront-a-mitte','pickup',date_trunc('hour',now()) + interval '2 hours',2) ->> 'status', 'unavailable', 'ordering stop closes availability');
update public.restaurant_feature_flags set enabled = false where restaurant_id = 'f2000000-0000-0000-0000-000000000001' and feature_key = 'catalog.public_menu';
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte'), null::jsonb, 'catalog flag immediately hides menu');
select is(private.read_storefront_availability('storefront-restaurant-a','storefront-a-mitte','pickup',date_trunc('hour',now()) + interval '2 hours',2), null::jsonb, 'catalog visibility also gates availability');
update public.restaurant_feature_flags set enabled = true where restaurant_id = 'f2000000-0000-0000-0000-000000000001';
update public.locations set status = 'suspended' where id = 'f3000000-0000-0000-0000-000000000001';
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte'), null::jsonb, 'suspended location hidden');
update public.locations set status = 'active' where id = 'f3000000-0000-0000-0000-000000000001';
update public.location_activation_states set go_live_status = 'paused', paused_at = now() where location_id = 'f3000000-0000-0000-0000-000000000001';
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte'), null::jsonb, 'paused location go-live hidden');
update public.location_activation_states set go_live_status = 'live', paused_at = null where location_id = 'f3000000-0000-0000-0000-000000000001';
update public.restaurants set status = 'suspended' where id = 'f2000000-0000-0000-0000-000000000001';
select is(private.read_storefront_catalog('storefront-restaurant-a','storefront-a-mitte'), null::jsonb, 'suspended restaurant hidden');
select * from finish();
rollback;
