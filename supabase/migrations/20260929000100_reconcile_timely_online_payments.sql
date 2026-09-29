-- A payment confirmed before the reservation deadline remains valid when a worker runs later.
-- Existing webhook receipts can prove timeliness; future receipts also retain Stripe's signed event time.
alter table public.online_payment_inbox add column provider_created_at timestamptz;

drop function private.receive_online_payment_event(text,text,text,text,text);
create function private.receive_online_payment_event(
  target_account text,target_event text,target_type text,target_object text,
  target_digest text,target_created_at timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
declare old_event public.online_payment_inbox%rowtype; selected_order uuid;
begin
  if target_created_at is null or target_created_at > statement_timestamp()+interval '5 minutes'
    then raise exception 'invalid provider event time'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_account||':'||target_event,0));
  select * into old_event from public.online_payment_inbox where account_id=target_account and event_id=target_event;
  if old_event.event_id is not null then
    if old_event.payload_sha256<>target_digest or old_event.object_id<>target_object or old_event.event_type<>target_type
      or (old_event.provider_created_at is not null and old_event.provider_created_at is distinct from target_created_at)
      then raise exception 'conflicting payment event'; end if;
  else
    insert into public.online_payment_inbox(account_id,event_id,event_type,object_id,payload_sha256,provider_created_at)
      values(target_account,target_event,target_type,target_object,target_digest,target_created_at);
  end if;
  select order_id into selected_order from public.online_payment_jobs
    where account_id=target_account and (session_id=target_object or intent_id=target_object or refund_id=target_object);
  if selected_order is not null then
    update public.online_payment_jobs set next_at=statement_timestamp() where order_id=selected_order;
  end if;
  return selected_order;
end;
$$;
revoke all on function private.receive_online_payment_event(text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function private.receive_online_payment_event(text,text,text,text,text,timestamptz) to service_role;

create or replace function private.sync_online_payment(target_job uuid,target_lease uuid,target_state text,target_intent text,target_refund text,target_digest text)
returns void language plpgsql security definer set search_path='' as $$
declare j public.online_payment_jobs%rowtype; p public.order_payments%rowtype; o public.orders%rowtype;
  timely boolean:=false; late boolean:=false;
begin
  select o1.* into o from public.orders o1 join public.online_payment_jobs j1 on j1.order_id=o1.id where j1.id=target_job for update of o1;
  select * into j from public.online_payment_jobs where id=target_job for update;
  if j.id is null or target_lease is null or j.lease_until is null or j.lease_token is distinct from target_lease or j.lease_until<statement_timestamp()
    or target_state is null or target_state not in ('open','paid','expired','refund_pending','refund_failed','refunded')
    then raise exception 'payment reconciliation invalid'; end if;
  select * into p from public.order_payments where order_id=j.order_id for update;
  if target_intent is not null and j.intent_id is not null and target_intent<>j.intent_id then raise exception 'payment intent mismatch'; end if;
  if target_refund is not null and j.refund_id is not null and target_refund<>j.refund_id then raise exception 'refund mismatch'; end if;
  if target_state in ('paid','refund_pending','refund_failed','refunded')
    and p.status not in ('captured','partially_refunded','refunded')
    and o.status not in ('cancelled','rejected') and j.close_requested is null
    and statement_timestamp()>=j.deadline then
    select exists(select 1 from public.online_payment_inbox e
      where e.account_id=j.account_id and e.event_type in ('payment_intent.succeeded','checkout.session.completed')
        and e.object_id in (j.session_id,target_intent)
        and (e.received_at<=j.deadline or e.provider_created_at+interval '1 second'<=j.deadline)) into timely;
    select exists(select 1 from public.online_payment_inbox e
      where e.account_id=j.account_id and e.event_type in ('payment_intent.succeeded','checkout.session.completed')
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
    if o.status in ('cancelled','rejected') or j.close_requested is not null or (late and not timely) then
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
