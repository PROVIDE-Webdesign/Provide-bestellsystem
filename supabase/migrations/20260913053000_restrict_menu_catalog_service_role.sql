revoke all on table public.menus from service_role;
revoke all on table public.menu_versions from service_role;
revoke all on table public.menu_items from service_role;
revoke all on table public.menu_version_sections from service_role;
revoke all on table public.menu_version_items from service_role;
revoke all on table public.menu_item_location_availability from service_role;
revoke all on table public.menu_publications from service_role;
revoke all on table public.menu_item_availability_transitions from service_role;

grant select on table public.menus to service_role;
grant select on table public.menu_versions to service_role;
grant select, insert on table public.menu_items to service_role;
grant select, insert, update, delete on table public.menu_version_sections to service_role;
grant select, insert, update, delete on table public.menu_version_items to service_role;
grant select on table public.menu_item_location_availability to service_role;
grant select on table public.menu_publications to service_role;
grant select on table public.menu_item_availability_transitions to service_role;

comment on table public.menu_versions is
  'Draft or immutable published menu snapshot. Lifecycle writes require controlled server functions.';
