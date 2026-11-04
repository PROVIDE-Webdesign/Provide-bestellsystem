-- Synthetic preview ordering is distinct from production go-live approval.
-- Empty by default. Only a database operator can configure the environment and scopes.
create table private.synthetic_test_environment (
 singleton boolean primary key default true check(singleton),
 project_ref text not null check(project_ref ~ '^[a-z0-9]{20}$'),
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 check(expires_at>created_at and expires_at<=created_at+interval '7 days')
);
create table private.synthetic_test_locations (
 restaurant_id uuid not null,
 location_id uuid not null,
 expires_at timestamptz not null,
 reason text not null check(length(btrim(reason)) between 8 and 300),
 created_at timestamptz not null default clock_timestamp(),
 primary key(restaurant_id,location_id),
 foreign key(restaurant_id,location_id) references public.locations(restaurant_id,id) on delete restrict,
 check(expires_at>created_at and expires_at<=created_at+interval '7 days')
);
alter table private.synthetic_test_environment enable row level security;
alter table private.synthetic_test_environment force row level security;
alter table private.synthetic_test_locations enable row level security;
alter table private.synthetic_test_locations force row level security;
revoke all on private.synthetic_test_environment,private.synthetic_test_locations from public,anon,authenticated,service_role;
create trigger synthetic_test_scope_audit after insert or update or delete on private.synthetic_test_locations
 for each row execute function private.provide_admin_record_change();

create function private.is_synthetic_test_location(r uuid,l uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from private.synthetic_test_environment e
  join private.synthetic_test_locations t on t.restaurant_id=r and t.location_id=l
  join public.restaurants a on a.id=t.restaurant_id
  join public.locations b on b.restaurant_id=a.id and b.id=t.location_id
  join public.restaurant_activation_states ar on ar.restaurant_id=a.id
  join public.location_activation_states al on al.restaurant_id=a.id and al.location_id=b.id
  where e.expires_at>statement_timestamp() and t.expires_at>statement_timestamp()
   and a.slug like 'test-%' and b.slug like 'test-%'
   and a.display_name like 'TEST %' and b.display_name like 'TEST %'
   and a.status='active' and b.status='active'
   and ar.go_live_status='blocked' and al.go_live_status='blocked'
   and ar.onboarding_status<>'approved' and al.onboarding_status<>'approved'
 );
$$;
create function private.is_location_ordering_enabled(r uuid,l uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from private.synthetic_test_locations where restaurant_id=r and location_id=l)
 then private.is_synthetic_test_location(r,l)
 else private.is_location_go_live(r,l) end;
$$;
revoke all on function private.is_synthetic_test_location(uuid,uuid),private.is_location_ordering_enabled(uuid,uuid)
 from public,anon,authenticated,service_role;

-- Retain production feature resolution; synthetic scopes cannot enable payment or delivery.
create or replace function private.is_location_feature_enabled(r uuid,l uuid,k text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.locations where restaurant_id=r and id=l)
 and private.is_restaurant_feature_enabled(r,k)
 and coalesce((select enabled from private.location_feature_flags where restaurant_id=r and location_id=l and feature_key=k
  and (expires_at is null or expires_at>statement_timestamp())),true)
 and (k in ('catalog.public_menu','ordering.accept_orders','fulfillment.pickup')
  or not exists(select 1 from private.synthetic_test_locations where restaurant_id=r and location_id=l));
$$;

-- Change only the three ordering gates. Production go-live functions remain byte-for-byte intact.
do $patch$
declare f regprocedure; body text; replacement text; n integer;
begin
 foreach f in array array[
 'private.read_storefront_catalog_without_stops(text,text)'::regprocedure,
 'private.resolve_public_menu_version(uuid,uuid,uuid,timestamptz)'::regprocedure,
 'private.resolve_ordering_availability(uuid,uuid,text,timestamptz,integer,timestamptz)'::regprocedure
 ] loop
  select pg_get_functiondef(f) into body;
  n:=(length(body)-length(replace(body,'private.is_location_go_live(','')))/length('private.is_location_go_live(');
  if n<>1 then raise exception 'Unexpected ordering gate count for %',f;end if;
  replacement:=replace(body,'private.is_location_go_live(','private.is_location_ordering_enabled(');
  execute replacement;
 end loop;
end;$patch$;

create function private.configure_synthetic_test_location(project_ref text,r uuid,l uuid,until_at timestamptz,why text)
returns void language plpgsql security definer set search_path='' as $$
declare e private.synthetic_test_environment; a public.restaurants; b public.locations; k text;
begin
 if project_ref is null or why is null or length(btrim(why)) not between 8 and 300
  or until_at is null or until_at<=clock_timestamp() or until_at>clock_timestamp()+interval '7 days'
 then raise exception 'Invalid synthetic preview configuration';end if;
 select * into e from private.synthetic_test_environment where singleton for update;
 if e.project_ref is distinct from project_ref or e.expires_at<=clock_timestamp() or until_at>e.expires_at
 then raise exception 'Explicit preview environment configuration required';end if;
 select * into a from public.restaurants where id=r for no key update;
 select * into b from public.locations where restaurant_id=r and id=l for no key update;
 if a.id is null or b.id is null or a.slug not like 'test-%' or b.slug not like 'test-%'
  or a.display_name not like 'TEST %' or b.display_name not like 'TEST %'
  or a.status not in ('setup','active') or b.status not in ('setup','active')
  or not exists(select 1 from public.restaurant_activation_states where restaurant_id=r and go_live_status='blocked' and onboarding_status<>'approved')
  or not exists(select 1 from public.location_activation_states where restaurant_id=r and location_id=l and go_live_status='blocked' and onboarding_status<>'approved')
 then raise exception 'Only explicitly synthetic blocked setup scopes are eligible';end if;
 perform set_config('provide.actor','',true);
 perform set_config('provide.reason',why,true);
 update public.restaurants set status='active' where id=r and status='setup';
 update public.locations set status='active' where restaurant_id=r and id=l and status='setup';
 insert into private.synthetic_test_locations(restaurant_id,location_id,expires_at,reason)
 values(r,l,until_at,why)
 on conflict(restaurant_id,location_id) do update set expires_at=excluded.expires_at,reason=excluded.reason,created_at=clock_timestamp();
 foreach k in array array['catalog.public_menu','ordering.accept_orders','fulfillment.pickup'] loop
  insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled,expires_at,reason)
  values(r,k,true,until_at,why)
  on conflict(restaurant_id,feature_key) do update set enabled=true,expires_at=excluded.expires_at,reason=excluded.reason;
 end loop;
 if not private.is_synthetic_test_location(r,l) then raise exception 'Synthetic preview scope failed verification';end if;
end;
$$;
revoke all on function private.configure_synthetic_test_location(text,uuid,uuid,timestamptz,text) from public,anon,authenticated,service_role;
