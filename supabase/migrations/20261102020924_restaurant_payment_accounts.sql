-- Restaurant-owned direct charges. This migration never enables runtime payment flags.
create table private.restaurant_test_payment_accounts (
 restaurant_id uuid primary key references public.restaurants(id),
 platform_account_id text not null check(platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
 merchant_account_id text not null unique check(merchant_account_id ~ '^acct_[A-Za-z0-9]+$'),
 enabled boolean not null default false,
 expires_at timestamptz not null,
 reason text not null check(length(btrim(reason)) between 8 and 300),
 created_at timestamptz not null default clock_timestamp(),
 check(merchant_account_id<>platform_account_id),
 check(expires_at>created_at and expires_at<=created_at+interval '7 days')
);
alter table private.restaurant_test_payment_accounts enable row level security;
alter table private.restaurant_test_payment_accounts force row level security;
revoke all on private.restaurant_test_payment_accounts from public,anon,authenticated,service_role;
create trigger restaurant_test_payment_account_audit after insert or update or delete
 on private.restaurant_test_payment_accounts for each row execute function private.provide_admin_record_change();

-- Existing jobs keep their previous single-account origin. New jobs snapshot both accounts.
alter table public.online_payment_jobs add column platform_account_id text;
update public.online_payment_jobs set platform_account_id=account_id;
alter table public.online_payment_jobs alter column platform_account_id set not null;
alter table public.online_payment_jobs add constraint online_platform_account_format
 check(platform_account_id ~ '^acct_[A-Za-z0-9]+$');
-- An old merchant cannot be reassigned to a different restaurant after a mapping change.
create function private.guard_restaurant_payment_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.online_payment_jobs j where j.account_id=new.merchant_account_id
  and j.restaurant_id<>new.restaurant_id)
 then raise exception 'merchant account already belongs to another restaurant';end if;
 return new;
end;$$;
create trigger restaurant_payment_account_history_guard before insert or update on private.restaurant_test_payment_accounts
 for each row execute function private.guard_restaurant_payment_account();
revoke all on function private.guard_restaurant_payment_account() from public,anon,authenticated,service_role;

create function private.guard_online_payment_identity() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.restaurant_id,new.location_id,new.order_id,new.account_id,new.platform_account_id)
  is distinct from (old.restaurant_id,old.location_id,old.order_id,old.account_id,old.platform_account_id)
 then raise exception 'online payment identity is immutable';end if;
 return new;
end;$$;
create trigger online_payment_identity_immutable before update on public.online_payment_jobs
 for each row execute function private.guard_online_payment_identity();
revoke all on function private.guard_online_payment_identity() from public,anon,authenticated,service_role;

create function private.submit_guest_online_order_for_merchant(
  restaurant_slug text, location_slug text, menu_id uuid, menu_version_id uuid,
  requested_for timestamptz, lines jsonb, submission_key text, customer jsonb,
  fulfillment text, delivery jsonb, expected_quote jsonb, notice_version text, retention_days integer,
  target_account text, target_platform text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare restaurant uuid; location uuid; existing public.orders%rowtype; selected public.orders%rowtype;
  job public.online_payment_jobs%rowtype; quote jsonb; result uuid; deadline_at timestamptz; lead_minutes integer;
begin
  if fulfillment not in ('pickup','delivery') or fulfillment is null or retention_days not between 1 and 730
    or retention_days is null or target_account is null or target_account !~ '^acct_[A-Za-z0-9]+$'
  then raise exception 'invalid online checkout'; end if;
  select r.id,l.id into restaurant,location from public.restaurants r join public.locations l on l.restaurant_id=r.id
    where r.slug=restaurant_slug and l.slug=location_slug;
  if location is null then raise exception 'online checkout unavailable'; end if;
  -- Keep publication -> submission -> order lock ordering identical to delivery checkout.
  perform pg_advisory_xact_lock(hashtextextended('delivery-policy:'||location::text,0));
  perform pg_advisory_xact_lock(hashtextextended(restaurant::text||':'||location::text||':'||btrim(submission_key),0));
  select o.* into existing from public.orders o where o.restaurant_id=restaurant and o.location_id=location
    and o.submission_key=btrim(submit_guest_online_order_for_merchant.submission_key);
  if existing.id is null then
    if private.read_storefront_catalog(restaurant_slug,location_slug) is null
      or not private.is_location_feature_enabled(restaurant,location,'payment.online') then raise exception 'online checkout unavailable'; end if;
    -- Bound both request rate and simultaneous reservations per location.
    if (select count(*) from public.online_payment_jobs j where j.location_id=location and
      (j.created_at > statement_timestamp()-interval '1 minute' or (j.next_at is not null and not j.provider_terminal))) >= 20
    then raise exception 'online checkout busy'; end if;
  end if;
  if fulfillment='delivery' then
    if delivery->>'country_code' is distinct from 'DE' or delivery->>'postal_code' is null
      or delivery->>'postal_code' !~ '^[0-9]{5}$' then raise exception 'invalid delivery checkout'; end if;
    if existing.id is null then
      quote:=private.quote_public_delivery_order(restaurant_slug,location_slug,menu_id,menu_version_id,requested_for,lines,delivery->>'postal_code');
    else
      select jsonb_build_object('policyId',existing.delivery_policy_id,'subtotalAmountMinor',existing.subtotal_amount_minor,
        'deliveryFeeAmountMinor',existing.delivery_fee_amount_minor,'totalAmountMinor',existing.total_amount_minor,
        'minimumAmountMinor',(z.value->>'minimumAmountMinor')::bigint,'currency',existing.currency_code)
        into quote from public.delivery_policy_versions v,lateral jsonb_array_elements(v.zones) z
        where v.id=existing.delivery_policy_id and z.value->'postalCodes' ? (delivery->>'postal_code');
    end if;
    if quote is null or quote is distinct from expected_quote then raise exception 'delivery quote changed'; end if;
    result:=private.submit_priced_delivery_order(restaurant,location,menu_id,menu_version_id,'delivery',requested_for,
      lines,submission_key,statement_timestamp(),(quote->>'policyId')::uuid,(quote->>'deliveryFeeAmountMinor')::bigint);
  else
    if delivery is not null or expected_quote is not null then raise exception 'unexpected delivery data'; end if;
    result:=private.submit_order(restaurant,location,menu_id,menu_version_id,'pickup',requested_for,lines,submission_key,statement_timestamp());
  end if;
  perform private.initialize_order_payment(restaurant,location,result,'online');
  select o.* into selected from public.orders o where o.id=result;
  if selected.currency_code <> 'EUR' or selected.total_amount_minor not between 50 and 99999999
    then raise exception 'online amount unavailable'; end if;
  perform private.store_guest_checkout_snapshot(restaurant,location,result,customer,delivery,notice_version,
    selected.created_at+make_interval(days=>retention_days));
  select j.* into job from public.online_payment_jobs j where j.order_id=result;
  if job.id is null then
    select minimum_lead_minutes into lead_minutes from public.availability_schedule_versions where id=selected.schedule_version_id;
    deadline_at:=least(statement_timestamp()+interval '10 minutes',selected.requested_for-make_interval(mins=>lead_minutes));
    if deadline_at <= statement_timestamp()+interval '30 seconds' then raise exception 'online payment time unavailable'; end if;
    insert into public.online_payment_jobs(restaurant_id,location_id,order_id,account_id,platform_account_id,deadline)
      values(restaurant,location,result,target_account,target_platform,deadline_at) returning * into job;
  elsif job.account_id<>target_account then raise exception 'online account mismatch'; end if;
  return jsonb_build_object('orderId',result,'status','submitted','fulfillmentType',selected.fulfillment_type,
    'paymentCollectionMode','online','requestedFor',to_char(selected.requested_for at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'currency',selected.currency_code,'subtotalAmountMinor',selected.subtotal_amount_minor,'deliveryFeeAmountMinor',selected.delivery_fee_amount_minor,
    'totalAmountMinor',selected.total_amount_minor,'itemCount',selected.item_count,'paymentDeadline',
    to_char(job.deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

-- The only submission entry point accepts the configured PLATFORM account, never a guest payee.
create or replace function private.submit_public_guest_online_order(
 restaurant_slug text,location_slug text,menu_id uuid,menu_version_id uuid,
 requested_for timestamptz,lines jsonb,submission_key text,customer jsonb,
 fulfillment text,delivery jsonb,expected_quote jsonb,notice_version text,retention_days integer,
 target_account text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r uuid;l uuid;merchant text;j public.online_payment_jobs%rowtype;
begin
 select a.id,b.id into r,l from public.restaurants a join public.locations b on b.restaurant_id=a.id
 where a.slug=restaurant_slug and b.slug=location_slug;
 if l is null or target_account is null or target_account !~ '^acct_[A-Za-z0-9]+$'
 then raise exception 'online checkout unavailable';end if;
 -- Same lock ordering as the original transaction, also serializing mapping changes with retries.
 perform pg_advisory_xact_lock(hashtextextended('delivery-policy:'||l::text,0));
 perform pg_advisory_xact_lock(hashtextextended(r::text||':'||l::text||':'||btrim(submission_key),0));
 select a.* into j from public.online_payment_jobs a join public.orders o on o.id=a.order_id
 where a.restaurant_id=r and a.location_id=l and o.submission_key=btrim(submit_public_guest_online_order.submission_key);
 if j.id is not null then
  if j.platform_account_id<>target_account then raise exception 'online account mismatch';end if;
  merchant:=j.account_id;
 else
  select a.merchant_account_id into merchant from private.restaurant_test_payment_accounts a
  where a.restaurant_id=r and a.platform_account_id=target_account and a.enabled
   and a.expires_at>statement_timestamp() for share;
  if merchant is null then raise exception 'online checkout unavailable';end if;
 end if;
 return private.submit_guest_online_order_for_merchant(restaurant_slug,location_slug,menu_id,menu_version_id,
  requested_for,lines,submission_key,customer,fulfillment,delivery,expected_quote,notice_version,retention_days,merchant,target_account);
end;$$;
revoke all on function private.submit_guest_online_order_for_merchant(text,text,uuid,uuid,timestamptz,jsonb,text,jsonb,text,jsonb,jsonb,text,integer,text,text)
 from public,anon,authenticated,service_role;

create function private.read_platform_online_payment_job(platform text,target_order uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select private.read_online_payment_job(j.account_id,j.order_id) from public.online_payment_jobs j
 where j.platform_account_id=platform and j.order_id=target_order;
$$;
create function private.allow_platform_online_payment_resume(platform text,target_order uuid)
returns boolean language sql security definer set search_path='' as $$
 select coalesce((select private.allow_online_payment_resume(j.account_id,j.order_id)
 from public.online_payment_jobs j where j.platform_account_id=platform and j.order_id=target_order),false);
$$;
create function private.claim_platform_online_payment_job(platform text,target_order uuid,target_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.online_payment_jobs%rowtype;
begin
 if target_lease is null then raise exception 'missing payment lease';end if;
 select a.* into j from public.online_payment_jobs a where a.platform_account_id=platform
  and (target_order is null or a.order_id=target_order) and a.next_at<=statement_timestamp()
  and (a.lease_until is null or a.lease_until<statement_timestamp())
 order by a.next_at,a.id limit 1 for update skip locked;
 if j.id is null then return null;end if;
 update public.online_payment_jobs set lease_token=target_lease,lease_until=statement_timestamp()+interval '2 minutes' where id=j.id;
 return private.read_online_payment_job(j.account_id,j.order_id);
end;$$;

-- A completed Checkout page alone does not prove successful asynchronous payment.
alter table public.online_payment_inbox add column payment_succeeded boolean not null default false;
-- Only unambiguous historical success events are backfilled. Unknown historical Checkout states stay unknown.
-- The immutable receipt trigger is temporarily removed inside this atomic migration for this backfill only.
drop trigger online_payment_inbox_immutable on public.online_payment_inbox;
update public.online_payment_inbox set payment_succeeded=true where event_type='payment_intent.succeeded';
create trigger online_payment_inbox_immutable before update or delete on public.online_payment_inbox
 for each row execute function private.prevent_ordering_history_mutation();

create function private.receive_platform_online_payment_event(
 platform text,merchant text,target_event text,target_type text,target_object text,
 target_digest text,target_created_at timestamptz,target_success boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare old_event public.online_payment_inbox%rowtype;selected_order uuid;
begin
 if platform is null or platform !~ '^acct_[A-Za-z0-9]+$' or merchant is null or merchant !~ '^acct_[A-Za-z0-9]+$'
  or target_success is null or target_created_at is null or target_created_at<to_timestamp(0)
  or target_created_at>statement_timestamp()+interval '5 minutes'
  or target_type is null or target_type not in ('checkout.session.completed','checkout.session.expired',
   'checkout.session.async_payment_succeeded','checkout.session.async_payment_failed',
   'payment_intent.succeeded','payment_intent.payment_failed','refund.created','refund.updated','refund.failed')
  or (target_success and target_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded','payment_intent.succeeded'))
 then raise exception 'invalid provider event';end if;
 -- Keep history processable even when a restaurant's current mapping is disabled, changed or expired.
 if not exists(select 1 from private.restaurant_test_payment_accounts a where a.platform_account_id=platform and a.merchant_account_id=merchant)
  and not exists(select 1 from public.online_payment_jobs j where j.platform_account_id=platform and j.account_id=merchant)
 then raise exception 'online account mismatch';end if;
 if exists(select 1 from public.online_payment_jobs j where j.account_id=merchant
  and (j.session_id=target_object or j.intent_id=target_object or j.refund_id=target_object) and j.platform_account_id<>platform)
 then raise exception 'online account mismatch';end if;
 perform pg_advisory_xact_lock(hashtextextended(merchant||':'||target_event,0));
 select * into old_event from public.online_payment_inbox where account_id=merchant and event_id=target_event;
 if old_event.event_id is not null then
  if old_event.payload_sha256<>target_digest or old_event.object_id<>target_object or old_event.event_type<>target_type
   or old_event.provider_created_at is distinct from target_created_at or old_event.payment_succeeded<>target_success
  then raise exception 'conflicting payment event';end if;
 else
  insert into public.online_payment_inbox(account_id,event_id,event_type,object_id,payload_sha256,provider_created_at,payment_succeeded)
   values(merchant,target_event,target_type,target_object,target_digest,target_created_at,target_success);
 end if;
 select j.order_id into selected_order from public.online_payment_jobs j where j.platform_account_id=platform and j.account_id=merchant
  and (j.session_id=target_object or j.intent_id=target_object or j.refund_id=target_object);
 if selected_order is not null then update public.online_payment_jobs set next_at=statement_timestamp() where order_id=selected_order;end if;
 return selected_order;
end;$$;

-- Preserve all reconciliation transitions; replace only the two success-evidence predicates.
do $patch$
declare body text;old_predicate text:='e.event_type in (''payment_intent.succeeded'',''checkout.session.completed'')';
begin
 select pg_get_functiondef('private.sync_online_payment(uuid,uuid,text,text,text,text)'::regprocedure) into body;
 if (length(body)-length(replace(body,old_predicate,'')))/length(old_predicate)<>2
 then raise exception 'Unexpected payment success evidence predicates';end if;
 execute replace(body,old_predicate,'e.payment_succeeded');
end;$patch$;

revoke all on function private.read_platform_online_payment_job(text,uuid),
 private.allow_platform_online_payment_resume(text,uuid),private.claim_platform_online_payment_job(text,uuid,uuid),
 private.receive_platform_online_payment_event(text,text,text,text,text,text,timestamptz,boolean)
 from public,anon,authenticated;
grant execute on function private.read_platform_online_payment_job(text,uuid),
 private.allow_platform_online_payment_resume(text,uuid),private.claim_platform_online_payment_job(text,uuid,uuid),
 private.receive_platform_online_payment_event(text,text,text,text,text,text,timestamptz,boolean)
 to service_role;
