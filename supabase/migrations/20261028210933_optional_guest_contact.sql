-- E112/E113: guest pickup requires a name and at least one contact method.
-- Preserve historical migrations, private function identities, role grants, immutable
-- snapshots, retention/purge rules and delivery's existing phone requirement.
alter table public.order_customer_contacts
  drop constraint order_customer_contacts_active_or_purged,
  add constraint order_customer_contacts_active_or_purged check (
    (purged_at is null and contact_name is not null and (phone_e164 is not null or email is not null))
    or (purged_at is not null and contact_name is null and phone_e164 is null and email is null)
  );

create or replace function private.store_guest_checkout_snapshot_before_email(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_order_id uuid,
  target_customer jsonb,
  target_delivery jsonb,
  target_privacy_notice_version text,
  target_retention_until timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_order public.orders%rowtype;
  existing_contact public.order_customer_contacts%rowtype;
  existing_delivery public.order_delivery_details%rowtype;
  normalized_contact_name text;
  normalized_phone text;
  normalized_email text;
  normalized_notice_version text := btrim(target_privacy_notice_version);
  normalized_address_line_1 text;
  normalized_address_line_2 text;
  normalized_postal_code text;
  normalized_city text;
  normalized_country_code text;
begin
  if target_customer is null or jsonb_typeof(target_customer) <> 'object' then
    raise exception using errcode = 'P0001', message = 'guest checkout customer data is invalid';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(target_customer) as customer_key(key_name)
    where customer_key.key_name not in ('contact_name', 'phone_e164', 'email')
  ) then
    raise exception using errcode = 'P0001', message = 'guest checkout customer data contains unsupported fields';
  end if;

  if jsonb_typeof(target_customer -> 'contact_name') is distinct from 'string'
    or (target_customer ? 'phone_e164' and jsonb_typeof(target_customer -> 'phone_e164') not in ('string', 'null'))
    or (target_customer ? 'email' and jsonb_typeof(target_customer -> 'email') not in ('string', 'null'))
    or target_customer ->> 'email' ~ '[[:cntrl:]]'
  then
    raise exception using errcode = 'P0001', message = 'guest checkout customer data is invalid';
  end if;

  normalized_contact_name := nullif(btrim(target_customer ->> 'contact_name'), '');
  normalized_phone := nullif(btrim(target_customer ->> 'phone_e164'), '');
  normalized_email := nullif(lower(btrim(target_customer ->> 'email')), '');

  if normalized_contact_name is null or char_length(normalized_contact_name) > 120 then
    raise exception using errcode = 'P0001', message = 'guest checkout contact name is invalid';
  end if;

  if normalized_phone is null and normalized_email is null then
    raise exception using errcode = 'P0001', message = 'guest checkout contact method is required';
  end if;

  if normalized_phone is not null and normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = 'P0001', message = 'guest checkout phone number is invalid';
  end if;

  if normalized_email is not null
    and (
      char_length(normalized_email) > 254
      or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  then
    raise exception using errcode = 'P0001', message = 'guest checkout email is invalid';
  end if;

  if normalized_notice_version is null
    or normalized_notice_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  then
    raise exception using errcode = 'P0001', message = 'privacy notice version is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_restaurant_id::text || ':' || target_location_id::text || ':' || target_order_id::text,
      0
    )
  );

  select order_record.*
  into selected_order
  from public.orders as order_record
  where order_record.restaurant_id = target_restaurant_id
    and order_record.location_id = target_location_id
    and order_record.id = target_order_id;

  if selected_order.id is null then
    raise exception using errcode = 'P0001', message = 'guest checkout order was not found';
  end if;

  if target_retention_until is null
    or target_retention_until <= selected_order.created_at
    or target_retention_until > selected_order.created_at + interval '730 days'
  then
    raise exception using errcode = 'P0001', message = 'guest checkout retention date is invalid';
  end if;

  if selected_order.fulfillment_type = 'delivery' then
    if normalized_phone is null then
      raise exception using errcode = 'P0001', message = 'delivery phone number is required';
    end if;

    if target_delivery is null or jsonb_typeof(target_delivery) <> 'object' then
      raise exception using errcode = 'P0001', message = 'delivery address is required';
    end if;

    if exists (
      select 1
      from jsonb_object_keys(target_delivery) as delivery_key(key_name)
      where delivery_key.key_name not in (
        'address_line_1',
        'address_line_2',
        'postal_code',
        'city',
        'country_code'
      )
    ) then
      raise exception using errcode = 'P0001', message = 'delivery address contains unsupported fields';
    end if;

    normalized_address_line_1 := nullif(btrim(target_delivery ->> 'address_line_1'), '');
    normalized_address_line_2 := nullif(btrim(target_delivery ->> 'address_line_2'), '');
    normalized_postal_code := nullif(btrim(target_delivery ->> 'postal_code'), '');
    normalized_city := nullif(btrim(target_delivery ->> 'city'), '');
    normalized_country_code := upper(nullif(btrim(target_delivery ->> 'country_code'), ''));

    if normalized_address_line_1 is null or char_length(normalized_address_line_1) > 200
      or normalized_address_line_2 is not null and char_length(normalized_address_line_2) > 200
      or normalized_postal_code is null or char_length(normalized_postal_code) > 20
      or normalized_city is null or char_length(normalized_city) > 120
      or normalized_country_code is null or normalized_country_code !~ '^[A-Z]{2}$'
    then
      raise exception using errcode = 'P0001', message = 'delivery address is invalid';
    end if;
  elsif target_delivery is not null and target_delivery not in ('null'::jsonb, '{}'::jsonb) then
    raise exception using errcode = 'P0001', message = 'pickup orders cannot store delivery data';
  end if;

  select contact.*
  into existing_contact
  from public.order_customer_contacts as contact
  where contact.restaurant_id = target_restaurant_id
    and contact.order_id = target_order_id;

  if existing_contact.order_id is not null then
    select delivery.*
    into existing_delivery
    from public.order_delivery_details as delivery
    where delivery.restaurant_id = target_restaurant_id
      and delivery.order_id = target_order_id;

    if existing_contact.purged_at is null
      and existing_contact.location_id = target_location_id
      and existing_contact.contact_name = normalized_contact_name
      and existing_contact.phone_e164 is not distinct from normalized_phone
      and existing_contact.email is not distinct from normalized_email
      and existing_contact.privacy_notice_version = normalized_notice_version
      and existing_contact.retention_until = target_retention_until
      and (
        (
          selected_order.fulfillment_type = 'pickup'
          and existing_delivery.order_id is null
        )
        or (
          selected_order.fulfillment_type = 'delivery'
          and existing_delivery.purged_at is null
          and existing_delivery.location_id = target_location_id
          and existing_delivery.recipient_name = normalized_contact_name
          and existing_delivery.phone_e164 = normalized_phone
          and existing_delivery.address_line_1 = normalized_address_line_1
          and existing_delivery.address_line_2 is not distinct from normalized_address_line_2
          and existing_delivery.postal_code = normalized_postal_code
          and existing_delivery.city = normalized_city
          and existing_delivery.country_code = normalized_country_code
          and existing_delivery.retention_until = target_retention_until
        )
      )
    then
      return target_order_id;
    end if;

    raise exception using errcode = 'P0001', message = 'guest checkout snapshot conflicts with the existing order';
  end if;

  insert into public.order_customer_contacts (
    restaurant_id,
    location_id,
    order_id,
    contact_name,
    phone_e164,
    email,
    privacy_notice_version,
    retention_until,
    created_at
  )
  values (
    target_restaurant_id,
    target_location_id,
    target_order_id,
    normalized_contact_name,
    normalized_phone,
    normalized_email,
    normalized_notice_version,
    target_retention_until,
    selected_order.created_at
  );

  if selected_order.fulfillment_type = 'delivery' then
    insert into public.order_delivery_details (
      restaurant_id,
      location_id,
      order_id,
      recipient_name,
      phone_e164,
      address_line_1,
      address_line_2,
      postal_code,
      city,
      country_code,
      retention_until,
      created_at
    )
    values (
      target_restaurant_id,
      target_location_id,
      target_order_id,
      normalized_contact_name,
      normalized_phone,
      normalized_address_line_1,
      normalized_address_line_2,
      normalized_postal_code,
      normalized_city,
      normalized_country_code,
      target_retention_until,
      selected_order.created_at
    );
  end if;

  return target_order_id;
end;
$$;

create or replace function private.store_guest_checkout_snapshot(
  target_restaurant_id uuid,target_location_id uuid,target_order_id uuid,target_customer jsonb,
  target_delivery jsonb,target_privacy_notice_version text,target_retention_until timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.orders o where o.restaurant_id=target_restaurant_id
    and o.location_id=target_location_id and o.id=target_order_id) then
    raise exception using errcode='P0001',message='guest checkout order was not found';
  end if;
  if target_customer->>'email' ~ '[[:cntrl:]]' then
    raise exception using errcode='P0001',message='guest checkout email is invalid';
  end if;
  return private.store_guest_checkout_snapshot_before_email(target_restaurant_id,target_location_id,
    target_order_id,target_customer,target_delivery,target_privacy_notice_version,target_retention_until);
end;
$$;
revoke all on function private.store_guest_checkout_snapshot(uuid,uuid,uuid,jsonb,jsonb,text,timestamptz)
  from public,anon,authenticated,service_role;

revoke all on function private.store_guest_checkout_snapshot_before_email(uuid,uuid,uuid,jsonb,jsonb,text,timestamptz)
  from public,anon,authenticated,service_role;
