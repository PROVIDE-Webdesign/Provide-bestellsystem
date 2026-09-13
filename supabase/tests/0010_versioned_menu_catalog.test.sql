begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(71);

select has_table('public', 'menus', 'menus table exists');
select has_table('public', 'menu_versions', 'menu versions table exists');
select has_table('public', 'menu_items', 'stable menu items table exists');
select has_table('public', 'menu_version_sections', 'versioned menu sections table exists');
select has_table('public', 'menu_version_items', 'versioned menu item snapshots table exists');
select has_table(
  'public',
  'menu_item_location_availability',
  'location item availability table exists'
);
select has_table('public', 'menu_publications', 'menu publication history table exists');
select has_table(
  'public',
  'menu_item_availability_transitions',
  'item availability audit table exists'
);

select has_function(
  'private',
  'create_menu',
  array['uuid', 'text', 'text', 'uuid', 'text'],
  'server-side menu creation function exists'
);
select has_function(
  'private',
  'create_menu_draft',
  array['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'server-side draft creation function exists'
);
select has_function(
  'private',
  'publish_menu_version',
  array['uuid', 'uuid', 'uuid', 'uuid', 'timestamptz', 'uuid', 'text'],
  'controlled menu publication function exists'
);
select has_function(
  'private',
  'rollback_menu_version',
  array['uuid', 'uuid', 'uuid', 'uuid', 'timestamptz', 'uuid', 'text'],
  'controlled menu rollback function exists'
);
select has_function(
  'private',
  'set_menu_item_availability',
  array['uuid', 'uuid', 'uuid', 'uuid', 'text', 'uuid', 'text'],
  'controlled item availability function exists'
);
select has_function(
  'private',
  'resolve_public_menu_version',
  array['uuid', 'uuid', 'uuid', 'timestamptz'],
  'fail-closed public menu resolver exists'
);

select has_trigger(
  'public',
  'menu_versions',
  'menu_versions_protect_identity',
  'published version protection trigger exists'
);
select has_trigger(
  'public',
  'menu_version_items',
  'menu_version_items_require_draft',
  'published item snapshot protection trigger exists'
);
select has_trigger(
  'public',
  'menu_publications',
  'menu_publications_append_only',
  'publication history is append-only'
);
select has_trigger(
  'public',
  'menu_item_availability_transitions',
  'menu_item_availability_transitions_append_only',
  'availability history is append-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'private.publish_menu_version(uuid,uuid,uuid,uuid,timestamptz,uuid,text)',
    'execute'
  ),
  'service role may publish menu versions'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.publish_menu_version(uuid,uuid,uuid,uuid,timestamptz,uuid,text)',
    'execute'
  ),
  'authenticated browsers cannot publish menu versions'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.resolve_public_menu_version(uuid,uuid,uuid,timestamptz)',
    'execute'
  ),
  'anonymous users cannot call the internal public menu resolver'
);
select ok(
  has_table_privilege('authenticated', 'public.menu_versions', 'select'),
  'authenticated administrators receive read-only menu version access'
);
select ok(
  not has_table_privilege('authenticated', 'public.menu_versions', 'insert,update,delete'),
  'authenticated users cannot modify menu versions directly'
);
select ok(
  has_table_privilege('service_role', 'public.menu_version_items', 'insert,update,delete'),
  'service role may edit draft menu content'
);
select ok(
  not has_table_privilege('service_role', 'public.menu_versions', 'insert,update,delete'),
  'service role must use controlled functions for menu version lifecycle'
);

insert into auth.users (id, email)
values
  ('a1000000-0000-0000-0000-000000000001', 'menu-owner-a@example.invalid'),
  ('a1000000-0000-0000-0000-000000000002', 'menu-manager-a@example.invalid'),
  ('a1000000-0000-0000-0000-000000000003', 'menu-kitchen-a@example.invalid'),
  ('a1000000-0000-0000-0000-000000000004', 'menu-owner-b@example.invalid');

insert into public.restaurants (id, slug, display_name, status)
values
  (
    'a2000000-0000-0000-0000-000000000001',
    'menu-restaurant-a',
    'Menu Restaurant A',
    'active'
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    'menu-restaurant-b',
    'Menu Restaurant B',
    'active'
  );

insert into public.restaurant_memberships (restaurant_id, user_id, role, status)
values
  (
    'a2000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'owner',
    'active'
  ),
  (
    'a2000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000002',
    'manager',
    'active'
  ),
  (
    'a2000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000003',
    'kitchen',
    'active'
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    'a1000000-0000-0000-0000-000000000004',
    'owner',
    'active'
  );

insert into public.locations (
  id,
  restaurant_id,
  slug,
  display_name,
  status,
  address_line_1,
  postal_code,
  city,
  country_code
)
values
  (
    'a3000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'menu-a-mitte',
    'Menu A Mitte',
    'active',
    'Markt 1',
    '52062',
    'Aachen',
    'DE'
  ),
  (
    'a3000000-0000-0000-0000-000000000002',
    'a2000000-0000-0000-0000-000000000001',
    'menu-a-sued',
    'Menu A Sued',
    'active',
    'Suedstrasse 2',
    '52064',
    'Aachen',
    'DE'
  ),
  (
    'a3000000-0000-0000-0000-000000000003',
    'a2000000-0000-0000-0000-000000000002',
    'menu-b-mitte',
    'Menu B Mitte',
    'active',
    'Domplatz 3',
    '50667',
    'Koeln',
    'DE'
  );

insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
values (
  'a2000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000001'
);

update public.onboarding_check_results as result
set
  status = 'passed',
  checked_by_user_id = case
    when result.restaurant_id = 'a2000000-0000-0000-0000-000000000001'
      then 'a1000000-0000-0000-0000-000000000001'::uuid
    else 'a1000000-0000-0000-0000-000000000004'::uuid
  end,
  checked_at = now()
where result.restaurant_id in (
  'a2000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000002'
);

update public.restaurant_activation_states as activation
set
  onboarding_status = 'approved',
  go_live_status = 'live',
  approved_by_user_id = case
    when activation.restaurant_id = 'a2000000-0000-0000-0000-000000000001'
      then 'a1000000-0000-0000-0000-000000000001'::uuid
    else 'a1000000-0000-0000-0000-000000000004'::uuid
  end,
  approved_at = now(),
  went_live_at = now()
where activation.restaurant_id in (
  'a2000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000002'
);

update public.location_activation_states as activation
set
  onboarding_status = 'approved',
  go_live_status = 'live',
  approved_by_user_id = case
    when activation.restaurant_id = 'a2000000-0000-0000-0000-000000000001'
      then 'a1000000-0000-0000-0000-000000000001'::uuid
    else 'a1000000-0000-0000-0000-000000000004'::uuid
  end,
  approved_at = now(),
  went_live_at = now()
where activation.restaurant_id in (
  'a2000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000002'
);

insert into public.menus (id, restaurant_id, slug, display_name)
values
  (
    'a4000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'hauptkarte',
    'Hauptkarte'
  ),
  (
    'a4000000-0000-0000-0000-000000000002',
    'a2000000-0000-0000-0000-000000000002',
    'hauptkarte',
    'Hauptkarte B'
  );

insert into public.menu_versions (
  id,
  restaurant_id,
  menu_id,
  version_number,
  currency_code,
  created_by_user_id
)
values
  (
    'a5000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    1,
    'EUR',
    'a1000000-0000-0000-0000-000000000001'
  ),
  (
    'a5000000-0000-0000-0000-000000000002',
    'a2000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    2,
    'EUR',
    'a1000000-0000-0000-0000-000000000001'
  ),
  (
    'a5000000-0000-0000-0000-000000000003',
    'a2000000-0000-0000-0000-000000000002',
    'a4000000-0000-0000-0000-000000000002',
    1,
    'EUR',
    'a1000000-0000-0000-0000-000000000004'
  );

insert into public.menu_items (id, restaurant_id, menu_id, slug)
values
  (
    'a6000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    'tofu-curry'
  ),
  (
    'a6000000-0000-0000-0000-000000000002',
    'a2000000-0000-0000-0000-000000000002',
    'a4000000-0000-0000-0000-000000000002',
    'tofu-curry'
  );

insert into public.menu_version_sections (
  restaurant_id,
  menu_id,
  menu_version_id,
  section_key,
  display_name,
  sort_order
)
values
  (
    'a2000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    'a5000000-0000-0000-0000-000000000001',
    'hauptgerichte',
    'Hauptgerichte',
    1
  ),
  (
    'a2000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    'a5000000-0000-0000-0000-000000000002',
    'hauptgerichte',
    'Hauptgerichte',
    1
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    'a4000000-0000-0000-0000-000000000002',
    'a5000000-0000-0000-0000-000000000003',
    'hauptgerichte',
    'Hauptgerichte',
    1
  );

insert into public.menu_version_items (
  restaurant_id,
  menu_id,
  menu_version_id,
  menu_item_id,
  section_key,
  display_name,
  description,
  price_amount_minor,
  sort_order
)
values
  (
    'a2000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    'a5000000-0000-0000-0000-000000000001',
    'a6000000-0000-0000-0000-000000000001',
    'hauptgerichte',
    'Tofu Curry',
    'Tofu mit Gemuese',
    1200,
    1
  ),
  (
    'a2000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    'a5000000-0000-0000-0000-000000000002',
    'a6000000-0000-0000-0000-000000000001',
    'hauptgerichte',
    'Tofu Curry',
    'Tofu mit Gemuese',
    1500,
    1
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    'a4000000-0000-0000-0000-000000000002',
    'a5000000-0000-0000-0000-000000000003',
    'a6000000-0000-0000-0000-000000000002',
    'hauptgerichte',
    'Tofu Curry B',
    null,
    1300,
    1
  );

select throws_ok(
  $$
    update public.menu_version_items
    set price_amount_minor = -1
    where menu_version_id = 'a5000000-0000-0000-0000-000000000002'
  $$,
  '23514',
  null,
  'negative prices are rejected'
);

set local role service_role;

select throws_ok(
  $$
    select private.create_menu(
      'a2000000-0000-0000-0000-000000000001',
      'abendkarte', 'Abendkarte',
      'a1000000-0000-0000-0000-000000000001', 'aal1'
    )
  $$,
  'P0001',
  'menu administration requires aal2',
  'aal1 cannot administer menus'
);
select throws_ok(
  $$
    select private.create_menu(
      'a2000000-0000-0000-0000-000000000001',
      'abendkarte', 'Abendkarte',
      'a1000000-0000-0000-0000-000000000004', 'aal2'
    )
  $$,
  'P0001',
  'menu actor must be an active owner or manager',
  'an owner from another tenant cannot create a menu'
);
select lives_ok(
  $$
    select private.create_menu(
      'a2000000-0000-0000-0000-000000000001',
      'abendkarte', 'Abendkarte',
      'a1000000-0000-0000-0000-000000000001', 'aal2'
    )
  $$,
  'an aal2 owner can create a menu'
);
select results_eq(
  $$
    select slug, display_name, status
    from public.menus
    where restaurant_id = 'a2000000-0000-0000-0000-000000000001'
      and slug = 'abendkarte'
  $$,
  $$values ('abendkarte'::text, 'Abendkarte'::text, 'active'::text)$$,
  'created menu is tenant-bound and active'
);

select throws_ok(
  $$
    select private.publish_menu_version(
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      'a5000000-0000-0000-0000-000000000001',
      now(),
      'a1000000-0000-0000-0000-000000000001', 'aal1'
    )
  $$,
  'P0001',
  'menu administration requires aal2',
  'aal1 cannot publish a menu'
);
select throws_ok(
  $$
    select private.publish_menu_version(
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000002',
      'a4000000-0000-0000-0000-000000000001',
      'a5000000-0000-0000-0000-000000000001',
      now(),
      'a1000000-0000-0000-0000-000000000002', 'aal2'
    )
  $$,
  'P0001',
  'manager is not assigned to the menu location',
  'manager cannot publish to an unassigned location'
);
select throws_ok(
  $$
    select private.publish_menu_version(
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000002',
      'a5000000-0000-0000-0000-000000000003',
      now(),
      'a1000000-0000-0000-0000-000000000001', 'aal2'
    )
  $$,
  'P0001',
  'active menu version was not found',
  'cross-tenant menu versions cannot be published'
);
select lives_ok(
  $$
    select private.publish_menu_version(
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      'a5000000-0000-0000-0000-000000000001',
      now(),
      'a1000000-0000-0000-0000-000000000001', 'aal2'
    )
  $$,
  'complete first menu version can be published immediately'
);
select results_eq(
  $$
    select status, published_by_user_id, published_at is not null
    from public.menu_versions
    where id = 'a5000000-0000-0000-0000-000000000001'
  $$,
  $$values ('published'::text, 'a1000000-0000-0000-0000-000000000001'::uuid, true)$$,
  'publication freezes the version and records its actor'
);
select is(
  private.resolve_public_menu_version(
    'a2000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    now()
  ),
  null::uuid,
  'public resolver remains closed while its feature flag is disabled'
);

insert into public.restaurant_feature_flags (restaurant_id, feature_key, enabled)
values ('a2000000-0000-0000-0000-000000000001', 'catalog.public_menu', true);

select is(
  private.resolve_public_menu_version(
    'a2000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    now()
  ),
  'a5000000-0000-0000-0000-000000000001'::uuid,
  'live location resolves its effective published version'
);
select throws_ok(
  $$
    update public.menu_version_items
    set price_amount_minor = 999
    where menu_version_id = 'a5000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'published menu content is immutable',
  'published item prices cannot be rewritten'
);
select throws_ok(
  $$
    update public.menu_versions
    set status = 'draft'
    where id = 'a5000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'published menu versions are immutable',
  'published versions cannot return to draft'
);

select lives_ok(
  $$
    select private.create_menu_draft(
      'a2000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      'a5000000-0000-0000-0000-000000000001',
      'a1000000-0000-0000-0000-000000000001', 'aal2'
    )
  $$,
  'a new draft can copy an immutable published source version'
);
select is(
  (
    select count(*)::integer
    from public.menu_version_sections as section
    join public.menu_versions as version on version.id = section.menu_version_id
    where version.restaurant_id = 'a2000000-0000-0000-0000-000000000001'
      and version.menu_id = 'a4000000-0000-0000-0000-000000000001'
      and version.version_number = 3
  ),
  1,
  'draft copy contains the published sections'
);
select is(
  (
    select item.price_amount_minor
    from public.menu_version_items as item
    join public.menu_versions as version on version.id = item.menu_version_id
    where version.restaurant_id = 'a2000000-0000-0000-0000-000000000001'
      and version.menu_id = 'a4000000-0000-0000-0000-000000000001'
      and version.version_number = 3
  ),
  1200::bigint,
  'draft copy preserves the source price snapshot'
);

select lives_ok(
  $$
    select private.publish_menu_version(
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      'a5000000-0000-0000-0000-000000000002',
      now() + interval '1 day',
      'a1000000-0000-0000-0000-000000000001', 'aal2'
    )
  $$,
  'future publication schedules a complete price version'
);
select is(
  private.resolve_public_menu_version(
    'a2000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    now() + interval '12 hours'
  ),
  'a5000000-0000-0000-0000-000000000001'::uuid,
  'scheduled price version is not visible before its effective time'
);
select is(
  private.resolve_public_menu_version(
    'a2000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    now() + interval '36 hours'
  ),
  'a5000000-0000-0000-0000-000000000002'::uuid,
  'scheduled price version becomes effective at its publication time'
);
select results_eq(
  $$
    select version_number, price_amount_minor
    from public.menu_versions as version
    join public.menu_version_items as item
      on item.restaurant_id = version.restaurant_id
      and item.menu_id = version.menu_id
      and item.menu_version_id = version.id
    where version.restaurant_id = 'a2000000-0000-0000-0000-000000000001'
      and version.menu_id = 'a4000000-0000-0000-0000-000000000001'
      and version.version_number in (1, 2)
    order by version_number
  $$,
  $$values (1, 1200::bigint), (2, 1500::bigint)$$,
  'prices remain bound to their applied menu version'
);

select lives_ok(
  $$
    select private.rollback_menu_version(
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      'a5000000-0000-0000-0000-000000000001',
      now() + interval '2 days',
      'a1000000-0000-0000-0000-000000000001', 'aal2'
    )
  $$,
  'a previously active version can be scheduled as rollback'
);
select is(
  private.resolve_public_menu_version(
    'a2000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    now() + interval '3 days'
  ),
  'a5000000-0000-0000-0000-000000000001'::uuid,
  'rollback restores the earlier immutable price version'
);
select throws_ok(
  $$
    update public.menu_publications
    set publication_kind = 'rollback'
    where restaurant_id = 'a2000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'menu history is append-only',
  'publication history cannot be rewritten'
);
select is(
  (
    select count(*)::integer
    from public.menu_publications
    where restaurant_id = 'a2000000-0000-0000-0000-000000000001'
      and location_id = 'a3000000-0000-0000-0000-000000000001'
  ),
  3,
  'publication, schedule and rollback remain in history'
);
select is(
  (
    select count(*)::integer
    from public.outbox_events
    where restaurant_id = 'a2000000-0000-0000-0000-000000000001'
      and idempotency_key like 'menu-publication:%'
  ),
  3,
  'every publication decision creates one outbox event'
);

select lives_ok(
  $$
    select private.set_menu_item_availability(
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      'a6000000-0000-0000-0000-000000000001',
      'sold_out',
      'a1000000-0000-0000-0000-000000000002', 'aal2'
    )
  $$,
  'assigned manager can mark an item sold out'
);
select results_eq(
  $$
    select status, updated_by_user_id
    from public.menu_item_location_availability
    where restaurant_id = 'a2000000-0000-0000-0000-000000000001'
      and location_id = 'a3000000-0000-0000-0000-000000000001'
      and menu_item_id = 'a6000000-0000-0000-0000-000000000001'
  $$,
  $$values ('sold_out'::text, 'a1000000-0000-0000-0000-000000000002'::uuid)$$,
  'current availability records status and actor'
);
select throws_ok(
  $$
    select private.set_menu_item_availability(
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      'a6000000-0000-0000-0000-000000000001',
      'sold_out',
      'a1000000-0000-0000-0000-000000000002', 'aal2'
    )
  $$,
  'P0001',
  'menu item availability status is unchanged',
  'unchanged availability does not create duplicate history'
);
select throws_ok(
  $$
    select private.set_menu_item_availability(
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000002',
      'a4000000-0000-0000-0000-000000000001',
      'a6000000-0000-0000-0000-000000000001',
      'unavailable',
      'a1000000-0000-0000-0000-000000000002', 'aal2'
    )
  $$,
  'P0001',
  'manager is not assigned to the menu location',
  'manager cannot change availability at an unassigned location'
);
select lives_ok(
  $$
    select private.set_menu_item_availability(
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000002',
      'a4000000-0000-0000-0000-000000000001',
      'a6000000-0000-0000-0000-000000000001',
      'available',
      'a1000000-0000-0000-0000-000000000001', 'aal2'
    )
  $$,
  'owner can configure availability at every restaurant location'
);
select is(
  (
    select count(*)::integer
    from public.menu_item_availability_transitions
    where restaurant_id = 'a2000000-0000-0000-0000-000000000001'
  ),
  2,
  'availability changes create append-only audit records'
);
select is(
  (
    select count(*)::integer
    from public.outbox_events
    where restaurant_id = 'a2000000-0000-0000-0000-000000000001'
      and idempotency_key like 'menu-availability:%'
  ),
  2,
  'availability changes create transactional outbox events'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000001","aal":"aal1"}';

select is_empty(
  $$select id from public.menus$$,
  'owner with aal1 cannot read administrative menu data'
);

set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000001","aal":"aal2"}';

select results_eq(
  $$select distinct restaurant_id from public.menus$$,
  array['a2000000-0000-0000-0000-000000000001'::uuid],
  'owner with aal2 sees menu data only for their tenant'
);
select is(
  (select count(*)::integer from public.menu_publications),
  3,
  'owner sees publication history for every restaurant location'
);
select is(
  (select count(*)::integer from public.menu_item_location_availability),
  2,
  'owner sees availability at every restaurant location'
);
select throws_ok(
  $$update public.menus set display_name = 'Changed'$$,
  '42501',
  null,
  'authenticated owner cannot edit menus directly'
);
select throws_ok(
  $$
    select private.set_menu_item_availability(
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      'a6000000-0000-0000-0000-000000000001',
      'available',
      'a1000000-0000-0000-0000-000000000001', 'aal2'
    )
  $$,
  '42501',
  null,
  'authenticated owner cannot call server-only menu functions'
);

set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000002';
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000002","aal":"aal2"}';

select results_eq(
  $$select distinct restaurant_id from public.menu_versions$$,
  array['a2000000-0000-0000-0000-000000000001'::uuid],
  'manager sees menu versions only for their restaurant'
);
select results_eq(
  $$select location_id from public.menu_item_location_availability$$,
  array['a3000000-0000-0000-0000-000000000001'::uuid],
  'manager sees operational availability only for assigned locations'
);
select is(
  (select count(*)::integer from public.menu_publications),
  3,
  'manager sees publication history only for assigned locations'
);

set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000003","aal":"aal2"}';

select is_empty(
  $$select id from public.menus$$,
  'kitchen personnel cannot read administrative menu data'
);
select is_empty(
  $$select id from public.menu_publications$$,
  'kitchen personnel cannot read publication history'
);

reset role;
set local role anon;

select throws_ok(
  $$select * from public.menus$$,
  '42501',
  null,
  'anonymous users cannot read menu administration tables'
);
select throws_ok(
  $$
    select private.resolve_public_menu_version(
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      now()
    )
  $$,
  '42501',
  null,
  'anonymous users cannot call internal menu resolution functions'
);

select * from finish();

rollback;
