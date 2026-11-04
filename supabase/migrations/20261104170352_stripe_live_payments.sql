-- Live is opt-in. Existing jobs and event receipts retain their test identity.
create table private.restaurant_live_payment_accounts (
 restaurant_id uuid primary key references public.restaurants(id),
 platform_account_id text not null check(platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
 merchant_account_id text not null unique check(merchant_account_id ~ '^acct_[A-Za-z0-9]+$'),
 enabled boolean not null default false,
 check(merchant_account_id<>platform_account_id)
);
alter table private.restaurant_live_payment_accounts enable row level security;
alter table private.restaurant_live_payment_accounts force row level security;
revoke all on private.restaurant_live_payment_accounts from public,anon,authenticated,service_role;
create trigger restaurant_live_payment_account_audit after insert or update or delete
 on private.restaurant_live_payment_accounts for each row execute function private.provide_admin_record_change();

alter table public.online_payment_jobs
 add column stripe_mode text not null default 'test' check(stripe_mode in ('test','live')),
 drop constraint online_payment_jobs_session_id_check,
 add constraint online_payment_session_mode check(session_id is null or session_id ~ ('^cs_'||stripe_mode||'_[A-Za-z0-9]+$')),
 add constraint live_online_payment_identity check(stripe_mode='test' or (account_id<>platform_account_id and capture_method='manual'));
create index online_payment_jobs_platform_mode_due on public.online_payment_jobs(platform_account_id,stripe_mode,next_at,id)
 where next_at is not null;
alter table public.online_payment_inbox
 add column stripe_mode text not null default 'test' check(stripe_mode in ('test','live')),
 drop constraint online_payment_inbox_pkey,
 add primary key(stripe_mode,account_id,event_id),
 add constraint live_online_payment_inbox_object check(stripe_mode='test' or object_id ~ '^(cs_live_|pi_|re_)[A-Za-z0-9]+$');

create or replace function private.guard_restaurant_payment_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.online_payment_jobs j where j.account_id=new.merchant_account_id
  and j.stripe_mode=(case when tg_table_name='restaurant_live_payment_accounts' then 'live' else 'test' end)
  and (j.restaurant_id<>new.restaurant_id or (j.stripe_mode='live' and j.platform_account_id<>new.platform_account_id)))
 then raise exception 'merchant account already belongs to another restaurant';end if;
 return new;
end;$$;

create trigger restaurant_live_payment_account_history_guard before insert or update on private.restaurant_live_payment_accounts
 for each row execute function private.guard_restaurant_payment_account();

create or replace function private.guard_online_payment_identity() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.restaurant_id,new.location_id,new.order_id,new.account_id,new.platform_account_id,new.stripe_mode)
  is distinct from (old.restaurant_id,old.location_id,old.order_id,old.account_id,old.platform_account_id,old.stripe_mode)
 then raise exception 'online payment identity is immutable';end if;
 return new;
end;$$;

create function private.submit_guest_online_order_for_merchant(
  restaurant_slug text, location_slug text, menu_id uuid, menu_version_id uuid,
  requested_for timestamptz, lines jsonb, submission_key text, customer jsonb,
  fulfillment text, delivery jsonb, expected_quote jsonb, notice_version text, retention_days integer,
  target_account text, target_platform text, target_mode text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare restaurant uuid; location uuid; existing public.orders%rowtype; selected public.orders%rowtype;
  job public.online_payment_jobs%rowtype; quote jsonb; result uuid; deadline_at timestamptz; lead_minutes integer;
begin
  if fulfillment not in ('pickup','delivery') or fulfillment is null or retention_days not between 1 and 730
    or target_mode is null or target_mode not in ('test','live')
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
    insert into public.online_payment_jobs(restaurant_id,location_id,order_id,account_id,platform_account_id,stripe_mode,capture_method,deadline)
      values(restaurant,location,result,target_account,target_platform,target_mode,
        case when target_mode='live' then 'manual' else 'automatic' end,deadline_at) returning * into job;
  elsif (job.account_id,job.platform_account_id,job.stripe_mode) is distinct from (target_account,target_platform,target_mode) then raise exception 'online account mismatch'; end if;
  return jsonb_build_object('orderId',result,'status','submitted','fulfillmentType',selected.fulfillment_type,
    'paymentCollectionMode','online','stripeMode',job.stripe_mode,'requestedFor',to_char(selected.requested_for at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'currency',selected.currency_code,'subtotalAmountMinor',selected.subtotal_amount_minor,'deliveryFeeAmountMinor',selected.delivery_fee_amount_minor,
    'totalAmountMinor',selected.total_amount_minor,'itemCount',selected.item_count,'paymentDeadline',
    to_char(job.deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

create or replace function private.submit_guest_online_order_for_merchant(
  restaurant_slug text, location_slug text, menu_id uuid, menu_version_id uuid,
  requested_for timestamptz, lines jsonb, submission_key text, customer jsonb,
  fulfillment text, delivery jsonb, expected_quote jsonb, notice_version text, retention_days integer,
  target_account text, target_platform text
) returns jsonb language sql security definer set search_path='' as $$
 select private.submit_guest_online_order_for_merchant(restaurant_slug,location_slug,menu_id,menu_version_id,
  requested_for,lines,submission_key,customer,fulfillment,delivery,expected_quote,notice_version,retention_days,
  target_account,target_platform,'test');
$$;

create function private.submit_public_guest_online_order(
 restaurant_slug text,location_slug text,menu_id uuid,menu_version_id uuid,
 requested_for timestamptz,lines jsonb,submission_key text,customer jsonb,
 fulfillment text,delivery jsonb,expected_quote jsonb,notice_version text,retention_days integer,
 target_account text,target_mode text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r uuid;l uuid;merchant text;j public.online_payment_jobs%rowtype;
begin
 select a.id,b.id into r,l from public.restaurants a join public.locations b on b.restaurant_id=a.id
 where a.slug=restaurant_slug and b.slug=location_slug;
 if l is null or target_account is null or target_account !~ '^acct_[A-Za-z0-9]+$'
  or target_mode is null or target_mode not in ('test','live')
 then raise exception 'online checkout unavailable';end if;
 -- Same lock ordering as the original transaction, also serializing mapping changes with retries.
 perform pg_advisory_xact_lock(hashtextextended('delivery-policy:'||l::text,0));
 perform pg_advisory_xact_lock(hashtextextended(r::text||':'||l::text||':'||btrim(submission_key),0));
 select a.* into j from public.online_payment_jobs a join public.orders o on o.id=a.order_id
 where a.restaurant_id=r and a.location_id=l and o.submission_key=btrim(submit_public_guest_online_order.submission_key);
 if j.id is not null then
  if j.platform_account_id<>target_account or j.stripe_mode<>target_mode then raise exception 'online account mismatch';end if;
  merchant:=j.account_id;
 elsif target_mode='live' then
  -- A preview database or synthetic location must never issue a real charge.
  if exists(select 1 from private.synthetic_test_environment)
   or exists(select 1 from private.synthetic_test_locations t where t.restaurant_id=r and t.location_id=l)
  then raise exception 'online checkout unavailable';end if;
  select a.merchant_account_id into merchant from private.restaurant_live_payment_accounts a
  where a.restaurant_id=r and a.platform_account_id=target_account and a.enabled for share;
  if merchant is null then raise exception 'online checkout unavailable';end if;
 else
  select a.merchant_account_id into merchant from private.restaurant_test_payment_accounts a
  where a.restaurant_id=r and a.platform_account_id=target_account and a.enabled
   and a.expires_at>statement_timestamp() for share;
  if merchant is null then raise exception 'online checkout unavailable';end if;
 end if;
 return private.submit_guest_online_order_for_merchant(restaurant_slug,location_slug,menu_id,menu_version_id,
  requested_for,lines,submission_key,customer,fulfillment,delivery,expected_quote,notice_version,retention_days,merchant,target_account,target_mode);
end;$$;

create or replace function private.submit_public_guest_online_order(
 restaurant_slug text,location_slug text,menu_id uuid,menu_version_id uuid,
 requested_for timestamptz,lines jsonb,submission_key text,customer jsonb,
 fulfillment text,delivery jsonb,expected_quote jsonb,notice_version text,retention_days integer,
 target_account text
) returns jsonb language sql security definer set search_path='' as $$
 select private.submit_public_guest_online_order(restaurant_slug,location_slug,menu_id,menu_version_id,
  requested_for,lines,submission_key,customer,fulfillment,delivery,expected_quote,notice_version,retention_days,
  target_account,'test');
$$;

create function private.read_online_payment_job(target_account text,target_order uuid,target_mode text)
returns jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(j)||jsonb_build_object('amount',p.amount_due_minor,'currency',p.currency_code,'payment_status',p.status,
    'order_status',o.status,'restaurant_slug',r.slug,'location_slug',l.slug)
  from public.online_payment_jobs j join public.order_payments p on p.order_id=j.order_id
  join public.orders o on o.id=j.order_id join public.restaurants r on r.id=j.restaurant_id join public.locations l on l.id=j.location_id
  where j.account_id=target_account and j.order_id=target_order and j.stripe_mode=target_mode;
$$;

create or replace function private.read_online_payment_job(target_account text,target_order uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select private.read_online_payment_job(target_account,target_order,'test');
$$;

create function private.allow_online_payment_resume(target_account text,target_order uuid,target_mode text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.online_payment_jobs set last_resume_at=statement_timestamp()
    where account_id=target_account and order_id=target_order and stripe_mode=target_mode
      and (last_resume_at is null or last_resume_at<statement_timestamp()-interval '3 seconds');
  return found;
end;
$$;

create or replace function private.allow_online_payment_resume(target_account text,target_order uuid)
returns boolean language sql security definer set search_path='' as $$
 select private.allow_online_payment_resume(target_account,target_order,'test');
$$;

create or replace function private.claim_online_payment_job(target_account text,target_order uuid,target_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare selected uuid;
begin
  if target_lease is null then raise exception 'missing payment lease'; end if;
  select j.id into selected from public.online_payment_jobs j
    where j.account_id=target_account and j.stripe_mode='test' and (target_order is null or j.order_id=target_order)
      and j.next_at<=statement_timestamp() and (j.lease_until is null or j.lease_until<statement_timestamp())
    order by j.next_at,j.id limit 1 for update skip locked;
  if selected is null then return null; end if;
  update public.online_payment_jobs set lease_token=target_lease,lease_until=statement_timestamp()+interval '2 minutes' where id=selected;
  return private.read_online_payment_job(target_account,(select order_id from public.online_payment_jobs where id=selected));
end;
$$;

create function private.read_platform_online_payment_job(platform text,target_order uuid,target_mode text)
returns jsonb language sql stable security definer set search_path='' as $$
 select private.read_online_payment_job(j.account_id,j.order_id,target_mode) from public.online_payment_jobs j
 where j.platform_account_id=platform and j.stripe_mode=target_mode and j.order_id=target_order;
$$;

create or replace function private.read_platform_online_payment_job(platform text,target_order uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select private.read_platform_online_payment_job(platform,target_order,'test');
$$;

create function private.allow_platform_online_payment_resume(platform text,target_order uuid,target_mode text)
returns boolean language sql security definer set search_path='' as $$
 select coalesce((select private.allow_online_payment_resume(j.account_id,j.order_id,target_mode)
 from public.online_payment_jobs j where j.platform_account_id=platform and j.stripe_mode=target_mode and j.order_id=target_order),false);
$$;

create or replace function private.allow_platform_online_payment_resume(platform text,target_order uuid)
returns boolean language sql security definer set search_path='' as $$
 select private.allow_platform_online_payment_resume(platform,target_order,'test');
$$;

create function private.claim_platform_online_payment_job(platform text,target_order uuid,target_lease uuid,target_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.online_payment_jobs%rowtype;
begin
 if target_lease is null then raise exception 'missing payment lease';end if;
 select a.* into j from public.online_payment_jobs a where a.platform_account_id=platform and a.stripe_mode=target_mode
  and (target_order is null or a.order_id=target_order) and a.next_at<=statement_timestamp()
  and (a.lease_until is null or a.lease_until<statement_timestamp())
 order by a.next_at,a.id limit 1 for update skip locked;
 if j.id is null then return null;end if;
 update public.online_payment_jobs set lease_token=target_lease,lease_until=statement_timestamp()+interval '2 minutes' where id=j.id;
 return private.read_online_payment_job(j.account_id,j.order_id,target_mode);
end;$$;

create or replace function private.claim_platform_online_payment_job(platform text,target_order uuid,target_lease uuid)
returns jsonb language sql security definer set search_path='' as $$
 select private.claim_platform_online_payment_job(platform,target_order,target_lease,'test');
$$;

create or replace function private.bind_online_payment_session(target_job uuid,target_lease uuid,target_session text)
returns void language plpgsql security definer set search_path='' as $$
declare j public.online_payment_jobs%rowtype;
begin
  select * into j from public.online_payment_jobs where id=target_job for update;
  if j.id is null or target_lease is null or j.lease_until is null or j.lease_token is distinct from target_lease or j.lease_until<statement_timestamp()
    or target_session is null or target_session !~ ('^cs_'||j.stripe_mode||'_[A-Za-z0-9]+$') then raise exception 'payment lease invalid'; end if;
  if j.session_id is not null and j.session_id<>target_session then raise exception 'payment session mismatch'; end if;
  perform private.create_payment_attempt(j.restaurant_id,j.location_id,j.order_id,'online:'||j.id::text,case when j.stripe_mode='live' then 'stripe_live' else 'stripe_sandbox' end,target_session);
  update public.online_payment_jobs set session_id=target_session where id=j.id;
end;
$$;

-- The existing job is proof of prior feature authorization for a late reconciliation.
do $patch$
declare body text; prior text:='and normalized_provider_key=''stripe_sandbox''';
begin
 select pg_get_functiondef('private.create_payment_attempt(uuid,uuid,uuid,text,text,text)'::regprocedure) into body;
 if strpos(body,prior)=0 then raise exception 'Unexpected payment attempt definition';end if;
 execute replace(body,prior,'and normalized_provider_key=(case when j.stripe_mode=''live'' then ''stripe_live'' else ''stripe_sandbox'' end)');
end;
$patch$;

-- Keep the tested settlement state machine; separate the provider ledger and timing evidence by mode.
do $patch$
declare body text; provider text:='''stripe_sandbox'''; receipt text:='where e.account_id=j.account_id and e.payment_succeeded';
begin
 select pg_get_functiondef('private.sync_online_payment(uuid,uuid,text,text,text,text)'::regprocedure) into body;
 if (length(body)-length(replace(body,provider,'')))/length(provider)<>5
  or (length(body)-length(replace(body,receipt,'')))/length(receipt)<>2
 then raise exception 'Unexpected payment reconciliation definition';end if;
 body:=replace(body,provider,'case when j.stripe_mode=''live'' then ''stripe_live'' else ''stripe_sandbox'' end');
 execute replace(body,receipt,'where e.account_id=j.account_id and e.stripe_mode=j.stripe_mode and e.payment_succeeded');
end;
$patch$;

create or replace function private.receive_online_payment_event(
  target_account text,target_event text,target_type text,target_object text,
  target_digest text,target_created_at timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
declare old_event public.online_payment_inbox%rowtype; selected_order uuid;
begin
  if target_created_at is null or target_created_at > statement_timestamp()+interval '5 minutes'
    then raise exception 'invalid provider event time'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_account||':'||target_event,0));
  select * into old_event from public.online_payment_inbox where stripe_mode='test' and account_id=target_account and event_id=target_event;
  if old_event.event_id is not null then
    if old_event.payload_sha256<>target_digest or old_event.object_id<>target_object or old_event.event_type<>target_type
      or (old_event.provider_created_at is not null and old_event.provider_created_at is distinct from target_created_at)
      then raise exception 'conflicting payment event'; end if;
  else
    insert into public.online_payment_inbox(account_id,event_id,event_type,object_id,payload_sha256,provider_created_at)
      values(target_account,target_event,target_type,target_object,target_digest,target_created_at);
  end if;
  select order_id into selected_order from public.online_payment_jobs
    where stripe_mode='test' and account_id=target_account and (session_id=target_object or intent_id=target_object or refund_id=target_object);
  if selected_order is not null then
    update public.online_payment_jobs set next_at=statement_timestamp() where order_id=selected_order;
  end if;
  return selected_order;
end;
$$;

create function private.receive_platform_online_payment_event(
 platform text,merchant text,target_event text,target_type text,target_object text,
 target_digest text,target_created_at timestamptz,target_success boolean,target_mode text
) returns uuid language plpgsql security definer set search_path='' as $$
declare old_event public.online_payment_inbox%rowtype;selected_order uuid;
begin
 if platform is null or platform !~ '^acct_[A-Za-z0-9]+$' or merchant is null or merchant !~ '^acct_[A-Za-z0-9]+$'
  or target_mode is null or target_mode not in ('test','live')
  or (target_mode='live' and (merchant=platform or target_object is null
   or target_object !~ '^(cs_live_|pi_|re_)[A-Za-z0-9]+$'))
  or target_success is null or target_created_at is null or target_created_at<to_timestamp(0)
  or target_created_at>statement_timestamp()+interval '5 minutes'
  or target_type is null or target_type not in ('checkout.session.completed','checkout.session.expired',
   'checkout.session.async_payment_succeeded','checkout.session.async_payment_failed',
   'payment_intent.succeeded','payment_intent.payment_failed','payment_intent.amount_capturable_updated','refund.created','refund.updated','refund.failed')
  or (target_success and target_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded','payment_intent.succeeded'))
 then raise exception 'invalid provider event';end if;
 -- Keep history processable even when a restaurant's current mapping is disabled, changed or expired.
 if target_mode='live' then
  -- A Connect endpoint can receive events from merchants outside this application.
  if not exists(select 1 from private.restaurant_live_payment_accounts a
   where a.platform_account_id=platform and a.merchant_account_id=merchant)
   and not exists(select 1 from public.online_payment_jobs j
   where j.stripe_mode=target_mode and j.platform_account_id=platform and j.account_id=merchant)
  then return null;end if;
 elsif not exists(select 1 from private.restaurant_test_payment_accounts a
  where a.platform_account_id=platform and a.merchant_account_id=merchant)
  and not exists(select 1 from public.online_payment_jobs j
   where j.stripe_mode=target_mode and j.platform_account_id=platform and j.account_id=merchant)
 then raise exception 'online account mismatch';end if;
 if exists(select 1 from public.online_payment_jobs j where j.stripe_mode=target_mode and j.account_id=merchant
  and (j.session_id=target_object or j.intent_id=target_object or j.refund_id=target_object) and j.platform_account_id<>platform)
 then raise exception 'online account mismatch';end if;
 perform pg_advisory_xact_lock(hashtextextended((case when target_mode='live' then 'live:' else '' end)||merchant||':'||target_event,0));
 select * into old_event from public.online_payment_inbox where stripe_mode=target_mode and account_id=merchant and event_id=target_event;
 if old_event.event_id is not null then
  if old_event.payload_sha256<>target_digest or old_event.object_id<>target_object or old_event.event_type<>target_type
   or old_event.provider_created_at is distinct from target_created_at or old_event.payment_succeeded<>target_success
  then raise exception 'conflicting payment event';end if;
 else
  insert into public.online_payment_inbox(stripe_mode,account_id,event_id,event_type,object_id,payload_sha256,provider_created_at,payment_succeeded)
   values(target_mode,merchant,target_event,target_type,target_object,target_digest,target_created_at,target_success);
 end if;
 select j.order_id into selected_order from public.online_payment_jobs j where j.stripe_mode=target_mode and j.platform_account_id=platform and j.account_id=merchant
  and (j.session_id=target_object or j.intent_id=target_object or j.refund_id=target_object);
 if selected_order is not null then update public.online_payment_jobs set next_at=statement_timestamp() where order_id=selected_order;end if;
 return selected_order;
end;$$;

create or replace function private.receive_platform_online_payment_event(
 platform text,merchant text,target_event text,target_type text,target_object text,
 target_digest text,target_created_at timestamptz,target_success boolean
) returns uuid language sql security definer set search_path='' as $$
 select private.receive_platform_online_payment_event(platform,merchant,target_event,target_type,target_object,
  target_digest,target_created_at,target_success,'test');
$$;

revoke all on function
 private.submit_guest_online_order_for_merchant(text,text,uuid,uuid,timestamptz,jsonb,text,jsonb,text,jsonb,jsonb,text,integer,text,text,text),
 private.read_online_payment_job(text,uuid,text),private.allow_online_payment_resume(text,uuid,text)
 from public,anon,authenticated,service_role;

revoke all on function
 private.submit_public_guest_online_order(text,text,uuid,uuid,timestamptz,jsonb,text,jsonb,text,jsonb,jsonb,text,integer,text,text),
 private.read_platform_online_payment_job(text,uuid,text),private.allow_platform_online_payment_resume(text,uuid,text),
 private.claim_platform_online_payment_job(text,uuid,uuid,text),
 private.receive_platform_online_payment_event(text,text,text,text,text,text,timestamptz,boolean,text)
 from public,anon,authenticated;
grant execute on function
 private.submit_public_guest_online_order(text,text,uuid,uuid,timestamptz,jsonb,text,jsonb,text,jsonb,jsonb,text,integer,text,text),
 private.read_platform_online_payment_job(text,uuid,text),private.allow_platform_online_payment_resume(text,uuid,text),
 private.claim_platform_online_payment_job(text,uuid,uuid,text),
 private.receive_platform_online_payment_event(text,text,text,text,text,text,timestamptz,boolean,text)
 to service_role;

-- Persist the configured Stripe mode inside the existing atomic checkout/receipt transaction.
create function private.checkout_submit(h text,sid uuid,rs text,ls text,kind text,fingerprint text,cmd jsonb,retention integer,account text,target_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.checkout_sessions;t timestamptz:=clock_timestamp();result jsonb;
begin
 perform 1 from private.checkout_browser_contexts where verifier_hash=h and expires_at>t for update;
 if not found then raise exception using errcode='P0001',message='Checkout context unavailable';end if;
 select c.* into s from private.checkout_sessions c join public.restaurants r on r.id=c.restaurant_id join public.locations l on l.id=c.location_id
 where c.id=sid and c.verifier_hash=h and r.slug=rs and l.slug=ls for update of c;
 t:=clock_timestamp();
 if not exists(select 1 from private.checkout_browser_contexts where verifier_hash=h and expires_at>t) then raise exception using errcode='P0001',message='Checkout context expired';end if;
 if s.id is null or s.submission_key is distinct from cmd->>'submissionKey' or s.receipt_expires_at<=t or fingerprint is null or fingerprint!~'^[A-Za-z0-9_-]{43}$' then raise exception using errcode='P0001',message='Checkout intent unavailable';end if;
 if s.order_id is not null then
   if s.payload_hmac<>fingerprint or s.mode<>kind
     or (kind='online-orders' and coalesce(s.receipt->>'stripeMode','test') is distinct from target_mode) then raise exception using errcode='P0001',message='Checkout payload conflict';end if;
   return s.receipt;
 end if;
 if s.revoked_at is not null or s.write_expires_at<=t then raise exception using errcode='P0001',message='Checkout session expired';end if;
 -- Never adopt a legacy/other session's order by guessing an existing submission key.
 if exists(select 1 from public.orders where restaurant_id=s.restaurant_id and location_id=s.location_id and submission_key=s.submission_key) then raise exception using errcode='P0001',message='Checkout key already used';end if;
 if kind='orders' then
   result:=private.submit_public_guest_pickup_order(rs,ls,(cmd->>'menuId')::uuid,(cmd->>'menuVersionId')::uuid,(cmd->>'requestedFor')::timestamptz,cmd->'lines',s.submission_key,cmd->'customer',cmd->>'privacyNoticeVersion',retention);
 elsif kind='delivery-orders' then
   result:=private.submit_public_guest_delivery_order(rs,ls,(cmd->>'menuId')::uuid,(cmd->>'menuVersionId')::uuid,(cmd->>'requestedFor')::timestamptz,cmd->'lines',s.submission_key,cmd->'customer',cmd->'delivery',cmd->'expectedQuote',cmd->>'privacyNoticeVersion',retention);
 elsif kind='online-orders' then
   result:=private.submit_public_guest_online_order(rs,ls,(cmd->>'menuId')::uuid,(cmd->>'menuVersionId')::uuid,(cmd->>'requestedFor')::timestamptz,cmd->'lines',s.submission_key,cmd->'customer',cmd->>'fulfillmentType',cmd->'delivery',cmd->'expectedQuote',cmd->>'privacyNoticeVersion',retention,account,target_mode);
 else raise exception using errcode='22023',message='Invalid checkout mode';end if;
 result:=private.attach_order_number(result);
 update private.checkout_sessions set payload_hmac=fingerprint,order_id=(result->>'orderId')::uuid,mode=kind,receipt=result where id=s.id;
 return result;
end;
$$;
create or replace function private.checkout_submit(
 h text,sid uuid,rs text,ls text,kind text,fingerprint text,cmd jsonb,retention integer,account text
) returns jsonb language sql security definer set search_path='' as $$
 select private.checkout_submit(h,sid,rs,ls,kind,fingerprint,cmd,retention,account,'test');
$$;
revoke all on function private.checkout_submit(text,uuid,text,text,text,text,jsonb,integer,text,text)
 from public,anon,authenticated;
grant execute on function private.checkout_submit(text,uuid,text,text,text,text,jsonb,integer,text,text)
 to service_role;

-- Offer online payment only at a published live checkout with an enabled merchant.
create function private.read_storefront_catalog(rs text,ls text,platform text) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.read_storefront_catalog(rs,ls) || jsonb_build_object('liveOnlinePaymentAvailable',exists(
  select 1 from public.restaurants r join public.locations l on l.restaurant_id=r.id
  join private.restaurant_live_payment_accounts a on a.restaurant_id=r.id
  where r.slug=rs and l.slug=ls and a.enabled and a.platform_account_id=platform
   and private.is_location_feature_enabled(r.id,l.id,'payment.online')
   and not exists(select 1 from private.synthetic_test_environment)
   and not exists(select 1 from private.synthetic_test_locations t where t.restaurant_id=r.id and t.location_id=l.id)
 ));
$$;
revoke all on function private.read_storefront_catalog(text,text,text) from public,anon,authenticated;
grant execute on function private.read_storefront_catalog(text,text,text) to service_role;
