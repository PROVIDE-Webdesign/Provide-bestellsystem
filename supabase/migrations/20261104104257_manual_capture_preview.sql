-- Existing jobs retain their original Stripe request parameters.
alter table public.online_payment_jobs
 add column capture_method text not null default 'automatic' check (capture_method in ('automatic','manual')),
 add column capture_requested_at timestamptz,
 add column acceptance_deadline timestamptz,
 add column capture_actor uuid,
 add column capture_assurance text;

create or replace function private.sync_online_payment(target_job uuid,target_lease uuid,target_state text,target_intent text,target_refund text,target_digest text)
returns void language plpgsql security definer set search_path='' as $$
declare j public.online_payment_jobs%rowtype; p public.order_payments%rowtype; o public.orders%rowtype;
  timely boolean:=false; late boolean:=false;
begin
  select o1.* into o from public.orders o1 join public.online_payment_jobs j1 on j1.order_id=o1.id where j1.id=target_job for update of o1;
  select * into j from public.online_payment_jobs where id=target_job for update;
  if j.id is null or target_lease is null or j.lease_until is null or j.lease_token is distinct from target_lease or j.lease_until<statement_timestamp()
    or target_state is null or target_state not in ('open','authorized','paid','expired','refund_pending','refund_failed','refunded')
    then raise exception 'payment reconciliation invalid'; end if;
  select * into p from public.order_payments where order_id=j.order_id for update;
  if target_intent is not null and j.intent_id is not null and target_intent<>j.intent_id then raise exception 'payment intent mismatch'; end if;
  if target_refund is not null and j.refund_id is not null and target_refund<>j.refund_id then raise exception 'refund mismatch'; end if;
  if target_state='authorized' then
    if j.capture_method<>'manual' or target_intent is null or p.status not in ('pending_customer','authorized')
      then raise exception 'invalid authorization'; end if;
    if p.status='pending_customer' then
      perform private.apply_verified_payment_event(j.restaurant_id,j.location_id,j.order_id,'stripe_sandbox',j.session_id,
        'sync:'||j.id::text||':authorized','payment_intent.amount_capturable_updated','authorized',
        p.amount_due_minor,p.currency_code,target_digest,statement_timestamp());
    end if;
    update public.online_payment_jobs set intent_id=coalesce(intent_id,target_intent),
      acceptance_deadline=coalesce(acceptance_deadline,j.deadline),
      lease_token=null,lease_until=null,failures=0,last_error=null,
      next_at=statement_timestamp()+interval '5 seconds' where id=j.id;
    return;
  end if;
  if target_state in ('paid','refund_pending','refund_failed','refunded')
    and p.status not in ('captured','partially_refunded','refunded')
    and o.status not in ('cancelled','rejected') and j.close_requested is null
    and statement_timestamp()>=j.deadline and j.capture_method<>'manual' then
    select exists(select 1 from public.online_payment_inbox e
      where e.account_id=j.account_id and e.payment_succeeded
        and e.object_id in (j.session_id,target_intent)
        and (e.received_at<=j.deadline or e.provider_created_at+interval '1 second'<=j.deadline)) into timely;
    select exists(select 1 from public.online_payment_inbox e
      where e.account_id=j.account_id and e.payment_succeeded
        and e.object_id in (j.session_id,target_intent) and e.provider_created_at>=j.deadline) into late;
    if not timely and not late then
      -- A paid session without conclusive event time is held for review, never fulfilled or refunded by guesswork.
      update public.online_payment_jobs set intent_id=coalesce(intent_id,target_intent),last_error='manual_review',
        lease_token=null,lease_until=null,next_at=null where id=j.id;
      return;
    end if;
  end if;
  update public.online_payment_jobs set intent_id=coalesce(intent_id,target_intent),refund_id=coalesce(refund_id,target_refund),
    failures=0,last_error=null,provider_terminal=target_state<>'open' where id=j.id;
  if target_state in ('paid','refund_pending','refund_failed','refunded') and p.status not in ('captured','partially_refunded','refunded') then
    if target_intent is null then raise exception 'missing captured payment'; end if;
    if p.status in ('failed','cancelled','expired') then
      perform private.create_payment_attempt(j.restaurant_id,j.location_id,j.order_id,'late:'||j.id::text,'stripe_sandbox',j.session_id||':late');
    end if;
    perform private.apply_verified_payment_event(j.restaurant_id,j.location_id,j.order_id,'stripe_sandbox',j.session_id,
      'sync:'||j.id::text||':captured','payment_intent.succeeded','captured',p.amount_due_minor,p.currency_code,target_digest,statement_timestamp());
    if o.status in ('cancelled','rejected') or j.close_requested is not null or (late and not timely) or (j.capture_method='manual' and j.capture_requested_at is null) then
      update public.online_payment_jobs set close_requested=coalesce(close_requested,'cancelled'),refund_state='requested' where id=j.id;
      perform private.close_online_order(j.order_id,coalesce(j.close_requested,'cancelled'));
    end if;
    if j.capture_method='manual' and j.capture_requested_at is not null and o.status='submitted'
      and j.close_requested is null and target_state='paid' then
      perform private.transition_order_status(j.restaurant_id,j.location_id,j.order_id,'accepted',
        j.capture_actor,j.capture_assurance);
    end if;
  elsif target_state='expired' and p.status in ('pending_customer','authorized') then
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
create or replace function private.transition_dashboard_order_with_reason(
  actor uuid,aal text,restaurant uuid,location uuid,target_order uuid,expected_status text,target_status text,reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; result jsonb; state private.order_communication_state%rowtype;
begin
  if private.dashboard_order_actor_role(restaurant,location,actor,aal) is null then
    return jsonb_build_object('outcome','forbidden'); end if;
  select * into o from public.orders where restaurant_id=restaurant and location_id=location and id=target_order for update;
  if o.id is null then return jsonb_build_object('outcome','not_found'); end if;
  if o.status is distinct from expected_status then return jsonb_build_object('outcome','conflict'); end if;
  if reason is not null and (target_status not in ('rejected','cancelled') or
    reason not in ('unavailable','sold_out','customer_request','operational','unspecified')) then
    return jsonb_build_object('outcome','invalid'); end if;
  if not (private.dashboard_order_allowed_transitions(o.status,private.dashboard_order_actor_role(restaurant,location,actor,aal)) ? target_status)
    then return jsonb_build_object('outcome','forbidden'); end if;
  if target_status in ('accepted','rejected','cancelled') and exists (
    select 1 from public.online_payment_jobs j join public.order_payments p on p.order_id=j.order_id
    where j.order_id=o.id and j.capture_method='manual' and j.capture_requested_at is not null
      and p.status='authorized'
  ) then
    return jsonb_build_object('outcome','conflict');
  end if;
  if target_status='accepted' and o.status='submitted' then
    update public.online_payment_jobs j set capture_requested_at=statement_timestamp(),
      capture_actor=actor,capture_assurance=aal,next_at=statement_timestamp()
    where j.order_id=o.id and j.capture_method='manual' and j.close_requested is null
      and j.capture_requested_at is null and j.acceptance_deadline>statement_timestamp()
      and exists(select 1 from public.order_payments p where p.order_id=o.id and p.status='authorized');
    if found then
      return jsonb_build_object('outcome','updated','data',jsonb_build_object(
        'orderId',o.id,'status',o.status,'updatedAt',to_char(o.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
    end if;
  end if;
  if target_status not in ('cancelled','rejected') and exists(
    select 1 from public.order_payments p left join public.online_payment_jobs j on j.order_id=p.order_id
    where p.order_id=o.id and p.collection_mode='online' and
      (p.status<>'captured' or j.id is null or j.close_requested is not null or j.refund_state<>'none')) then
    return jsonb_build_object('outcome','conflict'); end if;
  result:=private.transition_dashboard_order_status(actor,aal,restaurant,location,target_order,expected_status,target_status);
  -- Capture the personnel reason in the same transaction, including provider-deferred closure.
  if result->>'outcome'='updated' and target_status in ('rejected','cancelled') then
    insert into private.order_communication_state(restaurant_id,location_id,order_id,reason_code,revision)
      values(restaurant,location,target_order,coalesce(reason,'unavailable'),1)
    on conflict(order_id) do update set reason_code=excluded.reason_code,revision=order_communication_state.revision+1
    returning * into state;
    insert into private.order_communication_events(restaurant_id,location_id,order_id,revision,action,reason_code,actor_user_id,authentication_assurance)
      values(restaurant,location,target_order,state.revision,'end_reason',state.reason_code,actor,aal);
    -- The status outbox may already have enqueued; persist the known reason on that job.
    update private.email_deliveries set reason_code=state.reason_code where order_id=target_order
      and template_key in ('order_rejected','order_cancelled') and status='queued';
  end if;
  return result;
end;
$$;
create or replace function private.online_payment_view(target_order uuid) returns text language sql stable security definer set search_path='' as $$
 select case when j.last_error='manual_review' then 'review' when j.refund_state='succeeded' then 'refunded'
 when j.refund_state='failed' then 'refund_failed' when j.refund_state in ('requested','pending') then 'refund_pending'
 when j.close_requested is not null and not j.provider_terminal then 'cancelling'
 when p.status='authorized' then case when j.capture_requested_at is null then 'authorized' else 'capture_pending' end
 when p.status='captured' then 'paid' when p.status in ('expired','cancelled','failed') then 'expired'
 when j.last_error is not null or j.deadline<=statement_timestamp() then 'checking' else 'open' end
 from public.order_payments p join public.online_payment_jobs j on j.order_id=p.order_id where p.order_id=target_order;
$$;

-- Keep all existing role checks and only expose acceptance on a payable reservation.
do $patch$
declare f record; body text; alias_name text; original text; replacement text; patched integer:=0;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in (
      'read_dashboard_orders','read_dashboard_fulfillment_orders','read_dashboard_order_before_email'
    )
  loop
    body:=pg_get_functiondef(f.oid);
    foreach alias_name in array array['selected','order_record'] loop
      original:='then case when actor_role in (''owner'',''manager'') and '||alias_name||'.status=''submitted'' then';
      replacement:='then case when '||alias_name||'.status=''submitted'' and (private.dashboard_order_allowed_transitions('||
        alias_name||'.status, actor_role) ? ''accepted'') and exists (select 1 from public.online_payment_jobs manual_job join '||
        'public.order_payments manual_payment on manual_payment.order_id=manual_job.order_id where manual_job.order_id='||
        alias_name||'.id and manual_job.capture_method=''manual'' and manual_job.close_requested is null and '||
        'manual_job.capture_requested_at is null and manual_job.acceptance_deadline>statement_timestamp() and '||
        'manual_payment.status=''authorized'') then private.dashboard_order_allowed_transitions('||
        alias_name||'.status, actor_role) when exists (select 1 from public.online_payment_jobs pending_job where pending_job.order_id='||
        alias_name||'.id and pending_job.capture_requested_at is not null and not pending_job.provider_terminal) then ''[]''::jsonb '||
        substring(original from 11);
      if strpos(body,original)>0 then
        execute replace(body,original,replacement);
        patched:=patched+1;
      end if;
    end loop;
  end loop;
  if patched<>3 then raise exception 'Unexpected dashboard projection count: %',patched; end if;
end;
$patch$;

-- Only new jobs created by the sandbox submission transaction opt in.
create function private.set_online_payment_capture_mode()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_setting('provide.manual_capture', true)='on' then
    new.capture_method:='manual';
  end if;
  return new;
end;
$$;
revoke all on function private.set_online_payment_capture_mode() from public,anon,authenticated,service_role;
create trigger online_payment_capture_mode before insert on public.online_payment_jobs
for each row execute function private.set_online_payment_capture_mode();
