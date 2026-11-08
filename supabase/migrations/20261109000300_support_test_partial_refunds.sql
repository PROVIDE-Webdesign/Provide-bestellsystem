-- Support refunds are independently audited. This first path is confined to test payments.
create table private.support_partial_refunds (
  id uuid primary key,
  case_id uuid not null references private.support_cases(id),
  job_id uuid not null references public.online_payment_jobs(id),
  actor_user_id uuid not null,
  amount_minor integer not null check(amount_minor between 1 and 99999999),
  previous_refunded_minor bigint not null check(previous_refunded_minor>=0),
  reason text not null check(reason in ('customer_request','missing_item','service_issue')),
  state text not null default 'queued' check(state in ('queued','pending','succeeded','failed','review')),
  provider_ref text unique,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  next_at timestamptz not null default statement_timestamp(),
  first_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  check ((lease_token is null)=(lease_until is null))
);
create unique index support_partial_refunds_one_open on private.support_partial_refunds(job_id)
  where state in ('queued','pending','review');
create index support_partial_refunds_due on private.support_partial_refunds(next_at,id)
  where state in ('queued','pending');
alter table private.support_partial_refunds enable row level security;
revoke all on private.support_partial_refunds from public,anon,authenticated,service_role;

create function private.support_refund_projection(f private.support_partial_refunds) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('requestId',f.id,'amountMinor',f.amount_minor,'reason',f.reason,'state',f.state)
$$;
revoke all on function private.support_refund_projection(private.support_partial_refunds) from public,anon,authenticated,service_role;

create function private.request_support_partial_refund(
  actor uuid, session_id text, assurance text, target_restaurant uuid, target_location uuid,
  target_case uuid, request_id uuid, amount integer, refund_reason text, platform text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.support_cases%rowtype;
        j public.online_payment_jobs%rowtype;
        o public.orders%rowtype;
        p public.order_payments%rowtype;
        f private.support_partial_refunds%rowtype;
begin
  if assurance is distinct from 'aal2' or not private.lock_account_session(actor,session_id,assurance) then
    return jsonb_build_object('outcome','forbidden'); end if;
  perform 1 from private.support_grants where user_id=actor order by id for share;
  if not private.support_allowed(actor,target_restaurant,target_location,true) or
     coalesce(private.dashboard_order_actor_role(target_restaurant,target_location,actor,assurance),'') not in ('owner','manager') then
    return jsonb_build_object('outcome','forbidden'); end if;
  if request_id is null or amount is null or amount not between 1 and 99999999 or
     refund_reason is null or refund_reason not in ('customer_request','missing_item','service_issue') or
     coalesce(platform,'') !~ '^acct_[A-Za-z0-9]+$' then return jsonb_build_object('outcome','invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(target_restaurant::text||target_location::text,4101));
  select * into c from private.support_cases where id=target_case and restaurant_id=target_restaurant and location_id=target_location for share;
  if c.id is null or c.order_id is null then return jsonb_build_object('outcome','not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(request_id::text,4104));
  select * into f from private.support_partial_refunds where id=request_id;
  if found then
    if f.case_id<>c.id or f.actor_user_id<>actor or f.amount_minor<>amount or f.reason<>refund_reason then
      return jsonb_build_object('outcome','conflict'); end if;
    return jsonb_build_object('outcome','allowed','data',private.support_refund_projection(f));
  end if;
  if c.state='resolved' then return jsonb_build_object('outcome','conflict'); end if;

  -- Keep the existing online settlement lock order: job, order, payment.
  select * into j from public.online_payment_jobs where restaurant_id=target_restaurant and location_id=target_location
    and order_id=c.order_id and stripe_mode='test' and platform_account_id=platform for update;
  if j.id is null or not j.provider_terminal or j.session_id is null or j.intent_id is null or
     j.close_requested is not null or j.refund_state<>'none' or j.last_error is not null then
    return jsonb_build_object('outcome','conflict'); end if;
  select * into o from public.orders where id=j.order_id for update;
  select * into p from public.order_payments where restaurant_id=target_restaurant and location_id=target_location
    and order_id=j.order_id for update;
  if o.status is distinct from 'completed' or p.id is null or p.status not in ('captured','partially_refunded') or
     p.currency_code<>'EUR' or amount>=p.captured_amount_minor or
     amount>p.captured_amount_minor-p.refunded_amount_minor or exists (
       select 1 from private.support_partial_refunds where job_id=j.id and state in ('queued','pending','review')) then
    return jsonb_build_object('outcome','conflict'); end if;
  insert into private.support_partial_refunds(id,case_id,job_id,actor_user_id,amount_minor,previous_refunded_minor,reason)
    values(request_id,c.id,j.id,actor,amount,p.refunded_amount_minor,refund_reason) returning * into f;
  return jsonb_build_object('outcome','allowed','data',private.support_refund_projection(f));
end $$;

create function private.claim_support_partial_refund(platform text, token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f private.support_partial_refunds%rowtype;
        j public.online_payment_jobs%rowtype;
        p public.order_payments%rowtype;
        checked_at timestamptz:=statement_timestamp();
begin
  if token is null or platform is null then return null; end if;
  select f0.* into f from private.support_partial_refunds f0 join public.online_payment_jobs j0 on j0.id=f0.job_id
  where j0.platform_account_id=platform and j0.stripe_mode='test' and f0.state in ('queued','pending') and f0.next_at<=checked_at
    and (f0.lease_until is null or f0.lease_until<checked_at) order by f0.next_at,f0.id limit 1 for update of f0 skip locked;
  if f.id is null then return null; end if;
  select * into j from public.online_payment_jobs where id=f.job_id;
  select * into p from public.order_payments where order_id=j.order_id and restaurant_id=j.restaurant_id and location_id=j.location_id;
  if f.provider_ref is null and ((f.first_attempt_at is not null and f.first_attempt_at<=checked_at-interval '20 hours')
      or j.close_requested is not null or j.refund_state<>'none' or j.last_error is not null or not j.provider_terminal
      or p.id is null or p.status not in ('captured','partially_refunded') or p.refunded_amount_minor<>f.previous_refunded_minor) then
    update private.support_partial_refunds set state='review',updated_at=checked_at,lease_token=null,lease_until=null where id=f.id;
    return jsonb_build_object('review',true);
  end if;
  update private.support_partial_refunds set first_attempt_at=coalesce(first_attempt_at,checked_at),
    lease_token=token,lease_until=checked_at+interval '2 minutes' where id=f.id;
  return jsonb_build_object('id',f.id,'jobId',j.id,'merchantAccount',j.account_id,'intent',j.intent_id,
    'providerRefund',f.provider_ref,'amount',f.amount_minor,'capturedAmount',p.captured_amount_minor);
end $$;

create function private.finish_support_partial_refund(request_id uuid, token uuid, result text, provider_id text, digest text)
returns text language plpgsql security definer set search_path='' as $$
declare f private.support_partial_refunds%rowtype;
        j public.online_payment_jobs%rowtype;
        p public.order_payments%rowtype;
        checked_at timestamptz:=statement_timestamp();
        cumulative bigint;
begin
  if result is null or result not in ('unknown','pending','succeeded','failed') or
     (result='unknown' and (provider_id is not null or digest is not null)) or
     (result<>'unknown' and (coalesce(provider_id,'') !~ '^re_[A-Za-z0-9]+$' or coalesce(digest,'') !~ '^[a-f0-9]{64}$')) then
    raise exception 'invalid support refund result'; end if;
  select * into f from private.support_partial_refunds where id=request_id for update;
  if f.id is null or token is null or f.lease_token is distinct from token or f.lease_until<=checked_at then return 'conflict'; end if;
  if result<>'unknown' and f.provider_ref is not null and f.provider_ref<>provider_id then
    result:='review'; provider_id:=null;
  end if;
  if result='succeeded' then
    select * into j from public.online_payment_jobs where id=f.job_id;
    select * into p from public.order_payments where order_id=j.order_id and restaurant_id=j.restaurant_id and location_id=j.location_id for update;
    cumulative:=f.previous_refunded_minor+f.amount_minor;
    if p.id is null or p.status not in ('captured','partially_refunded') or
       p.refunded_amount_minor<>f.previous_refunded_minor or cumulative>p.captured_amount_minor then
      result:='review';
    else
      perform private.apply_verified_payment_event(j.restaurant_id,j.location_id,j.order_id,'stripe_sandbox',j.session_id,
        'support-refund:'||f.id::text,'refund.updated',case when cumulative=p.captured_amount_minor then 'refunded' else 'partially_refunded' end,
        cumulative,p.currency_code,digest,checked_at);
    end if;
  end if;
  update private.support_partial_refunds set state=case when result='unknown' then f.state else result end,
    provider_ref=coalesce(f.provider_ref,provider_id), updated_at=checked_at,
    next_at=checked_at+case when result='pending' then interval '2 minutes' else interval '1 minute' end,
    lease_token=null,lease_until=null where id=f.id;
  return result;
end $$;
revoke all on function private.request_support_partial_refund(uuid,text,text,uuid,uuid,uuid,uuid,integer,text,text),
  private.claim_support_partial_refund(text,uuid),private.finish_support_partial_refund(uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function private.request_support_partial_refund(uuid,text,text,uuid,uuid,uuid,uuid,integer,text,text),
  private.claim_support_partial_refund(text,uuid),private.finish_support_partial_refund(uuid,uuid,text,text,text) to service_role;


create or replace function private.online_payment_view(target_order uuid) returns text language sql stable security definer set search_path='' as $$
 select case when j.last_error='manual_review' then 'review' when j.refund_state='succeeded' or p.status='refunded' then 'refunded'
 when j.refund_state='failed' then 'refund_failed' when j.refund_state in ('requested','pending') then 'refund_pending'
 when j.close_requested is not null and not j.provider_terminal then 'cancelling'
 when p.status='authorized' then case when j.capture_requested_at is null then 'authorized' else 'capture_pending' end
 when p.status in ('captured','partially_refunded') then 'paid' when p.status in ('expired','cancelled','failed') then 'expired'
 when j.last_error is not null or j.deadline<=statement_timestamp() then 'checking' else 'open' end
 from public.order_payments p join public.online_payment_jobs j on j.order_id=p.order_id where p.order_id=target_order;
$$;
