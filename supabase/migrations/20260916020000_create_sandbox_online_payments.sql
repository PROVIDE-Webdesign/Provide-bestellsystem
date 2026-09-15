-- Durable orchestration: no provider HTTP request runs inside a database transaction.
create table public.online_payment_jobs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null unique,
  account_id text not null check(account_id ~ '^acct_[A-Za-z0-9]+$'),
  session_id text unique check(session_id ~ '^cs_test_[A-Za-z0-9]+$'),
  intent_id text unique check(intent_id ~ '^pi_[A-Za-z0-9]+$'),
  refund_id text unique check(refund_id ~ '^re_[A-Za-z0-9]+$'),
  refund_sequence integer not null default 0,
  refund_state text not null default 'none' check(refund_state in ('none','requested','pending','failed','succeeded')),
  close_requested text check(close_requested in ('cancelled','rejected')),
  provider_terminal boolean not null default false,
  deadline timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  next_at timestamptz default statement_timestamp(),
  last_resume_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  failures integer not null default 0,
  last_error text check(last_error in ('provider_unavailable','manual_review')),
  foreign key(restaurant_id,location_id,order_id) references public.orders(restaurant_id,location_id,id)
);
create index online_payment_jobs_due on public.online_payment_jobs(next_at) where next_at is not null;
create table public.online_refund_retries (
  job_id uuid not null references public.online_payment_jobs(id),
  sequence integer not null,
  previous_refund text not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  primary key(job_id,sequence)
);
create trigger online_refund_retries_immutable before update or delete on public.online_refund_retries
for each row execute function private.prevent_ordering_history_mutation();
create table public.online_payment_inbox (
  account_id text not null,
  event_id text not null check(event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text not null,
  object_id text not null,
  payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default statement_timestamp(),
  primary key(account_id,event_id)
);
create trigger online_payment_inbox_immutable before update or delete on public.online_payment_inbox
for each row execute function private.prevent_ordering_history_mutation();

-- Closing new orders must not strand a previously reserved payment, including late capture recovery.
create or replace function private.create_payment_attempt(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_order_id uuid,
  target_attempt_key text,
  target_provider_key text,
  target_provider_payment_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_attempt_key text := btrim(target_attempt_key);
  normalized_provider_key text := lower(btrim(target_provider_key));
  normalized_provider_reference text := btrim(target_provider_payment_reference);
  selected_payment public.order_payments%rowtype;
  existing_attempt public.payment_attempts%rowtype;
  created_attempt_id uuid := gen_random_uuid();
  next_event_sequence integer;
  previous_status text;
begin
  if normalized_attempt_key is null
    or char_length(normalized_attempt_key) < 8
    or char_length(normalized_attempt_key) > 128
  then
    raise exception using errcode = 'P0001', message = 'payment attempt key is invalid';
  end if;

  if normalized_provider_key is null
    or normalized_provider_key !~ '^[a-z][a-z0-9_]{1,31}$'
  then
    raise exception using errcode = 'P0001', message = 'payment provider key is invalid';
  end if;

  if normalized_provider_reference is null
    or normalized_provider_reference = ''
    or char_length(normalized_provider_reference) > 255
  then
    raise exception using errcode = 'P0001', message = 'payment provider reference is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_restaurant_id::text || ':' || target_order_id::text || ':' || normalized_attempt_key,
      0
    )
  );

  select payment.*
  into selected_payment
  from public.order_payments as payment
  where payment.restaurant_id = target_restaurant_id
    and payment.location_id = target_location_id
    and payment.order_id = target_order_id
  for update;

  if selected_payment.id is null then
    raise exception using errcode = 'P0001', message = 'online payment was not found';
  end if;

  if selected_payment.collection_mode <> 'online' then
    raise exception using errcode = 'P0001', message = 'order does not require online payment';
  end if;

  select attempt.*
  into existing_attempt
  from public.payment_attempts as attempt
  where attempt.restaurant_id = target_restaurant_id
    and attempt.payment_id = selected_payment.id
    and attempt.attempt_key = normalized_attempt_key;

  if existing_attempt.id is not null then
    if existing_attempt.location_id = target_location_id
      and existing_attempt.provider_key = normalized_provider_key
      and existing_attempt.provider_payment_reference = normalized_provider_reference
    then
      return existing_attempt.id;
    end if;

    raise exception using errcode = 'P0001', message = 'payment attempt key was reused with different values';
  end if;

  if selected_payment.status not in ('created', 'failed', 'cancelled', 'expired') then
    raise exception using errcode = 'P0001', message = 'payment does not allow a new attempt';
  end if;

  if not private.is_restaurant_feature_enabled(target_restaurant_id, 'payment.online')
    and not exists (select 1 from public.online_payment_jobs j where j.order_id=target_order_id
      and j.restaurant_id=target_restaurant_id and j.location_id=target_location_id
      and normalized_provider_key='stripe_sandbox') then
    raise exception using errcode = 'P0001', message = 'online payment is not enabled';
  end if;

  insert into public.payment_attempts (
    id,
    restaurant_id,
    location_id,
    payment_id,
    attempt_key,
    provider_key,
    provider_payment_reference
  )
  values (
    created_attempt_id,
    target_restaurant_id,
    target_location_id,
    selected_payment.id,
    normalized_attempt_key,
    normalized_provider_key,
    normalized_provider_reference
  );

  select coalesce(max(event.event_sequence), 0) + 1
  into next_event_sequence
  from public.payment_status_events as event
  where event.restaurant_id = target_restaurant_id
    and event.payment_id = selected_payment.id;

  previous_status := selected_payment.status;

  update public.order_payments
  set status = 'pending_customer'
  where id = selected_payment.id;

  insert into public.payment_status_events (
    restaurant_id,
    location_id,
    order_id,
    payment_id,
    event_sequence,
    from_status,
    to_status,
    source_kind,
    attempt_id
  )
  values (
    target_restaurant_id,
    target_location_id,
    target_order_id,
    selected_payment.id,
    next_event_sequence,
    previous_status,
    'pending_customer',
    'system',
    created_attempt_id
  );

  insert into public.outbox_events (
    restaurant_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    idempotency_key
  )
  values (
    target_restaurant_id,
    'payment',
    selected_payment.id,
    'payment.attempt_created',
    jsonb_build_object(
      'payment_id', selected_payment.id,
      'order_id', target_order_id,
      'location_id', target_location_id,
      'attempt_id', created_attempt_id,
      'status', 'pending_customer'
    ),
    'payment-attempt:' || created_attempt_id::text
  );

  return created_attempt_id;
end;
$$;

create function private.submit_public_guest_online_order(
  restaurant_slug text, location_slug text, menu_id uuid, menu_version_id uuid,
  requested_for timestamptz, lines jsonb, submission_key text, customer jsonb,
  fulfillment text, delivery jsonb, expected_quote jsonb, notice_version text, retention_days integer,
  target_account text
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
    and o.submission_key=btrim(submit_public_guest_online_order.submission_key);
  if existing.id is null then
    if private.read_storefront_catalog(restaurant_slug,location_slug) is null
      or not private.is_restaurant_feature_enabled(restaurant,'payment.online') then raise exception 'online checkout unavailable'; end if;
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
    insert into public.online_payment_jobs(restaurant_id,location_id,order_id,account_id,deadline)
      values(restaurant,location,result,target_account,deadline_at) returning * into job;
  elsif job.account_id<>target_account then raise exception 'online account mismatch'; end if;
  return jsonb_build_object('orderId',result,'status','submitted','fulfillmentType',selected.fulfillment_type,
    'paymentCollectionMode','online','requestedFor',to_char(selected.requested_for at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'currency',selected.currency_code,'subtotalAmountMinor',selected.subtotal_amount_minor,'deliveryFeeAmountMinor',selected.delivery_fee_amount_minor,
    'totalAmountMinor',selected.total_amount_minor,'itemCount',selected.item_count,'paymentDeadline',
    to_char(job.deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

create function private.read_online_payment_job(target_account text,target_order uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(j)||jsonb_build_object('amount',p.amount_due_minor,'currency',p.currency_code,'payment_status',p.status,
    'order_status',o.status,'restaurant_slug',r.slug,'location_slug',l.slug)
  from public.online_payment_jobs j join public.order_payments p on p.order_id=j.order_id
  join public.orders o on o.id=j.order_id join public.restaurants r on r.id=j.restaurant_id join public.locations l on l.id=j.location_id
  where j.account_id=target_account and j.order_id=target_order;
$$;
-- A bearer capability cannot force unbounded provider reads through resume requests.
create function private.allow_online_payment_resume(target_account text,target_order uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.online_payment_jobs set last_resume_at=statement_timestamp()
    where account_id=target_account and order_id=target_order
      and (last_resume_at is null or last_resume_at<statement_timestamp()-interval '3 seconds');
  return found;
end;
$$;
revoke all on function private.allow_online_payment_resume(text,uuid) from public,anon,authenticated;
grant execute on function private.allow_online_payment_resume(text,uuid) to service_role;

create function private.claim_online_payment_job(target_account text,target_order uuid,target_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare selected uuid;
begin
  if target_lease is null then raise exception 'missing payment lease'; end if;
  select j.id into selected from public.online_payment_jobs j
    where j.account_id=target_account and (target_order is null or j.order_id=target_order)
      and j.next_at<=statement_timestamp() and (j.lease_until is null or j.lease_until<statement_timestamp())
    order by j.next_at,j.id limit 1 for update skip locked;
  if selected is null then return null; end if;
  update public.online_payment_jobs set lease_token=target_lease,lease_until=statement_timestamp()+interval '2 minutes' where id=selected;
  return private.read_online_payment_job(target_account,(select order_id from public.online_payment_jobs where id=selected));
end;
$$;
create function private.bind_online_payment_session(target_job uuid,target_lease uuid,target_session text)
returns void language plpgsql security definer set search_path='' as $$
declare j public.online_payment_jobs%rowtype;
begin
  select * into j from public.online_payment_jobs where id=target_job for update;
  if j.id is null or target_lease is null or j.lease_until is null or j.lease_token is distinct from target_lease or j.lease_until<statement_timestamp()
    or target_session is null or target_session !~ '^cs_test_[A-Za-z0-9]+$' then raise exception 'payment lease invalid'; end if;
  if j.session_id is not null and j.session_id<>target_session then raise exception 'payment session mismatch'; end if;
  perform private.create_payment_attempt(j.restaurant_id,j.location_id,j.order_id,'online:'||j.id::text,'stripe_sandbox',target_session);
  update public.online_payment_jobs set session_id=target_session where id=j.id;
end;
$$;

-- System closure records a normal order event and releases capacity exactly once.
create function private.close_online_order(target_order uuid,target_status text)
returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; sequence integer; event uuid:=gen_random_uuid();
begin
  select * into o from public.orders where id=target_order for update;
  if o.status in ('cancelled','rejected','completed') then return; end if;
  if target_status not in ('cancelled','rejected') or o.status<>'submitted' then raise exception 'online closure invalid'; end if;
  select coalesce(max(event_sequence),0)+1 into sequence from public.order_status_events where order_id=o.id;
  update public.orders set status=target_status where id=o.id;
  insert into public.order_status_events(id,restaurant_id,location_id,order_id,event_sequence,from_status,to_status,actor_kind)
    values(event,o.restaurant_id,o.location_id,o.id,sequence,o.status,target_status,'system');
  perform private.release_ordering_capacity(o.restaurant_id,o.location_id,o.fulfillment_type,'order:'||o.id::text);
  insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
    values(o.restaurant_id,'order',o.id,'order.status_changed',jsonb_build_object('event_id',event,'order_id',o.id,
      'location_id',o.location_id,'from_status',o.status,'to_status',target_status),'order-status:'||event::text);
end;
$$;

create function private.sync_online_payment(target_job uuid,target_lease uuid,target_state text,target_intent text,target_refund text,target_digest text)
returns void language plpgsql security definer set search_path='' as $$
declare j public.online_payment_jobs%rowtype; p public.order_payments%rowtype; o public.orders%rowtype; target_payment text;
begin
  -- Order before payment/job: same order as personnel status transitions.
  select o1.* into o from public.orders o1 join public.online_payment_jobs j1 on j1.order_id=o1.id where j1.id=target_job for update of o1;
  select * into j from public.online_payment_jobs where id=target_job for update;
  if j.id is null or target_lease is null or j.lease_until is null or j.lease_token is distinct from target_lease or j.lease_until<statement_timestamp()
    or target_state is null or target_state not in ('open','paid','expired','refund_pending','refund_failed','refunded')
    then raise exception 'payment reconciliation invalid'; end if;
  select * into p from public.order_payments where order_id=j.order_id for update;
  if target_intent is not null and j.intent_id is not null and target_intent<>j.intent_id then raise exception 'payment intent mismatch'; end if;
  if target_refund is not null and j.refund_id is not null and target_refund<>j.refund_id then raise exception 'refund mismatch'; end if;
  update public.online_payment_jobs set intent_id=coalesce(intent_id,target_intent),refund_id=coalesce(refund_id,target_refund),
    failures=0,last_error=null,provider_terminal=target_state<>'open' where id=j.id;
  if target_state in ('paid','refund_pending','refund_failed','refunded') and p.status not in ('captured','partially_refunded','refunded') then
    if target_intent is null then raise exception 'missing captured payment'; end if;
    -- Authoritative reconciliation may discover a late success after a prior terminal observation.
    if p.status in ('failed','cancelled','expired') then
      perform private.create_payment_attempt(j.restaurant_id,j.location_id,j.order_id,'late:'||j.id::text,'stripe_sandbox',j.session_id||':late');
    end if;
    perform private.apply_verified_payment_event(j.restaurant_id,j.location_id,j.order_id,'stripe_sandbox',j.session_id,
      'sync:'||j.id::text||':captured','payment_intent.succeeded','captured',p.amount_due_minor,p.currency_code,target_digest,statement_timestamp());
    if o.status in ('cancelled','rejected') or j.close_requested is not null or statement_timestamp()>=j.deadline then
      update public.online_payment_jobs set close_requested=coalesce(close_requested,'cancelled'),refund_state='requested' where id=j.id;
      perform private.close_online_order(j.order_id,coalesce(j.close_requested,'cancelled'));
    end if;
  elsif target_state='expired' and p.status='pending_customer' then
    perform private.apply_verified_payment_event(j.restaurant_id,j.location_id,j.order_id,'stripe_sandbox',j.session_id,
      'sync:'||j.id::text||':expired','checkout.session.expired','expired',p.amount_due_minor,p.currency_code,target_digest,statement_timestamp());
    perform private.close_online_order(j.order_id,coalesce(j.close_requested,'cancelled'));
  end if;
  if target_state='refunded' and p.status<>'refunded' then
    perform private.apply_verified_payment_event(j.restaurant_id,j.location_id,j.order_id,'stripe_sandbox',j.session_id,
      'sync:'||j.id::text||':refunded','refund.updated','refunded',p.amount_due_minor,p.currency_code,target_digest,statement_timestamp());
  end if;
  if target_state in ('refund_pending','refund_failed','refunded') then
    update public.online_payment_jobs set refund_state=case target_state when 'refunded' then 'succeeded'
      when 'refund_failed' then 'failed' else 'pending' end where id=j.id;
  end if;
  update public.online_payment_jobs set lease_token=null,lease_until=null,next_at=case
    when target_state='open' or target_state='refund_pending' or refund_state='requested' then statement_timestamp()+interval '5 seconds'
    when target_state='refund_failed' then null
    else statement_timestamp()+interval '6 hours' end where id=j.id;
end;
$$;
create function private.fail_online_payment_job(target_job uuid,target_lease uuid,target_manual boolean default false)
returns void language sql security definer set search_path='' as $$
  update public.online_payment_jobs set failures=failures+1,last_error=case when target_manual then 'manual_review' else 'provider_unavailable' end,
    lease_token=null,lease_until=null,next_at=case when target_manual then null else
      statement_timestamp()+make_interval(secs=>least(300,5*power(2,least(failures,6)))::integer) end
    where id=target_job and lease_token=target_lease;
$$;
create function private.receive_online_payment_event(target_account text,target_event text,target_type text,target_object text,target_digest text)
returns void language plpgsql security definer set search_path='' as $$
declare old_event public.online_payment_inbox%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_account||':'||target_event,0));
  select * into old_event from public.online_payment_inbox where account_id=target_account and event_id=target_event;
  if old_event.event_id is not null then
    if old_event.payload_sha256<>target_digest or old_event.object_id<>target_object or old_event.event_type<>target_type
      then raise exception 'conflicting payment event'; end if;
    return;
  end if;
  insert into public.online_payment_inbox(account_id,event_id,event_type,object_id,payload_sha256)
    values(target_account,target_event,target_type,target_object,target_digest);
  update public.online_payment_jobs set next_at=statement_timestamp() where account_id=target_account
    and (session_id=target_object or intent_id=target_object or refund_id=target_object);
end;
$$;

create function private.guard_online_order_transition() returns trigger language plpgsql security definer set search_path='' as $$
declare j public.online_payment_jobs%rowtype; p public.order_payments%rowtype;
begin
  select * into j from public.online_payment_jobs where order_id=old.id;
  if j.id is null or new.status=old.status then return new; end if;
  select * into p from public.order_payments where order_id=old.id;
  if new.status='accepted' and (j.close_requested is not null or j.refund_state<>'none' or p.status<>'captured')
    then raise exception 'online order is not ready for acceptance'; end if;
  if new.status in ('cancelled','rejected') then
    if not j.provider_terminal then raise exception 'online cancellation needs provider confirmation'; end if;
    update public.online_payment_jobs set close_requested=new.status,
      refund_state=case when p.status='captured' and refund_state='none' then 'requested' else refund_state end,
      next_at=statement_timestamp() where id=j.id;
  end if;
  return new;
end;
$$;
create trigger orders_online_transition_guard before update on public.orders for each row execute function private.guard_online_order_transition();

alter table public.online_payment_jobs enable row level security;
alter table public.online_refund_retries enable row level security;
alter table public.online_refund_retries force row level security;
revoke all on public.online_refund_retries from public,anon,authenticated,service_role;
alter table public.online_payment_jobs force row level security;
alter table public.online_payment_inbox enable row level security;
alter table public.online_payment_inbox force row level security;
revoke all on public.online_payment_jobs,public.online_payment_inbox from public,anon,authenticated,service_role;
revoke all on function private.close_online_order(uuid,text),private.guard_online_order_transition() from public,anon,authenticated,service_role;
revoke all on function private.submit_public_guest_online_order(text,text,uuid,uuid,timestamptz,jsonb,text,jsonb,text,jsonb,jsonb,text,integer,text),
 private.read_online_payment_job(text,uuid),private.claim_online_payment_job(text,uuid,uuid),private.bind_online_payment_session(uuid,uuid,text),
 private.sync_online_payment(uuid,uuid,text,text,text,text),private.fail_online_payment_job(uuid,uuid,boolean),
 private.receive_online_payment_event(text,text,text,text,text) from public,anon,authenticated;
grant execute on function private.submit_public_guest_online_order(text,text,uuid,uuid,timestamptz,jsonb,text,jsonb,text,jsonb,jsonb,text,integer,text),
 private.read_online_payment_job(text,uuid),private.claim_online_payment_job(text,uuid,uuid),private.bind_online_payment_session(uuid,uuid,text),
 private.sync_online_payment(uuid,uuid,text,text,text,text),private.fail_online_payment_job(uuid,uuid,boolean),
 private.receive_online_payment_event(text,text,text,text,text) to service_role;
