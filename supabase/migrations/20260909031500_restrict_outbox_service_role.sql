revoke all on table public.outbox_events from service_role;
grant select, insert, update on table public.outbox_events to service_role;
