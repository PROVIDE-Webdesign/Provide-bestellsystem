begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select no_plan();
\ir fixtures/storefront.fixture.inc

select has_table('public', 'notification_deliveries', 'notification delivery ledger exists');
select has_function(
  'private',
  'claim_notification_deliveries',
  array['uuid','integer','timestamptz'],
  'bounded notification claim function exists'
);
select has_function(
  'private',
  'finish_notification_delivery',
  array['uuid','uuid','text','text','timestamptz'],
  'owned notification completion function exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.claim_notification_deliveries(uuid,integer,timestamptz)',
    'execute'
  ),
  'service worker may claim notification deliveries'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.claim_notification_deliveries(uuid,integer,timestamptz)',
    'execute'
  ),
  'authenticated browsers cannot claim notifications'
);
select ok(
  not has_table_privilege('service_role', 'public.notification_deliveries', 'select'),
  'service role cannot bypass notification functions with direct reads'
);

set local role service_role;
select private.submit_public_guest_pickup_order(
  'storefront-restaurant-a',
  'storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001',
  'f5000000-0000-0000-0000-000000000001',
  date_trunc('hour', now()) + interval '2 hours',
  '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]',
  'notification-order-key-0001',
  '{"contact_name":"Synthetic Notify Guest","phone_e164":"+999100000011","email":null}',
  'preview-v1',
  30
) as first_confirmation \gset
reset role;

select is(
  (
    select count(*)::integer
    from public.notification_deliveries
    where order_id = (:'first_confirmation'::jsonb ->> 'orderId')::uuid
  ),
  1,
  'order submission creates exactly one SMS delivery'
);
select is(
  (
    select template_key
    from public.notification_deliveries
    where order_id = (:'first_confirmation'::jsonb ->> 'orderId')::uuid
  ),
  'order_submitted',
  'submission selects the versioned submitted template'
);
select ok(
  position(
    '+999100000011' in (
      select row_to_json(delivery)::text
      from public.notification_deliveries as delivery
      where delivery.order_id = (:'first_confirmation'::jsonb ->> 'orderId')::uuid
    )
  ) = 0,
  'delivery ledger stores no destination phone number'
);
select ok(
  not exists (
    select 1
    from public.outbox_events
    where aggregate_id = (:'first_confirmation'::jsonb ->> 'orderId')::uuid
      and payload::text like '%999100000011%'
  ),
  'order outbox payload remains free of the destination phone number'
);

set local role service_role;
select private.claim_notification_deliveries(
  'fa100000-0000-0000-0000-000000000001',
  25,
  now() + interval '1 minute'
) as first_claim \gset
select is(jsonb_array_length(:'first_claim'::jsonb), 1, 'due delivery is claimed once');
select is(
  :'first_claim'::jsonb #>> '{0,phoneE164}',
  '+999100000011',
  'protected phone is released only in the claimed server projection'
);
select is(
  :'first_claim'::jsonb #>> '{0,templateKey}',
  'order_submitted',
  'claim returns the exact template contract'
);
select is(
  jsonb_array_length(private.claim_notification_deliveries(
    'fa100000-0000-0000-0000-000000000002',
    25,
    now() + interval '1 minute'
  )),
  0,
  'another worker cannot claim a currently locked delivery'
);
select is(
  private.finish_notification_delivery(
    (:'first_claim'::jsonb #>> '{0,deliveryId}')::uuid,
    'fa100000-0000-0000-0000-000000000099',
    'accepted',
    null,
    now() + interval '1 minute'
  ),
  'conflict',
  'a worker cannot complete another lock owner'
);
select is(
  private.finish_notification_delivery(
    (:'first_claim'::jsonb #>> '{0,deliveryId}')::uuid,
    'fa100000-0000-0000-0000-000000000001',
    'accepted',
    null,
    now() + interval '1 minute'
  ),
  'sent',
  'accepted adapter response marks the delivery sent'
);
reset role;
select is(
  (
    select attempt_count
    from public.notification_deliveries
    where order_id = (:'first_confirmation'::jsonb ->> 'orderId')::uuid
  ),
  1,
  'successful delivery records exactly one attempt'
);

set local role service_role;
select private.transition_order_status(
  'f2000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',
  (:'first_confirmation'::jsonb ->> 'orderId')::uuid,
  'accepted',
  'f1000000-0000-0000-0000-000000000001',
  'aal2'
);
select private.claim_notification_deliveries(
  'fa100000-0000-0000-0000-000000000003',
  25,
  now() + interval '2 minutes'
) as accepted_claim \gset
select is(
  private.finish_notification_delivery(
    (:'accepted_claim'::jsonb #>> '{0,deliveryId}')::uuid,
    'fa100000-0000-0000-0000-000000000003',
    'temporary_failure',
    'provider_timeout',
    now() + interval '2 minutes'
  ),
  'retry',
  'temporary adapter failure schedules a retry'
);
select is(
  jsonb_array_length(private.claim_notification_deliveries(
    'fa100000-0000-0000-0000-000000000004',
    25,
    now() + interval '2 minutes 29 seconds'
  )),
  0,
  'retry cannot be claimed before its bounded delay'
);
select private.claim_notification_deliveries(
  'fa100000-0000-0000-0000-000000000005',
  25,
  now() + interval '2 minutes 31 seconds'
) as retry_claim \gset
select is(jsonb_array_length(:'retry_claim'::jsonb), 1, 'retry becomes claimable after its delay');
select is(
  private.finish_notification_delivery(
    (:'retry_claim'::jsonb #>> '{0,deliveryId}')::uuid,
    'fa100000-0000-0000-0000-000000000005',
    'accepted',
    null,
    now() + interval '2 minutes 31 seconds'
  ),
  'sent',
  'retry uses the same delivery and can finish successfully'
);

select private.transition_order_status(
  'f2000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',
  (:'first_confirmation'::jsonb ->> 'orderId')::uuid,
  'preparing',
  'f1000000-0000-0000-0000-000000000001',
  'aal2'
);
reset role;
select is(
  (
    select count(*)::integer
    from public.notification_deliveries
    where order_id = (:'first_confirmation'::jsonb ->> 'orderId')::uuid
  ),
  2,
  'preparing status intentionally creates no guest notification'
);

set local role service_role;
select private.submit_public_guest_pickup_order(
  'storefront-restaurant-a','storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
  date_trunc('hour', now()) + interval '3 hours',
  '[{"menu_item_id":"f6000000-0000-0000-0000-000000000002","quantity":1}]',
  'notification-order-key-0002',
  '{"contact_name":"Superseded Synthetic Guest","phone_e164":"+999100000012","email":null}',
  'preview-v1',30
) as second_confirmation \gset
select private.transition_order_status(
  'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  (:'second_confirmation'::jsonb ->> 'orderId')::uuid,'accepted',
  'f1000000-0000-0000-0000-000000000001','aal2'
);
select private.claim_notification_deliveries(
  'fa100000-0000-0000-0000-000000000006',25,now() + interval '3 minutes'
) as superseded_claim \gset
select is(
  jsonb_array_length(:'superseded_claim'::jsonb),
  1,
  'only the current status notification is dispatched'
);
select is(
  :'superseded_claim'::jsonb #>> '{0,targetStatus}',
  'accepted',
  'newest applicable status supersedes the stale submission message'
);
select private.finish_notification_delivery(
  (:'superseded_claim'::jsonb #>> '{0,deliveryId}')::uuid,
  'fa100000-0000-0000-0000-000000000006','accepted',null,now() + interval '3 minutes'
);
reset role;
select is(
  (
    select status
    from public.notification_deliveries
    where order_id = (:'second_confirmation'::jsonb ->> 'orderId')::uuid
      and target_status = 'submitted'
  ),
  'suppressed',
  'stale status delivery is recorded as suppressed'
);

set local role service_role;
select private.submit_public_guest_pickup_order(
  'storefront-restaurant-a','storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
  date_trunc('hour', now()) + interval '4 hours',
  '[{"menu_item_id":"f6000000-0000-0000-0000-000000000002","quantity":1}]',
  'notification-order-key-0003',
  '{"contact_name":"Purged Synthetic Guest","phone_e164":"+999100000013","email":null}',
  'preview-v1',30
) as third_confirmation \gset
reset role;
update public.order_customer_contacts
set contact_name = null, phone_e164 = null, email = null, purged_at = now()
where order_id = (:'third_confirmation'::jsonb ->> 'orderId')::uuid;
set local role service_role;
select is(
  jsonb_array_length(private.claim_notification_deliveries(
    'fa100000-0000-0000-0000-000000000007',25,now() + interval '4 minutes'
  )),
  0,
  'purged contact is never returned to the worker'
);
reset role;
select is(
  (
    select status
    from public.notification_deliveries
    where order_id = (:'third_confirmation'::jsonb ->> 'orderId')::uuid
  ),
  'suppressed',
  'purged contact suppresses the pending notification'
);
select is(
  (
    select last_error_code
    from public.notification_deliveries
    where order_id = (:'third_confirmation'::jsonb ->> 'orderId')::uuid
  ),
  'contact_unavailable',
  'suppression stores only an allowlisted non-personal reason'
);

set local role service_role;
select private.submit_public_guest_pickup_order(
  'storefront-restaurant-a','storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
  date_trunc('hour', now()) + interval '5 hours',
  '[{"menu_item_id":"f6000000-0000-0000-0000-000000000002","quantity":1}]',
  'notification-order-key-0004',
  '{"contact_name":"Dead Letter Synthetic Guest","phone_e164":"+999100000014","email":null}',
  'preview-v1',30
) as fourth_confirmation \gset
reset role;
update public.notification_deliveries
set attempt_count = 5
where order_id = (:'fourth_confirmation'::jsonb ->> 'orderId')::uuid;
set local role service_role;
select private.claim_notification_deliveries(
  'fa100000-0000-0000-0000-000000000008',25,now() + interval '5 minutes'
) as final_claim \gset
select is(
  private.finish_notification_delivery(
    (:'final_claim'::jsonb #>> '{0,deliveryId}')::uuid,
    'fa100000-0000-0000-0000-000000000008',
    'temporary_failure','provider_timeout',now() + interval '5 minutes'
  ),
  'dead_letter',
  'sixth temporary failure reaches the bounded dead letter state'
);
reset role;
select is(
  (
    select attempt_count
    from public.notification_deliveries
    where order_id = (:'fourth_confirmation'::jsonb ->> 'orderId')::uuid
  ),
  6,
  'dead letter never exceeds the six-attempt boundary'
);

set local role service_role;
select private.submit_public_guest_pickup_order(
  'storefront-restaurant-a','storefront-a-mitte',
  'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
  date_trunc('hour', now()) + interval '6 hours',
  '[{"menu_item_id":"f6000000-0000-0000-0000-000000000002","quantity":1}]',
  'notification-order-key-0005',
  '{"contact_name":"Lock Synthetic Guest","phone_e164":"+999100000015","email":null}',
  'preview-v1',30
) as fifth_confirmation \gset
select private.claim_notification_deliveries(
  'fa100000-0000-0000-0000-000000000009',25,now() + interval '6 minutes'
) as abandoned_claim \gset
select private.claim_notification_deliveries(
  'fa100000-0000-0000-0000-000000000010',25,now() + interval '12 minutes'
) as reclaimed_claim \gset
select is(
  jsonb_array_length(:'reclaimed_claim'::jsonb),
  1,
  'expired worker lock is reclaimed in a bounded later batch'
);
select is(
  :'reclaimed_claim'::jsonb #>> '{0,lockToken}',
  'fa100000-0000-0000-0000-000000000010',
  'reclaimed delivery belongs only to the new worker token'
);
select is(
  private.finish_notification_delivery(
    (:'reclaimed_claim'::jsonb #>> '{0,deliveryId}')::uuid,
    'fa100000-0000-0000-0000-000000000010',
    'permanent_failure','destination_rejected',now() + interval '12 minutes'
  ),
  'dead_letter',
  'permanent adapter failure enters dead letter without another retry'
);
reset role;
select is(
  (
    select attempt_count
    from public.notification_deliveries
    where order_id = (:'fifth_confirmation'::jsonb ->> 'orderId')::uuid
  ),
  2,
  'reclaimed delivery retains the abandoned attempt count'
);

select * from finish();
rollback;
