create table public.feature_definitions (
  key text primary key,
  description text not null,
  default_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_definitions_key_format check (
    key ~ '^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$'
  ),
  constraint feature_definitions_description_not_blank check (btrim(description) <> '')
);

create table public.restaurant_feature_flags (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  feature_key text not null references public.feature_definitions (key) on delete restrict,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, feature_key)
);

create index restaurant_feature_flags_feature_key_idx
  on public.restaurant_feature_flags (feature_key, restaurant_id);

create trigger feature_definitions_set_updated_at
before update on public.feature_definitions
for each row
execute function private.set_updated_at();

create trigger restaurant_feature_flags_set_updated_at
before update on public.restaurant_feature_flags
for each row
execute function private.set_updated_at();

insert into public.feature_definitions (key, description)
values
  ('ordering.accept_orders', 'Allow the restaurant to accept customer orders.'),
  ('fulfillment.pickup', 'Allow customers to select pickup.'),
  ('fulfillment.delivery', 'Allow customers to select delivery.'),
  ('payment.online', 'Allow customers to use online payment.');

create function private.is_restaurant_feature_enabled(
  target_restaurant_id uuid,
  target_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.restaurants as restaurant
      where restaurant.id = target_restaurant_id
    )
    and coalesce(
      (
        select restaurant_flag.enabled
        from public.restaurant_feature_flags as restaurant_flag
        where restaurant_flag.restaurant_id = target_restaurant_id
          and restaurant_flag.feature_key = target_feature_key
      ),
      (
        select definition.default_enabled
        from public.feature_definitions as definition
        where definition.key = target_feature_key
      ),
      false
    );
$$;

alter table public.feature_definitions enable row level security;
alter table public.feature_definitions force row level security;
alter table public.restaurant_feature_flags enable row level security;
alter table public.restaurant_feature_flags force row level security;

revoke all on table public.feature_definitions from public, anon, authenticated;
revoke all on table public.restaurant_feature_flags from public, anon, authenticated;
grant select, insert, update, delete on table public.feature_definitions to service_role;
grant select, insert, update, delete on table public.restaurant_feature_flags to service_role;

revoke all on function private.is_restaurant_feature_enabled(uuid, text) from public;
revoke all on function private.is_restaurant_feature_enabled(uuid, text) from anon, authenticated;
grant execute on function private.is_restaurant_feature_enabled(uuid, text) to service_role;

comment on table public.feature_definitions is
  'Controlled registry of server-managed features. Defaults are disabled unless explicitly changed.';
comment on table public.restaurant_feature_flags is
  'Tenant-specific feature overrides. Missing overrides inherit the registered default.';
comment on function private.is_restaurant_feature_enabled(uuid, text) is
  'For a known restaurant, resolves its override, then the registered default; otherwise returns false.';
