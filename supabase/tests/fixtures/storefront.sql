-- Synthetic fixture, for disposable local/CI databases only. No automatic seeding or deployment.
insert into auth.users (id, email)
values
  ('f1000000-0000-0000-0000-000000000001', 'storefront-owner-a@example.invalid'),
  ('f1000000-0000-0000-0000-000000000002', 'storefront-manager-a@example.invalid'),
  ('f1000000-0000-0000-0000-000000000003', 'storefront-kitchen-a@example.invalid'),
  ('f1000000-0000-0000-0000-000000000004', 'storefront-driver-a@example.invalid'),
  ('f1000000-0000-0000-0000-000000000005', 'storefront-owner-b@example.invalid'),
  ('f1000000-0000-0000-0000-000000000006', 'storefront-manager-unassigned@example.invalid');

insert into public.restaurants (id, slug, display_name, status)
values
  (
    'f2000000-0000-0000-0000-000000000001',
    'storefront-restaurant-a',
    'PROVIDE Testküche',
    'active'
  ),
  (
    'f2000000-0000-0000-0000-000000000002',
    'storefront-restaurant-b',
    'Andere Testküche',
    'active'
  );

insert into public.restaurant_memberships (restaurant_id, user_id, role, status)
values
  (
    'f2000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001',
    'owner',
    'active'
  ),
  (
    'f2000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000002',
    'manager',
    'active'
  ),
  (
    'f2000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000003',
    'kitchen',
    'active'
  ),
  (
    'f2000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000004',
    'driver',
    'active'
  ),
  (
    'f2000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000005',
    'owner',
    'active'
  ),
  (
    'f2000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000006',
    'manager',
    'active'
  );

insert into public.locations (
  id,
  restaurant_id,
  slug,
  display_name,
  status,
  timezone,
  address_line_1,
  postal_code,
  city,
  country_code
)
values
  (
    'f3000000-0000-0000-0000-000000000001',
    'f2000000-0000-0000-0000-000000000001',
    'storefront-a-mitte',
    'Teststandort Mitte',
    'active',
    'Europe/Berlin',
    'Testweg 1',
    '52062',
    'Aachen',
    'DE'
  ),
  (
    'f3000000-0000-0000-0000-000000000002',
    'f2000000-0000-0000-0000-000000000002',
    'storefront-b-mitte',
    'Anderer Teststandort',
    'active',
    'Europe/Berlin',
    'Testweg 2',
    '50667',
    'Koeln',
    'DE'
  );

insert into public.restaurant_membership_locations (restaurant_id, user_id, location_id)
values
  (
    'f2000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000002',
    'f3000000-0000-0000-0000-000000000001'
  ),
  (
    'f2000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000003',
    'f3000000-0000-0000-0000-000000000001'
  ),
  (
    'f2000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000004',
    'f3000000-0000-0000-0000-000000000001'
  );

update public.onboarding_check_results as result
set
  status = 'passed',
  checked_by_user_id = case
    when result.restaurant_id = 'f2000000-0000-0000-0000-000000000001'
      then 'f1000000-0000-0000-0000-000000000001'::uuid
    else 'f1000000-0000-0000-0000-000000000005'::uuid
  end,
  checked_at = now()
where result.restaurant_id in (
  'f2000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000002'
);

update public.restaurant_activation_states as activation
set
  onboarding_status = 'approved',
  go_live_status = 'live',
  approved_by_user_id = case
    when activation.restaurant_id = 'f2000000-0000-0000-0000-000000000001'
      then 'f1000000-0000-0000-0000-000000000001'::uuid
    else 'f1000000-0000-0000-0000-000000000005'::uuid
  end,
  approved_at = now(),
  went_live_at = now()
where activation.restaurant_id in (
  'f2000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000002'
);

update public.location_activation_states as activation
set
  onboarding_status = 'approved',
  go_live_status = 'live',
  approved_by_user_id = case
    when activation.restaurant_id = 'f2000000-0000-0000-0000-000000000001'
      then 'f1000000-0000-0000-0000-000000000001'::uuid
    else 'f1000000-0000-0000-0000-000000000005'::uuid
  end,
  approved_at = now(),
  went_live_at = now()
where activation.restaurant_id in (
  'f2000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000002'
);

insert into public.restaurant_feature_flags (restaurant_id, feature_key, enabled)
values
  ('f2000000-0000-0000-0000-000000000001', 'ordering.accept_orders', true),
  ('f2000000-0000-0000-0000-000000000001', 'fulfillment.pickup', true),
  ('f2000000-0000-0000-0000-000000000001', 'catalog.public_menu', true);

insert into public.menus (id, restaurant_id, slug, display_name)
values (
  'f4000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000001',
  'storefront-test-menu',
  'Unsere Speisekarte'
);

insert into public.menu_versions (
  id,
  restaurant_id,
  menu_id,
  version_number,
  currency_code,
  created_by_user_id
)
values (
  'f5000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000001',
  'f4000000-0000-0000-0000-000000000001',
  1,
  'EUR',
  'f1000000-0000-0000-0000-000000000001'
);

insert into public.menu_items (id, restaurant_id, menu_id, slug)
values
  (
    'f6000000-0000-0000-0000-000000000001',
    'f2000000-0000-0000-0000-000000000001',
    'f4000000-0000-0000-0000-000000000001',
    'curry'
  ),
  (
    'f6000000-0000-0000-0000-000000000002',
    'f2000000-0000-0000-0000-000000000001',
    'f4000000-0000-0000-0000-000000000001',
    'reis'
  );

insert into public.menu_version_sections (
  restaurant_id,
  menu_id,
  menu_version_id,
  section_key,
  display_name
)
values (
  'f2000000-0000-0000-0000-000000000001',
  'f4000000-0000-0000-0000-000000000001',
  'f5000000-0000-0000-0000-000000000001',
  'gerichte',
  'Gerichte'
);

insert into public.menu_version_items (
  restaurant_id,
  menu_id,
  menu_version_id,
  menu_item_id,
  section_key,
  display_name,
  price_amount_minor,
  sort_order
)
values
  (
    'f2000000-0000-0000-0000-000000000001',
    'f4000000-0000-0000-0000-000000000001',
    'f5000000-0000-0000-0000-000000000001',
    'f6000000-0000-0000-0000-000000000001',
    'gerichte',
    'Gemüsecurry',
    1250,
    1
  ),
  (
    'f2000000-0000-0000-0000-000000000001',
    'f4000000-0000-0000-0000-000000000001',
    'f5000000-0000-0000-0000-000000000001',
    'f6000000-0000-0000-0000-000000000002',
    'gerichte',
    'Duftreis',
    300,
    2
  );

insert into public.menu_items (id, restaurant_id, menu_id, slug)
values ('f6000000-0000-0000-0000-000000000003','f2000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','hidden-item');
insert into public.menu_version_items (restaurant_id,menu_id,menu_version_id,menu_item_id,section_key,display_name,price_amount_minor,is_active)
values ('f2000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001','f6000000-0000-0000-0000-000000000003','gerichte','Hidden inactive dish',500,false);

update public.menu_versions
set
  status = 'published',
  published_by_user_id = 'f1000000-0000-0000-0000-000000000001',
  published_at = now()
where id = 'f5000000-0000-0000-0000-000000000001';

insert into public.menu_publications (
  id,
  restaurant_id,
  location_id,
  menu_id,
  menu_version_id,
  publication_kind,
  effective_at,
  actor_user_id,
  authentication_assurance
)
values (
  'f7000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',
  'f4000000-0000-0000-0000-000000000001',
  'f5000000-0000-0000-0000-000000000001',
  'publish',
  now(),
  'f1000000-0000-0000-0000-000000000001',
  'aal2'
);

insert into public.availability_schedule_versions (
  id,
  restaurant_id,
  location_id,
  version_number,
  minimum_lead_minutes,
  maximum_advance_days,
  slot_interval_minutes,
  default_order_capacity,
  default_item_capacity,
  created_by_user_id
)
values (
  'f8000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',
  1,
  15,
  14,
  15,
  10,
  100,
  'f1000000-0000-0000-0000-000000000001'
);

insert into public.availability_windows (
  restaurant_id,
  location_id,
  schedule_version_id,
  fulfillment_type,
  weekday,
  opens_at,
  closes_at
)
select
  'f2000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',
  'f8000000-0000-0000-0000-000000000001',
  'pickup',
  weekday,
  '00:00:00'::time,
  '23:59:59'::time
from generate_series(0, 6) as weekday;

update public.availability_schedule_versions
set
  status = 'published',
  published_by_user_id = 'f1000000-0000-0000-0000-000000000001',
  published_at = now()
where id = 'f8000000-0000-0000-0000-000000000001';

insert into public.availability_publications (
  id,
  restaurant_id,
  location_id,
  schedule_version_id,
  effective_at,
  actor_user_id,
  authentication_assurance
)
values (
  'f9000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',
  'f8000000-0000-0000-0000-000000000001',
  now(),
  'f1000000-0000-0000-0000-000000000001',
  'aal2'
);

