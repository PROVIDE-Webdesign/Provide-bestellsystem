-- Supabase treats service_role as a trusted server-side administrative role.
-- Browser roles remain fully revoked and protected by the table's RLS boundary.
grant delete on table public.outbox_events to service_role;
