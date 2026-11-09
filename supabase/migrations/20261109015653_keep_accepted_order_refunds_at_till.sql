-- Keep restaurant cancellations of accepted payments separate from technical reversals.
alter table public.online_payment_jobs
  add column refund_at_till boolean not null default false;

CREATE OR REPLACE FUNCTION private.guard_online_order_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.online_payment_jobs%rowtype; p public.order_payments%rowtype;
begin
  select * into j from public.online_payment_jobs where order_id=old.id;
  if j.id is null or new.status=old.status then return new; end if;
  select * into p from public.order_payments where order_id=old.id;
  if new.status='accepted' and (j.close_requested is not null or j.refund_state<>'none' or p.status<>'captured')
    then raise exception 'online order is not ready for acceptance'; end if;
  if new.status in ('cancelled','rejected') then
    if not j.provider_terminal then raise exception 'online cancellation needs provider confirmation'; end if;
    -- A restaurant cancellation after accepted payment is handled at the till.
    -- Preserve automatic compensation for a captured payment before acceptance.
    if new.status='cancelled' and old.status in ('accepted','preparing','ready')
      and p.status in ('captured','partially_refunded','refunded') and j.close_requested is null
      and j.refund_state='none' and j.refund_id is null then
      update public.online_payment_jobs
      set close_requested=new.status, refund_at_till=true, next_at=null
      where id=j.id;
      return new;
    end if;
    update public.online_payment_jobs set close_requested=new.status,
      refund_state=case when p.status='captured' and refund_state='none' then 'requested' else refund_state end,
      next_at=statement_timestamp() where id=j.id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.reserve_online_refund_attempt(target_job uuid, target_lease uuid, target_sequence integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  job public.online_payment_jobs%rowtype;
  claimed_at timestamptz := statement_timestamp();
begin
  if target_lease is null or target_sequence is null then
    raise exception 'refund attempt lease invalid';
  end if;

  select * into job from public.online_payment_jobs
  where id = target_job for update;

  if job.id is null or job.lease_token is distinct from target_lease
    or job.lease_until is null or job.lease_until <= claimed_at
    or job.refund_sequence is distinct from target_sequence
    or job.refund_id is not null
  then
    raise exception 'refund attempt lease invalid';
  end if;

  if job.refund_at_till then
    return false;
  end if;

  if job.refund_attempt_sequence = target_sequence then
    return job.refund_attempt_started_at > claimed_at - interval '20 hours';
  end if;

  update public.online_payment_jobs
  set refund_attempt_started_at = claimed_at, refund_attempt_sequence = target_sequence
  where id = target_job;
  return true;
end;
$function$;
