-- Public HTTP reads remain server-only SQL functions. No browser/table grants.
create function private.read_storefront_catalog(
  target_restaurant_slug text,
  target_location_slug text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_restaurant public.restaurants%rowtype;
  selected_location public.locations%rowtype;
  result_menus jsonb;
  evaluated_at timestamptz := statement_timestamp();
begin
  if target_restaurant_slug is null or target_location_slug is null
    or char_length(target_restaurant_slug) not between 3 and 63
    or char_length(target_location_slug) not between 2 and 63
    or target_restaurant_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or target_location_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    return null;
  end if;

  select restaurant.* into selected_restaurant
  from public.restaurants as restaurant
  where restaurant.slug = target_restaurant_slug and restaurant.status = 'active';

  select location.* into selected_location
  from public.locations as location
  where location.restaurant_id = selected_restaurant.id
    and location.slug = target_location_slug and location.status = 'active';

  if selected_location.id is null
    or not private.is_location_go_live(selected_restaurant.id, selected_location.id)
    or not private.is_restaurant_feature_enabled(selected_restaurant.id, 'catalog.public_menu')
    or not exists (select 1 from pg_catalog.pg_timezone_names where name = selected_location.timezone)
  then
    return null;
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', menu.id,
    'versionId', version.id,
    'name', menu.display_name,
    'currency', version.currency_code,
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', section.section_key,
        'name', section.display_name,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', item.menu_item_id,
            'name', item.display_name,
            'description', item.description,
            'priceAmountMinor', item.price_amount_minor,
            'availability', coalesce(availability.status, 'available')
          ) order by item.sort_order, item.menu_item_id)
          from public.menu_version_items as item
          left join public.menu_item_location_availability as availability
            on availability.restaurant_id = item.restaurant_id
            and availability.location_id = selected_location.id
            and availability.menu_id = item.menu_id
            and availability.menu_item_id = item.menu_item_id
          where item.restaurant_id = section.restaurant_id
            and item.menu_id = section.menu_id
            and item.menu_version_id = section.menu_version_id
            and item.section_key = section.section_key
            and item.is_active
        ), '[]'::jsonb)
      ) order by section.sort_order, section.section_key)
      from public.menu_version_sections as section
      where section.restaurant_id = version.restaurant_id
        and section.menu_id = version.menu_id
        and section.menu_version_id = version.id
    ), '[]'::jsonb)
  ) order by menu.slug, menu.id)
  into result_menus
  from public.menus as menu
  join public.menu_versions as version
    on version.restaurant_id = menu.restaurant_id and version.menu_id = menu.id
    and version.id = private.resolve_public_menu_version(
      selected_restaurant.id, selected_location.id, menu.id, evaluated_at
    )
  where menu.restaurant_id = selected_restaurant.id and menu.status = 'active';

  if result_menus is null then return null; end if;

  return jsonb_build_object(
    'restaurant', jsonb_build_object('slug', selected_restaurant.slug, 'name', selected_restaurant.display_name),
    'location', jsonb_build_object(
      'slug', selected_location.slug,
      'name', selected_location.display_name,
      'timezone', selected_location.timezone,
      'address', jsonb_build_object(
        'line1', selected_location.address_line_1, 'line2', selected_location.address_line_2,
        'postalCode', selected_location.postal_code, 'city', selected_location.city,
        'countryCode', selected_location.country_code
      )
    ),
    'menus', result_menus
  );
end;
$$;

create function private.read_storefront_availability(
  target_restaurant_slug text,
  target_location_slug text,
  target_fulfillment_type text,
  target_requested_for timestamptz,
  target_item_count integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_restaurant_id uuid;
  target_location_id uuid;
  result_available boolean;
  evaluated_at timestamptz := statement_timestamp();
begin
  if target_fulfillment_type is null or target_fulfillment_type not in ('pickup', 'delivery')
    or target_requested_for is null or not isfinite(target_requested_for)
    or target_item_count is null or target_item_count not between 1 and 1000
  then
    raise exception using errcode = '22023', message = 'invalid storefront availability input';
  end if;

  -- Same public visibility gate as the catalog, including an effective menu.
  if private.read_storefront_catalog(target_restaurant_slug, target_location_slug) is null then
    return null;
  end if;

  select restaurant.id, location.id into target_restaurant_id, target_location_id
  from public.restaurants as restaurant
  join public.locations as location on location.restaurant_id = restaurant.id
  where restaurant.slug = target_restaurant_slug and location.slug = target_location_slug;

  select availability.is_available into result_available
  from private.resolve_ordering_availability(
    target_restaurant_id, target_location_id, target_fulfillment_type,
    target_requested_for, target_item_count, evaluated_at
  ) as availability;

  -- Deliberately omit internal reasons, schedule IDs, slot keys and capacity figures.
  return jsonb_build_object(
    'status', case when result_available is true then 'available' else 'unavailable' end,
    'fulfillmentType', target_fulfillment_type,
    'requestedFor', to_char(target_requested_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'itemCount', target_item_count,
    'evaluatedAt', to_char(evaluated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

revoke all on function private.read_storefront_catalog(text, text) from public, anon, authenticated;
revoke all on function private.read_storefront_availability(text, text, text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function private.read_storefront_catalog(text, text) to service_role;
grant execute on function private.read_storefront_availability(text, text, text, timestamptz, integer)
  to service_role;

comment on function private.read_storefront_catalog(text, text) is
  'Server-only allowlisted public catalog. Null uniformly hides unknown or non-public scopes.';
comment on function private.read_storefront_availability(text, text, text, timestamptz, integer) is
  'Server-only non-reserving availability check; no internal reasons or capacity counters.';
