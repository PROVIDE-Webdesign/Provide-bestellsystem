-- Explicit opt-in for sandbox online payments. Empty migration grants no access.
create table private.synthetic_test_online_payments (
 restaurant_id uuid not null,
 location_id uuid not null,
 platform_account_id text not null check(platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
 merchant_account_id text not null check(merchant_account_id ~ '^acct_[A-Za-z0-9]+$'),
 enabled boolean not null default false,
 expires_at timestamptz not null,
 reason text not null check(length(btrim(reason)) between 8 and 300),
 created_at timestamptz not null default clock_timestamp(),
 primary key(restaurant_id,location_id),
 foreign key(restaurant_id,location_id) references private.synthetic_test_locations(restaurant_id,location_id),
 check(expires_at>created_at and expires_at<=created_at+interval '7 days'),
 check(platform_account_id<>merchant_account_id)
);
alter table private.synthetic_test_online_payments enable row level security;
alter table private.synthetic_test_online_payments force row level security;
revoke all on private.synthetic_test_online_payments from public,anon,authenticated,service_role;
create trigger synthetic_test_online_payment_audit after insert or update or delete
 on private.synthetic_test_online_payments for each row execute function private.provide_admin_record_change();

create function private.is_synthetic_test_online_payment_location(r uuid,l uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_synthetic_test_location(r,l) and exists(
  select 1 from private.synthetic_test_online_payments p
  join private.restaurant_test_payment_accounts a on a.restaurant_id=p.restaurant_id
   and a.platform_account_id=p.platform_account_id and a.merchant_account_id=p.merchant_account_id
  where p.restaurant_id=r and p.location_id=l and p.enabled and a.enabled
   and p.expires_at>statement_timestamp() and a.expires_at>statement_timestamp()
 );
$$;

-- Keep normal feature resolution and synthetic delivery restriction unchanged.
create or replace function private.is_location_feature_enabled(r uuid,l uuid,k text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.locations where restaurant_id=r and id=l)
 and private.is_restaurant_feature_enabled(r,k)
 and coalesce((select enabled from private.location_feature_flags where restaurant_id=r and location_id=l and feature_key=k
  and (expires_at is null or expires_at>statement_timestamp())),true)
 and (k in ('catalog.public_menu','ordering.accept_orders','fulfillment.pickup')
  or (k='payment.online' and private.is_synthetic_test_online_payment_location(r,l))
  or not exists(select 1 from private.synthetic_test_locations where restaurant_id=r and location_id=l));
$$;

create function private.configure_synthetic_test_online_payments(project_ref text,r uuid,l uuid,until_at timestamptz,why text)
returns void language plpgsql security definer set search_path='' as $$
declare e private.synthetic_test_environment; t private.synthetic_test_locations; a private.restaurant_test_payment_accounts;
begin
 if project_ref is null or why is null or length(btrim(why)) not between 8 and 300
  or until_at is null or until_at<=clock_timestamp() or until_at>clock_timestamp()+interval '7 days'
 then raise exception 'Invalid synthetic payment configuration';end if;
 select * into e from private.synthetic_test_environment where singleton for share;
 select * into t from private.synthetic_test_locations where restaurant_id=r and location_id=l for share;
 select * into a from private.restaurant_test_payment_accounts where restaurant_id=r for share;
 if e.project_ref is distinct from project_ref or not coalesce(private.is_synthetic_test_location(r,l),false)
  or not coalesce(a.enabled,false) or a.expires_at<=clock_timestamp()
  or until_at>e.expires_at or until_at>t.expires_at or until_at>a.expires_at
 then raise exception 'Explicit active synthetic scope and merchant mapping required';end if;
 perform set_config('provide.actor','',true);
 perform set_config('provide.reason',why,true);
 insert into private.synthetic_test_online_payments(restaurant_id,location_id,platform_account_id,merchant_account_id,enabled,expires_at,reason)
 values(r,l,a.platform_account_id,a.merchant_account_id,true,until_at,why)
 on conflict(restaurant_id,location_id) do update set platform_account_id=excluded.platform_account_id,
 merchant_account_id=excluded.merchant_account_id,enabled=true,expires_at=excluded.expires_at,
 reason=excluded.reason,created_at=clock_timestamp();
 if not private.is_synthetic_test_online_payment_location(r,l) then raise exception 'Synthetic payment scope failed verification';end if;
end;
$$;
revoke all on function private.is_synthetic_test_online_payment_location(uuid,uuid),
 private.configure_synthetic_test_online_payments(text,uuid,uuid,timestamptz,text)
 from public,anon,authenticated,service_role;
