-- Persist an attempt boundary before an external refund can be created. A lost
-- reply cannot authorize a fresh refund after provider idempotency can expire.
alter table public.online_payment_jobs
  add column refund_attempt_started_at timestamptz,
  add column refund_attempt_sequence integer,
  add constraint online_payment_jobs_refund_attempt_pair
    check ((refund_attempt_started_at is null) = (refund_attempt_sequence is null));

-- A legacy job might already have reached the provider without a stored refund
-- reference. Route such retries to review instead of guessing when they started.
update public.online_payment_jobs
set refund_attempt_started_at = '-infinity'::timestamptz,
    refund_attempt_sequence = refund_sequence
where refund_id is null
  and (refund_state in ('requested', 'pending') or close_requested is not null)
  and (failures > 0 or lease_token is not null or refund_state = 'pending');

create function private.reserve_online_refund_attempt(
  target_job uuid, target_lease uuid, target_sequence integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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

  if job.refund_attempt_sequence = target_sequence then
    return job.refund_attempt_started_at > claimed_at - interval '20 hours';
  end if;

  update public.online_payment_jobs
  set refund_attempt_started_at = claimed_at, refund_attempt_sequence = target_sequence
  where id = target_job;
  return true;
end;
$$;

revoke all on function private.reserve_online_refund_attempt(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function private.reserve_online_refund_attempt(uuid, uuid, integer)
  to service_role;
