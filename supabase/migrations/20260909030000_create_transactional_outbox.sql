create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete restrict,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  event_version integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbox_events_aggregate_type_not_blank check (btrim(aggregate_type) <> ''),
  constraint outbox_events_event_type_format check (
    event_type ~ '^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$'
  ),
  constraint outbox_events_event_version_positive check (event_version > 0),
  constraint outbox_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint outbox_events_idempotency_key_length check (
    char_length(idempotency_key) between 8 and 200
  ),
  constraint outbox_events_status_allowed check (
    status in ('pending', 'processing', 'retry', 'published', 'dead_letter')
  ),
  constraint outbox_events_attempt_count_range check (attempt_count between 0 and 100),
  constraint outbox_events_processing_locked check (
    status <> 'processing' or locked_at is not null
  ),
  constraint outbox_events_published_timestamp check (
    (status = 'published') = (published_at is not null)
  ),
  constraint outbox_events_dead_letter_error check (
    status <> 'dead_letter' or nullif(btrim(last_error), '') is not null
  ),
  constraint outbox_events_restaurant_idempotency_unique unique (restaurant_id, idempotency_key)
);

create index outbox_events_dispatch_idx
  on public.outbox_events (available_at, created_at, id)
  where status in ('pending', 'retry');

create index outbox_events_restaurant_history_idx
  on public.outbox_events (restaurant_id, created_at desc, id);

create trigger outbox_events_set_updated_at
before update on public.outbox_events
for each row
execute function private.set_updated_at();

alter table public.outbox_events enable row level security;
alter table public.outbox_events force row level security;

revoke all on table public.outbox_events from public, anon, authenticated;
grant select, insert, update on table public.outbox_events to service_role;

comment on table public.outbox_events is
  'Tenant-bound integration events written transactionally and delivered asynchronously.';
comment on column public.outbox_events.idempotency_key is
  'Unique per restaurant and business operation; never a secret or customer identifier.';
comment on column public.outbox_events.payload is
  'Versioned event data. Must not contain credentials or unnecessary personal data.';
