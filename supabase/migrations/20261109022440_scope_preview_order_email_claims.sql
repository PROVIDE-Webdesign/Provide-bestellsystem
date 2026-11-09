-- Keep historical preview deliveries and other recipients outside an opt-in SMTP trial.
create function private.claim_email_deliveries(target_lock uuid,batch_size integer,target_now timestamptz,
  target_created_since timestamptz,target_recipient text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; jobs jsonb:='[]'::jsonb; mode_name text;
begin
  if target_lock is null or batch_size is null or batch_size not between 1 and 25 or target_now is null or not isfinite(target_now)
    then raise exception 'invalid email claim'; end if;
  if (target_created_since is null) <> (target_recipient is null) or
     (target_recipient is not null and (not isfinite(target_created_since)
       or target_recipient !~ '^[a-z0-9.]+@gmail[.]com$'
       or not exists(select 1 from private.synthetic_test_environment where expires_at>target_now)))
    then raise exception 'invalid preview email scope'; end if;
  with expired as (
    select d.id from private.email_deliveries d where status='processing' and locked_at<=target_now-interval '5 minutes'
      and (target_recipient is null or exists(
        select 1 from public.orders o
        join public.order_customer_contacts c on c.order_id=o.id
          and c.restaurant_id=o.restaurant_id and c.location_id=o.location_id
        where o.id=d.order_id and o.created_at>=target_created_since and d.created_at>=target_created_since
          and lower(c.email)=target_recipient))
    order by locked_at,id limit batch_size for update skip locked
  ) update private.email_deliveries d set status='uncertain',lock_token=null,locked_at=null,
    last_error_code='worker_timeout',available_at=target_now from expired e where d.id=e.id;
  for candidate in
    select d.*,o.status as current_status,o.fulfillment_type,o.requested_for,o.currency_code,
      r.slug as restaurant_slug,r.display_name as restaurant_name,r.status as restaurant_status,
      l.slug as location_slug,l.status as location_status,l.timezone,
      concat_ws(', ',l.display_name,l.address_line_1,concat_ws(' ',l.postal_code,l.city)) as pickup_location,
      c.email,c.purged_at,c.retention_until,s.revision as current_revision,s.dispatched_at,
      p.collection_mode,p.status as payment_status,
      j.close_requested,j.refund_state
    from private.email_deliveries d join public.orders o on o.id=d.order_id
      join public.restaurants r on r.id=d.restaurant_id join public.locations l on l.id=d.location_id and l.restaurant_id=d.restaurant_id
      left join public.order_customer_contacts c on c.order_id=d.order_id and c.restaurant_id=d.restaurant_id and c.location_id=d.location_id
      left join private.order_communication_state s on s.order_id=d.order_id
      left join public.order_payments p on p.order_id=d.order_id
      left join public.online_payment_jobs j on j.order_id=d.order_id
    where d.status in ('queued','retry','uncertain') and d.available_at<=target_now
      and (target_recipient is null or (o.created_at>=target_created_since and d.created_at>=target_created_since
        and lower(c.email)=target_recipient))
      and (d.status='uncertain' or not (d.template_key='order_submitted' and o.status='submitted' and p.collection_mode='online'
        and (p.status<>'captured' or j.id is null or j.close_requested is not null or j.refund_state<>'none')))
    order by d.available_at,d.created_at,d.id limit batch_size for update of d skip locked
  loop
    -- Unknown sends must be reconciled before any suppression or resend.
    mode_name:=case when candidate.status='uncertain' then 'reconcile' else 'send' end;
    if mode_name='send' and (candidate.email is null or candidate.purged_at is not null or candidate.retention_until<=target_now) then
      update private.email_deliveries set status='suppressed',last_error_code='contact_unavailable' where id=candidate.id;
    elsif mode_name='send' and (candidate.requested_for+interval '48 hours'<=target_now or
      (candidate.target_status is not null and candidate.template_key<>'order_accepted' and candidate.current_status<>candidate.target_status) or
      (candidate.template_key in ('order_time_changed','order_accepted') and
        (candidate.current_status not in ('accepted','preparing','ready') or candidate.revision<>candidate.current_revision)) or
      (candidate.template_key='order_ready' and candidate.fulfillment_type<>'pickup')) then
      update private.email_deliveries set status='suppressed',last_error_code='superseded' where id=candidate.id;
    elsif mode_name='send' and candidate.collection_mode='online' and
      candidate.template_key in ('order_accepted','order_time_changed','order_ready','order_dispatched') and
      (candidate.payment_status<>'captured' or candidate.close_requested is not null or candidate.refund_state is distinct from 'none') then
      update private.email_deliveries set status='suppressed',last_error_code='payment_closing' where id=candidate.id;
    elsif mode_name='send' and (candidate.restaurant_status<>'active' or candidate.location_status<>'active' or
      not exists(select 1 from pg_catalog.pg_timezone_names where name=candidate.timezone)) then
      update private.email_deliveries set status='suppressed',last_error_code='scope_unavailable' where id=candidate.id;
    elsif candidate.attempt_count>=6 then
      update private.email_deliveries set status='dead_letter',last_error_code=case when mode_name='reconcile' then 'unconfirmed_acceptance' else 'attempts_exhausted' end where id=candidate.id;
    else
      update private.email_deliveries set status='processing',processing_mode=mode_name,attempt_count=attempt_count+1,lock_token=target_lock,
        locked_at=target_now where id=candidate.id;
      if mode_name='reconcile' then
        jobs:=jobs||jsonb_build_array(jsonb_build_object('deliveryId',candidate.id,'lockToken',target_lock,
          'mode','reconcile','templateVersion',candidate.template_version));
      else
      jobs:=jobs||jsonb_build_array(jsonb_build_object(
        'deliveryId',candidate.id,'lockToken',target_lock,'orderId',candidate.order_id,'mode',mode_name,
        'templateKey',candidate.template_key,'templateVersion',candidate.template_version,
        'restaurantSlug',candidate.restaurant_slug,'locationSlug',candidate.location_slug,
        'restaurantName',left(btrim(candidate.restaurant_name),160),'pickupLocation',left(btrim(candidate.pickup_location),600),
        'locationTimezone',candidate.timezone,'fulfillmentType',candidate.fulfillment_type,
        'email',candidate.email,
        'requestedFor',to_char(candidate.requested_for at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'confirmedFor',case when candidate.confirmed_for is not null then to_char(candidate.confirmed_for at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        'reasonCode',candidate.reason_code,'refundAmountMinor',candidate.refund_amount_minor,'currency',candidate.currency_code));
      end if;
    end if;
  end loop;
  return jobs;
end;
$$;

revoke all on function private.claim_email_deliveries(uuid,integer,timestamptz,timestamptz,text)
  from public,anon,authenticated;
grant execute on function private.claim_email_deliveries(uuid,integer,timestamptz,timestamptz,text)
  to service_role;

create or replace function private.claim_email_deliveries(target_lock uuid,batch_size integer,target_now timestamptz)
returns jsonb language sql security definer set search_path='' as $$
  select private.claim_email_deliveries(target_lock,batch_size,target_now,null,null);
$$;
