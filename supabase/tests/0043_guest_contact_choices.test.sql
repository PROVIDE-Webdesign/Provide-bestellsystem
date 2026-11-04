begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select no_plan();
\ir fixtures/storefront.fixture.inc

select lives_ok($sql$
create function pg_temp.contact_order(k text, c jsonb) returns jsonb language sql as $helper$
  select private.submit_public_guest_pickup_order(
    'storefront-restaurant-a', 'storefront-a-mitte',
    'f4000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001',
    date_trunc('hour',now()) + interval '2 hours',
    '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
    k, c, 'preview-v1', 14
  );
$helper$;
$sql$, 'prepare disposable public checkout helper');

select lives_ok($sql$
do $test$
declare c jsonb; result jsonb; retry jsonb; stored public.order_customer_contacts; n integer := 0; absent text;
begin
  for c in select value from jsonb_array_elements('[
    {"contact_name":"Synthetic Guest","phone_e164":"+999100000001"},
    {"contact_name":"Synthetic Guest","email":" GUEST@Example.invalid "},
    {"contact_name":"Synthetic Guest","phone_e164":"+999100000001","email":"guest@example.invalid"}
  ]') loop
    n := n + 1;
    result := pg_temp.contact_order('contact-choice-valid-' || n, c);
    select * into strict stored from public.order_customer_contacts where order_id=(result->>'orderId')::uuid;
    if stored.contact_name <> 'Synthetic Guest'
      or stored.phone_e164 is distinct from c->>'phone_e164'
      or stored.email is distinct from nullif(lower(btrim(c->>'email')),'')
      or stored.retention_until <> stored.created_at + interval '14 days'
    then raise exception 'Contact snapshot or retention differs'; end if;
    retry := pg_temp.contact_order('contact-choice-valid-' || n, c);
    if result <> retry then raise exception 'Identical retry changed the order'; end if;
    if n < 3 then
      absent := case when n=1 then 'email' else 'phone_e164' end;
      retry := pg_temp.contact_order('contact-choice-valid-' || n, c || jsonb_build_object(absent,null));
      if result <> retry then raise exception 'Null retry differs from omitted contact'; end if;
      retry := pg_temp.contact_order('contact-choice-valid-' || n, c || jsonb_build_object(absent,'  '));
      if result <> retry then raise exception 'Empty retry differs from omitted contact'; end if;
      begin
        perform pg_temp.contact_order('contact-choice-valid-' || n,
          c || jsonb_build_object(absent,case when n=1 then 'changed@example.invalid' else '+999100000002' end));
        raise exception 'Changed contact was accepted';
      exception when sqlstate 'P0001' then
        if sqlerrm <> 'guest checkout snapshot conflicts with the existing order' then raise; end if;
      end;
    end if;
  end loop;
  if (select count(*) from public.orders where submission_key like 'contact-choice-valid-%') <> 3 then
    raise exception 'Retry created another order';
  end if;
end $test$;
$sql$, 'phone only and email only normalize and retry without a second order');

select lives_ok($sql$
do $test$
declare c jsonb; n integer := 0; before_count bigint;
begin
  select count(*) into before_count from public.orders;
  for c in select value from jsonb_array_elements('[
    {"contact_name":"Synthetic Guest"},
    {"contact_name":"Synthetic Guest","phone_e164":null,"email":null},
    {"contact_name":"Synthetic Guest","phone_e164":" ","email":" "},
    {"contact_name":" ","email":"guest@example.invalid"},
    {"contact_name":"Synthetic Guest","phone_e164":"0170","email":"guest@example.invalid"},
    {"contact_name":"Synthetic Guest","phone_e164":"+999100000001","email":"invalid"},
    {"contact_name":"Synthetic Guest","phone_e164":123,"email":"guest@example.invalid"},
    {"contact_name":"Synthetic Guest","phone_e164":"+999100000001","email":[]}
  ]') loop
    n := n + 1;
    begin
      perform pg_temp.contact_order('contact-choice-invalid-' || n,c);
      raise exception 'Invalid contact was accepted';
    exception when sqlstate 'P0001' then
      if sqlerrm = 'Invalid contact was accepted' then raise; end if;
    end;
  end loop;
  if (select count(*) from public.orders) <> before_count then raise exception 'Invalid contact left an order behind'; end if;
end $test$;
$sql$, 'missing contacts and malformed additional fields roll back the complete order');

select lives_ok($sql$
do $test$
begin
  perform private.claim_email_deliveries('fd100000-0000-0000-0000-000000000043',25,statement_timestamp()+interval '1 second');
  if not exists(select 1 from private.email_deliveries d join public.orders o on o.id=d.order_id
    where o.submission_key='contact-choice-valid-1' and d.status='suppressed' and d.last_error_code='contact_unavailable')
  then raise exception 'Missing email was not suppressed'; end if;
  perform private.claim_notification_deliveries('fd100000-0000-0000-0000-000000000044',25,statement_timestamp()+interval '1 second');
  if not exists(select 1 from public.notification_deliveries d join public.orders o on o.id=d.order_id
    where o.submission_key='contact-choice-valid-2' and d.status='suppressed' and d.last_error_code='contact_unavailable')
  then raise exception 'Missing phone was not suppressed'; end if;
  if exists(select 1 from public.outbox_events where payload::text like '%guest@example.invalid%' or payload::text like '%+999100000001%')
  then raise exception 'Contact leaked into outbox'; end if;
end $test$;
$sql$, 'missing mail and SMS recipients are suppressed without leaking contacts');

select lives_ok($sql$
do $test$
begin
  if has_function_privilege('service_role','private.store_guest_checkout_snapshot_before_email(uuid,uuid,uuid,jsonb,jsonb,text,timestamptz)','execute')
    or has_function_privilege('anon','private.store_guest_checkout_snapshot(uuid,uuid,uuid,jsonb,jsonb,text,timestamptz)','execute')
    or has_function_privilege('authenticated','private.store_guest_checkout_snapshot(uuid,uuid,uuid,jsonb,jsonb,text,timestamptz)','execute')
  then raise exception 'Snapshot boundary permissions widened'; end if;
end $test$;
set local role service_role;
select pg_temp.contact_order('contact-choice-service-1','{"contact_name":"Synthetic","email":"service@example.invalid"}');
reset role;
$sql$, 'private boundaries stay closed and the server can submit email only');

\ir fixtures/delivery.fixture.inc
select lives_ok($sql$
do $test$
declare result jsonb; policy uuid; quote jsonb;
begin
  policy := private.create_delivery_policy('f1000000-0000-0000-0000-000000000001','aal2',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
    '[{"postalCodes":["52062"],"minimumAmountMinor":0,"feeAmountMinor":0}]');
  perform private.publish_delivery_policy('f1000000-0000-0000-0000-000000000001','aal2',
    'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',policy);
  quote := private.quote_public_delivery_order('storefront-restaurant-a','storefront-a-mitte',
    'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+interval '2 hours',
    '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]','52062');
  begin
    perform private.submit_public_guest_delivery_order(
      'storefront-restaurant-a', 'storefront-a-mitte',
      'f4000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001',
      date_trunc('hour',now())+interval '2 hours',
      '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]', 'contact-choice-delivery-invalid',
      '{"contact_name":"Synthetic","email":"guest@example.invalid"}',
      '{"address_line_1":"TEST Weg 1","postal_code":"52062","city":"TEST Stadt","country_code":"DE"}',
      quote, 'preview-v1', 14
    );
    raise exception 'Delivery without phone was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'delivery phone number is required' then raise; end if;
  end;
  result := private.submit_public_guest_delivery_order(
    'storefront-restaurant-a', 'storefront-a-mitte',
    'f4000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001',
    date_trunc('hour',now())+interval '2 hours',
    '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]', 'contact-choice-delivery-valid',
    '{"contact_name":"Synthetic","phone_e164":"+999100000001","email":null}',
    '{"address_line_1":"TEST Weg 1","postal_code":"52062","city":"TEST Stadt","country_code":"DE"}',
    quote, 'preview-v1', 14
  );
  if not exists(select 1 from public.order_delivery_details where order_id=(result->>'orderId')::uuid and phone_e164='+999100000001')
    then raise exception 'Delivery phone was lost'; end if;
end $test$;
$sql$, 'delivery keeps its phone requirement and accepts no email');

select * from finish();
rollback;
