create table public.order_customer_contacts (
  restaurant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  contact_name text,
  phone_e164 text,
  email text,
  privacy_notice_version text not null,
  retention_until timestamptz not null,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, order_id),
  constraint order_customer_contacts_order_fk
    foreign key (restaurant_id, location_id, order_id)
    references public.orders (restaurant_id, location_id, id)
    on delete restrict,
  constraint order_customer_contacts_active_or_purged check (
    (
      purged_at is null
      and contact_name is not null
      and phone_e164 is not null
    )
    or (
      purged_at is not null
      and contact_name is null
      and phone_e164 is null
      and email is null
    )
  ),
  constraint order_customer_contacts_name_length check (
    contact_name is null or char_length(contact_name) between 1 and 120
  ),
  constraint order_customer_contacts_phone_format check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint order_customer_contacts_email_length check (
    email is null or char_length(email) <= 254
  ),
  constraint order_customer_contacts_email_format check (
    email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint order_customer_contacts_notice_version_format check (
    privacy_notice_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  ),
  constraint order_customer_contacts_retention_after_creation check (
    retention_until > created_at
  ),
  constraint order_customer_contacts_purge_after_creation check (
    purged_at is null or purged_at >= created_at
  )
);

create index order_customer_contacts_retention_idx
  on public.order_customer_contacts (retention_until, order_id)
  where purged_at is null;

create table public.order_delivery_details (
  restaurant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  recipient_name text,
  phone_e164 text,
  address_line_1 text,
  address_line_2 text,
  postal_code text,
  city text,
  country_code text,
  retention_until timestamptz not null,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, order_id),
  constraint order_delivery_details_order_fk
    foreign key (restaurant_id, location_id, order_id)
    references public.orders (restaurant_id, location_id, id)
    on delete restrict,
  constraint order_delivery_details_active_or_purged check (
    (
      purged_at is null
      and recipient_name is not null
      and phone_e164 is not null
      and address_line_1 is not null
      and postal_code is not null
      and city is not null
      and country_code is not null
    )
    or (
      purged_at is not null
      and recipient_name is null
      and phone_e164 is null
      and address_line_1 is null
      and address_line_2 is null
      and postal_code is null
      and city is null
      and country_code is null
    )
  ),
  constraint order_delivery_details_recipient_length check (
    recipient_name is null or char_length(recipient_name) between 1 and 120
  ),
  constraint order_delivery_details_phone_format check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint order_delivery_details_address_1_length check (
    address_line_1 is null or char_length(address_line_1) between 1 and 200
  ),
  constraint order_delivery_details_address_2_length check (
    address_line_2 is null or char_length(address_line_2) between 1 and 200
  ),
  constraint order_delivery_details_postal_code_length check (
    postal_code is null or char_length(postal_code) between 1 and 20
  ),
  constraint order_delivery_details_city_length check (
    city is null or char_length(city) between 1 and 120
  ),
  constraint order_delivery_details_country_format check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  ),
  constraint order_delivery_details_retention_after_creation check (
    retention_until > created_at
  ),
  constraint order_delivery_details_purge_after_creation check (
    purged_at is null or purged_at >= created_at
  )
);

create index order_delivery_details_retention_idx
  on public.order_delivery_details (retention_until, order_id)
  where purged_at is null;

create function private.protect_order_customer_contact_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.purged_at is null
    and new.purged_at is not null
    and new.restaurant_id is not distinct from old.restaurant_id
    and new.location_id is not distinct from old.location_id
    and new.order_id is not distinct from old.order_id
    and new.contact_name is null
    and new.phone_e164 is null
    and new.email is null
    and new.privacy_notice_version is not distinct from old.privacy_notice_version
    and new.retention_until is not distinct from old.retention_until
    and new.created_at is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception using errcode = '23514', message = 'order customer contact is immutable';
end;
$$;

create function private.protect_order_delivery_detail_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.purged_at is null
    and new.purged_at is not null
    and new.restaurant_id is not distinct from old.restaurant_id
    and new.location_id is not distinct from old.location_id
    and new.order_id is not distinct from old.order_id
    and new.recipient_name is null
    and new.phone_e164 is null
    and new.address_line_1 is null
    and new.address_line_2 is null
    and new.postal_code is null
    and new.city is null
    and new.country_code is null
    and new.retention_until is not distinct from old.retention_until
    and new.created_at is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception using errcode = '23514', message = 'order delivery detail is immutable';
end;
$$;

create function private.prevent_order_personal_data_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'order personal data cannot be deleted directly';
end;
$$;

create trigger order_customer_contacts_protect_update
before update on public.order_customer_contacts
for each row
execute function private.protect_order_customer_contact_update();

create trigger order_customer_contacts_prevent_delete
before delete on public.order_customer_contacts
for each row
execute function private.prevent_order_personal_data_delete();

create trigger order_delivery_details_protect_update
before update on public.order_delivery_details
for each row
execute function private.protect_order_delivery_detail_update();

create trigger order_delivery_details_prevent_delete
before delete on public.order_delivery_details
for each row
execute function private.prevent_order_personal_data_delete();

create function private.store_guest_checkout_snapshot(
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

  normalized_contact_name := nullif(btrim(target_customer ->> 'contact_name'), '');
  normalized_phone := nullif(btrim(target_customer ->> 'phone_e164'), '');
  normalized_email := nullif(lower(btrim(target_customer ->> 'email')), '');

  if normalized_contact_name is null or char_length(normalized_contact_name) > 120 then
    raise exception using errcode = 'P0001', message = 'guest checkout contact name is invalid';
  end if;

  if normalized_phone is null or normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
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
      and existing_contact.phone_e164 = normalized_phone
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

create function private.submit_guest_order(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_menu_id uuid,
  target_menu_version_id uuid,
  target_fulfillment_type text,
  target_requested_for timestamptz,
  target_lines jsonb,
  target_submission_key text,
  target_customer jsonb,
  target_delivery jsonb,
  target_privacy_notice_version text,
  target_retention_until timestamptz,
  target_evaluated_at timestamptz default now(),
  target_payment_collection_mode text default 'on_fulfillment'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_order_id uuid;
begin
  created_order_id := private.submit_order_with_payment(
    target_restaurant_id,
    target_location_id,
    target_menu_id,
    target_menu_version_id,
    target_fulfillment_type,
    target_requested_for,
    target_lines,
    target_submission_key,
    target_evaluated_at,
    target_payment_collection_mode
  );

  perform private.store_guest_checkout_snapshot(
    target_restaurant_id,
    target_location_id,
    created_order_id,
    target_customer,
    target_delivery,
    target_privacy_notice_version,
    target_retention_until
  );

  return created_order_id;
end;
$$;

create function private.purge_expired_guest_checkout_data(
  target_before timestamptz default now(),
  target_batch_size integer default 500
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_order_ids uuid[];
  purged_count integer;
begin
  if target_before is null then
    raise exception using errcode = 'P0001', message = 'personal data purge cutoff is required';
  end if;

  if target_batch_size is null or target_batch_size < 1 or target_batch_size > 5000 then
    raise exception using errcode = 'P0001', message = 'personal data purge batch size is invalid';
  end if;

  select coalesce(array_agg(candidate.order_id), array[]::uuid[])
  into selected_order_ids
  from (
    select contact.order_id
    from public.order_customer_contacts as contact
    join public.orders as order_record
      on order_record.restaurant_id = contact.restaurant_id
      and order_record.location_id = contact.location_id
      and order_record.id = contact.order_id
    where contact.purged_at is null
      and contact.retention_until <= target_before
      and order_record.status in ('completed', 'rejected', 'cancelled')
    order by contact.retention_until, contact.order_id
    limit target_batch_size
    for update of contact skip locked
  ) as candidate;

  purged_count := cardinality(selected_order_ids);

  if purged_count = 0 then
    return 0;
  end if;

  update public.order_delivery_details
  set
    recipient_name = null,
    phone_e164 = null,
    address_line_1 = null,
    address_line_2 = null,
    postal_code = null,
    city = null,
    country_code = null,
    purged_at = target_before
  where order_id = any(selected_order_ids)
    and purged_at is null;

  update public.order_customer_contacts
  set
    contact_name = null,
    phone_e164 = null,
    email = null,
    purged_at = target_before
  where order_id = any(selected_order_ids)
    and purged_at is null;

  return purged_count;
end;
$$;

alter table public.order_customer_contacts enable row level security;
alter table public.order_customer_contacts force row level security;
alter table public.order_delivery_details enable row level security;
alter table public.order_delivery_details force row level security;

create policy order_customer_contacts_select_management
on public.order_customer_contacts
for select
to authenticated
using (
  purged_at is null
  and private.has_restaurant_role(restaurant_id, array['owner', 'manager']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

create policy order_delivery_details_select_fulfillment
on public.order_delivery_details
for select
to authenticated
using (
  purged_at is null
  and private.has_restaurant_role(restaurant_id, array['owner', 'manager', 'driver']::text[])
  and private.can_access_location(restaurant_id, location_id)
);

revoke all on table public.order_customer_contacts from public, anon, authenticated, service_role;
revoke all on table public.order_delivery_details from public, anon, authenticated, service_role;

grant select on table public.order_customer_contacts to authenticated;
grant select on table public.order_delivery_details to authenticated;

revoke all on function private.protect_order_customer_contact_update() from public;
revoke all on function private.protect_order_delivery_detail_update() from public;
revoke all on function private.prevent_order_personal_data_delete() from public;
revoke all on function private.store_guest_checkout_snapshot(
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb,
  text,
  timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.submit_guest_order(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  jsonb,
  text,
  jsonb,
  jsonb,
  text,
  timestamptz,
  timestamptz,
  text
) from public, anon, authenticated;
revoke all on function private.purge_expired_guest_checkout_data(timestamptz, integer)
  from public, anon, authenticated;

grant execute on function private.submit_guest_order(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  jsonb,
  text,
  jsonb,
  jsonb,
  text,
  timestamptz,
  timestamptz,
  text
) to service_role;
grant execute on function private.purge_expired_guest_checkout_data(timestamptz, integer)
  to service_role;

comment on table public.order_customer_contacts is
  'Purpose-limited guest order contact snapshot. Kitchen and driver roles cannot read this table.';
comment on table public.order_delivery_details is
  'Purpose-limited delivery handover snapshot visible only to assigned management and drivers.';
comment on function private.store_guest_checkout_snapshot(
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb,
  text,
  timestamptz
) is
  'Stores normalized, immutable and idempotent guest checkout personal data for an existing order.';
comment on function private.submit_guest_order(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  jsonb,
  text,
  jsonb,
  jsonb,
  text,
  timestamptz,
  timestamptz,
  text
) is
  'Atomically submits an order, creates its payment requirement and stores minimal guest checkout data.';
comment on function private.purge_expired_guest_checkout_data(timestamptz, integer) is
  'Irreversibly purges expired personal data for terminal orders in bounded batches.';
