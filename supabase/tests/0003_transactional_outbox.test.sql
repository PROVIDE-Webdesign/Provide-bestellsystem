begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(34);

select has_table('public', 'outbox_events', 'outbox events table exists');
select has_column('public', 'outbox_events', 'id', 'outbox events have an id');
select has_column(
  'public',
  'outbox_events',
  'restaurant_id',
  'outbox events have a restaurant id'
);
select has_column('public', 'outbox_events', 'aggregate_type', 'outbox events have an aggregate type');
select has_column('public', 'outbox_events', 'aggregate_id', 'outbox events have an aggregate id');
select has_column('public', 'outbox_events', 'event_type', 'outbox events have an event type');
select has_column('public', 'outbox_events', 'event_version', 'outbox events have an event version');
select has_column('public', 'outbox_events', 'payload', 'outbox events have a payload');
select has_column(
  'public',
  'outbox_events',
  'idempotency_key',
  'outbox events have an idempotency key'
);
select has_column('public', 'outbox_events', 'status', 'outbox events have a status');
select has_column('public', 'outbox_events', 'attempt_count', 'outbox events track attempts');
select has_column('public', 'outbox_events', 'available_at', 'outbox events can be scheduled');
select has_column('public', 'outbox_events', 'locked_at', 'outbox events can be locked');
select has_column('public', 'outbox_events', 'published_at', 'outbox events track publication');
select has_column('public', 'outbox_events', 'last_error', 'outbox events track the last error');

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'outbox_events'
  ),
  'outbox events have row level security enabled'
);

select ok(
  (
    select relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'outbox_events'
  ),
  'outbox events force row level security'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'outbox_events'
  ),
  0,
  'outbox events deliberately define no browser policies'
);

select ok(
  not has_table_privilege('anon', 'public.outbox_events', 'select,insert,update,delete'),
  'anonymous users have no outbox privileges'
);
select ok(
  not has_table_privilege('authenticated', 'public.outbox_events', 'select,insert,update,delete'),
  'authenticated users have no outbox privileges'
);
select ok(
  has_table_privilege('service_role', 'public.outbox_events', 'select,insert,update'),
  'the server role can operate the outbox'
);
select ok(
  not has_table_privilege('service_role', 'public.outbox_events', 'delete'),
  'the server role cannot delete outbox events directly'
);

insert into public.restaurants (id, slug, display_name)
values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'outbox-test', 'Outbox Test'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'outbox-test-two', 'Outbox Test Two');

insert into public.outbox_events (
  restaurant_id,
  aggregate_type,
  aggregate_id,
  event_type,
  idempotency_key,
  payload
)
values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'order',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'order.created',
  'order-dddddddd-created',
  '{"order_id":"dddddddd-dddd-dddd-dddd-dddddddddddd"}'::jsonb
);

select is(
  (
    select status
    from public.outbox_events
    where idempotency_key = 'order-dddddddd-created'
  ),
  'pending',
  'new outbox events are pending by default'
);

select is(
  (
    select event_version
    from public.outbox_events
    where idempotency_key = 'order-dddddddd-created'
  ),
  1,
  'new outbox events use contract version one by default'
);

select throws_ok(
  $$
    insert into public.outbox_events (
      restaurant_id, aggregate_type, aggregate_id, event_type, idempotency_key
    ) values (
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'order',
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'order.created',
      'order-dddddddd-created'
    )
  $$,
  '23505',
  null,
  'idempotency keys are unique within a restaurant'
);

select lives_ok(
  $$
    insert into public.outbox_events (
      restaurant_id, aggregate_type, aggregate_id, event_type, idempotency_key
    ) values (
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'order',
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'order.created',
      'order-dddddddd-created'
    )
  $$,
  'the same idempotency key may be used by a different restaurant'
);

select throws_ok(
  $$
    insert into public.outbox_events (
      restaurant_id, aggregate_type, aggregate_id, event_type, event_version, idempotency_key
    ) values (
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'order',
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      'order.updated',
      0,
      'order-eeeeeeee-updated'
    )
  $$,
  '23514',
  null,
  'event versions must be positive'
);

select throws_ok(
  $$
    insert into public.outbox_events (
      restaurant_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) values (
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'order',
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      'Order Created',
      'order-eeeeeeee-created',
      '{}'::jsonb
    )
  $$,
  '23514',
  null,
  'event types must follow the event contract'
);

select throws_ok(
  $$
    insert into public.outbox_events (
      restaurant_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) values (
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'order',
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      'order.created',
      'order-eeeeeeee-created',
      '[]'::jsonb
    )
  $$,
  '23514',
  null,
  'event payloads must be JSON objects'
);

select throws_ok(
  $$
    update public.outbox_events
    set status = 'processing'
    where idempotency_key = 'order-dddddddd-created'
  $$,
  '23514',
  null,
  'processing events require a lock timestamp'
);

select throws_ok(
  $$
    update public.outbox_events
    set status = 'published'
    where idempotency_key = 'order-dddddddd-created'
  $$,
  '23514',
  null,
  'published events require a publication timestamp'
);

select throws_ok(
  $$
    update public.outbox_events
    set status = 'dead_letter'
    where idempotency_key = 'order-dddddddd-created'
  $$,
  '23514',
  null,
  'dead letter events require an error description'
);

set local role anon;

select throws_ok(
  $$select * from public.outbox_events$$,
  '42501',
  null,
  'anonymous users cannot query outbox events'
);

set local role authenticated;

select throws_ok(
  $$select * from public.outbox_events$$,
  '42501',
  null,
  'authenticated users cannot query outbox events'
);

select * from finish();

rollback;
