revoke all on table public.availability_schedule_versions from service_role;
revoke all on table public.availability_windows from service_role;
revoke all on table public.availability_exceptions from service_role;
revoke all on table public.availability_publications from service_role;
revoke all on table public.ordering_pause_events from service_role;
revoke all on table public.ordering_capacity_claims from service_role;

grant select on table public.availability_schedule_versions to service_role;
grant select, insert, update, delete on table public.availability_windows to service_role;
grant select, insert, update, delete on table public.availability_exceptions to service_role;
grant select on table public.availability_publications to service_role;
grant select on table public.ordering_pause_events to service_role;
grant select on table public.ordering_capacity_claims to service_role;

comment on table public.availability_schedule_versions is
  'Versioned ordering-time, lead-time and capacity settings; lifecycle writes require controlled server functions.';
comment on table public.availability_publications is
  'Append-only effective timeline; direct service-role writes are prohibited.';
comment on table public.ordering_pause_events is
  'Append-only operational pause history; writes require the controlled pause function.';
comment on table public.ordering_capacity_claims is
  'Append-only capacity history; reservations and releases require controlled functions.';
