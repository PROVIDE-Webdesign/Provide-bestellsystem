-- A conclusive Stripe parameter rejection is an HTTP result, not a webhook.
-- Uncertain responses and any already-bound/attempted payment are never closed here.
create or replace function private.reject_online_payment_creation(
 target_job uuid,target_lease uuid,target_request text,target_digest text,target_mode text default 'test'
) returns void language plpgsql security definer set search_path='' as $function$
declare j public.online_payment_jobs%rowtype; o public.orders%rowtype; p public.order_payments%rowtype;
 provider text;
begin
 if target_request is null or target_request !~ '^req_[A-Za-z0-9]{1,240}$'
 or target_digest is null or target_digest !~ '^[a-f0-9]{64}$'
 or target_mode is null or target_mode not in ('test','live') then
  raise exception 'invalid checkout rejection evidence';
 end if;
 select a.* into o from public.orders a join public.online_payment_jobs b on b.order_id=a.id where b.id=target_job for update of a;
 select * into j from public.online_payment_jobs where id=target_job for update;
 if o.id is null or j.id is null or target_lease is null
 or j.lease_token is distinct from target_lease or j.lease_until is null or j.lease_until<=statement_timestamp()
 or j.stripe_mode<>target_mode or o.status<>'submitted'
 or j.session_id is not null or j.intent_id is not null or j.capture_requested_at is not null
 or j.refund_id is not null or j.refund_state<>'none' or j.provider_terminal
 or (j.close_requested is not null and j.close_requested not in ('cancelled','rejected')) then
  raise exception 'checkout rejection no longer matches an unbound job';
 end if;
 select * into p from public.order_payments where order_id=o.id for update;
 if p.id is null or p.collection_mode<>'online' or p.status<>'created'
 or p.captured_amount_minor<>0 or p.refunded_amount_minor<>0
 or exists(select 1 from public.payment_attempts where payment_id=p.id) then
  raise exception 'checkout rejection does not match an unattempted payment';
 end if;
 provider:=case when target_mode='live' then 'stripe_live' else 'stripe_sandbox' end;
 perform private.create_payment_attempt(j.restaurant_id,j.location_id,j.order_id,'create-failed:'||j.id::text,provider,target_request);
 perform private.apply_verified_payment_event(j.restaurant_id,j.location_id,j.order_id,provider,target_request,
  'create-failed:'||j.id::text,'checkout.session.create_failed','failed',p.amount_due_minor,p.currency_code,target_digest,statement_timestamp());
 update public.online_payment_jobs set provider_terminal=true,last_error=null,lease_token=null,lease_until=null where id=j.id;
 perform private.close_online_order(j.order_id,coalesce(j.close_requested,'cancelled'));
 update public.online_payment_jobs set next_at=null where id=j.id;
end;
$function$;
revoke all on function private.reject_online_payment_creation(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function private.reject_online_payment_creation(uuid,uuid,text,text,text) to service_role;
