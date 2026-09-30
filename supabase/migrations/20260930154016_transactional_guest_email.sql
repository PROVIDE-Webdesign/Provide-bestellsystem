-- Separate email ledger: existing SMS contracts and historical nullable contacts remain valid.
alter function private.store_guest_checkout_snapshot(uuid,uuid,uuid,jsonb,jsonb,text,timestamptz)
  rename to store_guest_checkout_snapshot_before_email;
revoke all on function private.store_guest_checkout_snapshot_before_email(uuid,uuid,uuid,jsonb,jsonb,text,timestamptz)
  from public,anon,authenticated,service_role;
create function private.store_guest_checkout_snapshot(
  target_restaurant_id uuid,target_location_id uuid,target_order_id uuid,target_customer jsonb,
  target_delivery jsonb,target_privacy_notice_version text,target_retention_until timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.orders o where o.restaurant_id=target_restaurant_id
    and o.location_id=target_location_id and o.id=target_order_id) then
    raise exception using errcode='P0001',message='guest checkout order was not found';
  end if;
  if not exists(select 1 from public.order_customer_contacts c
    where c.restaurant_id=target_restaurant_id and c.location_id=target_location_id and c.order_id=target_order_id)
    and nullif(btrim(target_customer->>'email'),'') is null then
    raise exception using errcode='P0001',message='guest checkout email is required';
  end if;
  if target_customer->>'email' ~ '[[:cntrl:]]' then
    raise exception using errcode='P0001',message='guest checkout email is invalid';
  end if;
  return private.store_guest_checkout_snapshot_before_email(target_restaurant_id,target_location_id,
    target_order_id,target_customer,target_delivery,target_privacy_notice_version,target_retention_until);
end;
$$;
revoke all on function private.store_guest_checkout_snapshot(uuid,uuid,uuid,jsonb,jsonb,text,timestamptz)
  from public,anon,authenticated,service_role;

create table private.order_communication_state (
  restaurant_id uuid not null,
  location_id uuid not null,
  order_id uuid primary key,
  confirmed_for timestamptz,
  reason_code text not null default 'unspecified',
  dispatched_at timestamptz,
  revision integer not null default 0 check(revision >= 0),
  foreign key(restaurant_id,location_id,order_id) references public.orders(restaurant_id,location_id,id),
  check(reason_code in ('unavailable','sold_out','customer_request','operational','payment_expired','unspecified'))
);
create table private.order_communication_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  revision integer not null,
  action text not null check(action in ('confirm_time','dispatch','end_reason')),
  confirmed_for timestamptz,
  reason_code text,
  actor_user_id uuid not null references auth.users(id),
  authentication_assurance text not null check(authentication_assurance in ('aal1','aal2')),
  created_at timestamptz not null default statement_timestamp(),
  foreign key(restaurant_id,location_id,order_id) references public.orders(restaurant_id,location_id,id),
  unique(order_id,revision)
);
create function private.initialize_order_communication() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.to_status='accepted' then
    insert into private.order_communication_state(restaurant_id,location_id,order_id,confirmed_for,revision)
      select o.restaurant_id,o.location_id,o.id,o.requested_for,1 from public.orders o where o.id=new.order_id
    on conflict(order_id) do update set
      confirmed_for=coalesce(order_communication_state.confirmed_for,excluded.confirmed_for),
      revision=greatest(order_communication_state.revision,1);
  end if;
  return new;
end;
$$;
create trigger order_status_initialize_communication after insert on public.order_status_events
for each row execute function private.initialize_order_communication();

create function private.read_order_communication(target_order uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('confirmedFor',case when s.confirmed_for is not null then
    to_char(s.confirmed_for at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'dispatchedAt',case when s.dispatched_at is not null then
    to_char(s.dispatched_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'revision',coalesce(s.revision,0),'timezone',l.timezone)
  from public.orders o join public.locations l on l.id=o.location_id
    left join private.order_communication_state s on s.order_id=o.id where o.id=target_order
$$;

alter function private.read_dashboard_order(uuid,text,uuid,uuid,uuid) rename to read_dashboard_order_before_email;
revoke all on function private.read_dashboard_order_before_email(uuid,text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function private.read_dashboard_order(
  target_actor_user_id uuid,target_authentication_assurance text,target_restaurant_id uuid,target_location_id uuid,target_order_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result:=private.read_dashboard_order_before_email(target_actor_user_id,target_authentication_assurance,target_restaurant_id,target_location_id,target_order_id);
  if result->>'outcome'='allowed' then
    result:=jsonb_set(result,'{data,communication}',private.read_order_communication(target_order_id));
  end if;
  return result;
end;
$$;
alter function private.read_public_guest_order_status(text,text,uuid,timestamptz) rename to read_public_guest_order_status_before_email;
revoke all on function private.read_public_guest_order_status_before_email(text,text,uuid,timestamptz) from public,anon,authenticated,service_role;
create function private.read_public_guest_order_status(
  target_restaurant_slug text,target_location_slug text,target_order_id uuid,target_evaluated_at timestamptz default statement_timestamp()
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result:=private.read_public_guest_order_status_before_email(target_restaurant_slug,target_location_slug,target_order_id,target_evaluated_at);
  if result is null then return null; end if;
  return result || jsonb_build_object('communication',private.read_order_communication(target_order_id));
end;
$$;

create function private.transition_dashboard_order_with_reason(
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

create function private.update_order_communication(
  actor uuid,aal text,restaurant uuid,location uuid,target_order uuid,expected_status text,
  expected_revision integer,action text,confirmed_time timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; state private.order_communication_state%rowtype; role_name text; event uuid:=gen_random_uuid();
begin
  role_name:=private.dashboard_order_actor_role(restaurant,location,actor,aal);
  if role_name is null then return jsonb_build_object('outcome','forbidden'); end if;
  select * into o from public.orders where restaurant_id=restaurant and location_id=location and id=target_order for update;
  if o.id is null then return jsonb_build_object('outcome','not_found'); end if;
  select * into state from private.order_communication_state where order_id=o.id;
  if o.status is distinct from expected_status or coalesce(state.revision,0) is distinct from expected_revision
    then return jsonb_build_object('outcome','conflict'); end if;
  if action is null or action not in ('confirm_time','dispatch') or o.status not in ('accepted','preparing','ready')
    then return jsonb_build_object('outcome','invalid'); end if;
  if exists(select 1 from public.order_payments p left join public.online_payment_jobs j on j.order_id=p.order_id
    where p.order_id=o.id and p.collection_mode='online' and
      (p.status<>'captured' or j.id is null or j.close_requested is not null or j.refund_state<>'none')) then
    return jsonb_build_object('outcome','conflict'); end if;
  if action='dispatch' and (role_name not in ('owner','manager') or o.fulfillment_type<>'delivery' or o.status<>'ready')
    then return jsonb_build_object('outcome','forbidden'); end if;
  if state.dispatched_at is not null then return jsonb_build_object('outcome','conflict'); end if;
  if action='confirm_time' and (confirmed_time is null or not isfinite(confirmed_time) or
    confirmed_time<statement_timestamp() or confirmed_time>o.requested_for+interval '2 hours') then
    return jsonb_build_object('outcome','invalid'); end if;
  if action='dispatch' and confirmed_time is not null then return jsonb_build_object('outcome','invalid'); end if;
  if action='confirm_time' and confirmed_time is not distinct from state.confirmed_for then
    return jsonb_build_object('outcome','updated','data',private.read_order_communication(o.id)); end if;
  insert into private.order_communication_state(restaurant_id,location_id,order_id,confirmed_for,dispatched_at,revision)
    values(restaurant,location,o.id,case when action='confirm_time' then confirmed_time else o.requested_for end,
      case when action='dispatch' then statement_timestamp() end,coalesce(state.revision,0)+1)
  on conflict(order_id) do update set
    confirmed_for=case when action='confirm_time' then confirmed_time else order_communication_state.confirmed_for end,
    dispatched_at=case when action='dispatch' then statement_timestamp() else order_communication_state.dispatched_at end,
    revision=order_communication_state.revision+1
  returning * into state;
  insert into private.order_communication_events(id,restaurant_id,location_id,order_id,revision,action,confirmed_for,actor_user_id,authentication_assurance)
    values(event,restaurant,location,o.id,state.revision,action,state.confirmed_for,actor,aal);
  insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
    values(restaurant,'order',o.id,case when action='dispatch' then 'order.dispatched' else 'order.time_changed' end,
      jsonb_build_object('order_id',o.id,'location_id',location,'revision',state.revision,'confirmed_for',state.confirmed_for),
      'order-communication:'||event::text);
  return jsonb_build_object('outcome','updated','data',private.read_order_communication(o.id));
end;
$$;

create table private.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  outbox_event_id uuid not null references public.outbox_events(id),
  template_key text not null check(template_key in ('order_submitted','order_accepted','order_rejected','order_cancelled','order_ready','order_dispatched','order_time_changed','order_refunded')),
  template_version integer not null default 1 check(template_version=1),
  target_status text,
  confirmed_for timestamptz,
  revision integer not null default 0,
  reason_code text not null default 'unspecified' check(reason_code in ('unavailable','sold_out','customer_request','operational','payment_expired','unspecified')),
  refund_amount_minor bigint check(refund_amount_minor>0),
  status text not null default 'queued' check(status in ('queued','processing','retry','uncertain','accepted','delivered','bounced','suppressed','dead_letter')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 6),
  available_at timestamptz not null default statement_timestamp(),
  lock_token uuid,
  locked_at timestamptz,
  processing_mode text not null default 'send' check(processing_mode in ('send','reconcile')),
  provider_reference text check(provider_reference ~ '^[A-Za-z0-9:_-]{1,160}$'),
  accepted_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default statement_timestamp(),
  foreign key(restaurant_id,location_id,order_id) references public.orders(restaurant_id,location_id,id),
  unique(outbox_event_id,template_version),
  check((status='processing')=(lock_token is not null and locked_at is not null)),
  check(status not in ('accepted','delivered','bounced') or (accepted_at is not null and provider_reference is not null)),
  check((status='delivered')=(delivered_at is not null))
);
create index email_deliveries_dispatch on private.email_deliveries(available_at,created_at,id)
  where status in ('queued','retry','uncertain','processing');
create index email_deliveries_order_history on private.email_deliveries(restaurant_id,location_id,order_id,created_at,id);

create function private.enqueue_order_email() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; state private.order_communication_state%rowtype; template text; status_name text;
begin
  if new.event_version<>1 then return new; end if;
  if new.aggregate_type='order' then
    select * into o from public.orders where restaurant_id=new.restaurant_id and id=new.aggregate_id;
    if new.event_type='order.submitted' then template:='order_submitted'; status_name:='submitted';
    elsif new.event_type='order.status_changed' and new.payload->>'to_status' in ('accepted','rejected','cancelled','ready') then
      status_name:=new.payload->>'to_status';
      if status_name='ready' and o.fulfillment_type='delivery' then return new; end if;
      template:='order_'||status_name;
    elsif new.event_type='order.time_changed' then template:='order_time_changed';
    elsif new.event_type='order.dispatched' then template:='order_dispatched'; status_name:='ready';
    else return new; end if;
  elsif new.aggregate_type='payment' and new.event_type='payment.status_changed' and new.payload->>'to_status'='refunded' then
    select order_record.* into o from public.order_payments p join public.orders order_record on order_record.id=p.order_id
      where p.restaurant_id=new.restaurant_id and p.id=new.aggregate_id and p.status='refunded';
    template:='order_refunded';
  else return new; end if;
  if o.id is null then raise exception 'email order scope invalid'; end if;
  select * into state from private.order_communication_state where order_id=o.id;
  insert into private.email_deliveries(restaurant_id,location_id,order_id,outbox_event_id,template_key,target_status,
    confirmed_for,revision,reason_code,refund_amount_minor)
  values(o.restaurant_id,o.location_id,o.id,new.id,template,status_name,state.confirmed_for,coalesce(state.revision,0),
    coalesce(state.reason_code,case when status_name='rejected' then 'unavailable'
      when status_name='cancelled' and exists(select 1 from public.order_payments p where p.order_id=o.id and p.status='expired')
        then 'payment_expired' else 'unspecified' end),
    case when template='order_refunded' then (new.payload->>'refunded_amount_minor')::bigint end)
  on conflict(outbox_event_id,template_version) do nothing;
  return new;
end;
$$;
create trigger outbox_enqueue_order_email after insert on public.outbox_events
for each row execute function private.enqueue_order_email();

create function private.claim_email_deliveries(target_lock uuid,batch_size integer,target_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; jobs jsonb:='[]'::jsonb; mode_name text;
begin
  if target_lock is null or batch_size is null or batch_size not between 1 and 25 or target_now is null or not isfinite(target_now)
    then raise exception 'invalid email claim'; end if;
  with expired as (
    select id from private.email_deliveries where status='processing' and locked_at<=target_now-interval '5 minutes'
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

create function private.finish_email_delivery(target_id uuid,target_lock uuid,result text,error_code text,reference text,target_now timestamptz)
returns text language plpgsql security definer set search_path='' as $$
declare d private.email_deliveries%rowtype; next_status text;
begin
  if result is null or result not in ('accepted','temporary_failure','permanent_failure','unknown','not_found')
    or target_now is null or not isfinite(target_now) then raise exception 'invalid email completion'; end if;
  if result='accepted' and (reference is null or reference !~ '^[A-Za-z0-9:_-]{1,160}$' or error_code is not null)
    then raise exception 'invalid email acceptance'; end if;
  if result in ('temporary_failure','permanent_failure','unknown') and
    (error_code is null or error_code not in ('provider_timeout','provider_unavailable','provider_rate_limited',
      'destination_rejected','destination_invalid','content_rejected','adapter_request_failed','invalid_adapter_result','invalid_projection'))
    then raise exception 'invalid email error'; end if;
  select * into d from private.email_deliveries where id=target_id for update;
  if d.id is null or d.status<>'processing' or d.lock_token is distinct from target_lock or
    target_now<d.locked_at or d.locked_at<=target_now-interval '5 minutes' then return 'conflict'; end if;
  if result='not_found' and d.processing_mode<>'reconcile' then
    raise exception 'invalid email lookup completion'; end if;
  if result='accepted' then next_status:='accepted';
  elsif d.processing_mode='reconcile' and result<>'not_found' then next_status:='uncertain';
  elsif result='permanent_failure' then next_status:='dead_letter';
  elsif result='unknown' then next_status:='uncertain';
  elsif d.attempt_count>=6 then next_status:='dead_letter';
  else next_status:='retry'; end if;
  update private.email_deliveries set status=next_status,lock_token=null,locked_at=null,
    provider_reference=case when result='accepted' then reference else provider_reference end,
    accepted_at=case when result='accepted' then target_now else accepted_at end,
    last_error_code=case when result='accepted' then null when next_status='uncertain' then coalesce(error_code,'unconfirmed_acceptance')
      when next_status='dead_letter' then coalesce(error_code,'attempts_exhausted') else error_code end,
    available_at=target_now+case d.attempt_count when 1 then interval '30 seconds' when 2 then interval '2 minutes'
      when 3 then interval '10 minutes' when 4 then interval '30 minutes' else interval '2 hours' end
  where id=d.id;
  return next_status;
end;
$$;

create function private.record_email_delivery_receipt(target_id uuid,reference text,result text,target_now timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare d private.email_deliveries%rowtype;
begin
  if target_now is null or not isfinite(target_now) or result is null or result not in ('delivered','bounced')
    then raise exception 'invalid email receipt'; end if;
  select * into d from private.email_deliveries where id=target_id for update;
  if d.id is null or reference is distinct from d.provider_reference or d.status not in ('accepted','delivered','bounced')
    or target_now<d.accepted_at then return false; end if;
  if d.status=result then return true; end if;
  if d.status<>'accepted' then return false; end if;
  update private.email_deliveries set status=result,
    delivered_at=case when result='delivered' then target_now end,
    last_error_code=case when result='bounced' then 'destination_rejected' end where id=d.id;
  return true;
end;
$$;

create table private.email_retry_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references private.email_deliveries(id),
  actor_user_id uuid not null references auth.users(id),
  authentication_assurance text not null check(authentication_assurance='aal2'),
  previous_error_code text not null,
  created_at timestamptz not null default statement_timestamp()
);
create function private.retry_email_delivery(actor uuid,aal text,restaurant uuid,location uuid,target_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare d private.email_deliveries%rowtype;
begin
  if coalesce(private.dashboard_order_actor_role(restaurant,location,actor,aal),'') not in ('owner','manager')
    then return 'forbidden'; end if;
  select * into d from private.email_deliveries where id=target_id and restaurant_id=restaurant and location_id=location for update;
  if d.id is null then return 'not_found'; end if;
  if d.status<>'dead_letter' or coalesce(d.last_error_code,'') not in ('destination_rejected','destination_invalid','content_rejected',
    'provider_unavailable','provider_rate_limited','attempts_exhausted','invalid_projection')
    then return 'conflict'; end if;
  insert into private.email_retry_events(delivery_id,actor_user_id,authentication_assurance,previous_error_code)
    values(d.id,actor,aal,d.last_error_code);
  update private.email_deliveries set status='retry',attempt_count=0,available_at=statement_timestamp() where id=d.id;
  return 'retry';
end;
$$;

alter table private.order_communication_state enable row level security;
alter table private.order_communication_state force row level security;
alter table private.order_communication_events enable row level security;
alter table private.order_communication_events force row level security;
alter table private.email_deliveries enable row level security;
alter table private.email_deliveries force row level security;
alter table private.email_retry_events enable row level security;
alter table private.email_retry_events force row level security;
revoke all on private.order_communication_state,private.order_communication_events,private.email_deliveries,private.email_retry_events
  from public,anon,authenticated,service_role;
revoke all on function private.initialize_order_communication(),private.read_order_communication(uuid),private.enqueue_order_email()
  from public,anon,authenticated,service_role;
revoke all on function private.read_dashboard_order(uuid,text,uuid,uuid,uuid),
  private.read_public_guest_order_status(text,text,uuid,timestamptz),
  private.transition_dashboard_order_with_reason(uuid,text,uuid,uuid,uuid,text,text,text),
  private.update_order_communication(uuid,text,uuid,uuid,uuid,text,integer,text,timestamptz),
  private.claim_email_deliveries(uuid,integer,timestamptz),
  private.finish_email_delivery(uuid,uuid,text,text,text,timestamptz),
  private.record_email_delivery_receipt(uuid,text,text,timestamptz),
  private.retry_email_delivery(uuid,text,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function private.read_dashboard_order(uuid,text,uuid,uuid,uuid),
  private.read_public_guest_order_status(text,text,uuid,timestamptz),
  private.transition_dashboard_order_with_reason(uuid,text,uuid,uuid,uuid,text,text,text),
  private.update_order_communication(uuid,text,uuid,uuid,uuid,text,integer,text,timestamptz),
  private.claim_email_deliveries(uuid,integer,timestamptz),
  private.finish_email_delivery(uuid,uuid,text,text,text,timestamptz),
  private.record_email_delivery_receipt(uuid,text,text,timestamptz),
  private.retry_email_delivery(uuid,text,uuid,uuid,uuid) to service_role;
comment on table private.email_deliveries is 'PII-free email ledger. Provider acceptance is separate from delivery; no real adapter is configured.';
comment on function private.update_order_communication(uuid,text,uuid,uuid,uuid,text,integer,text,timestamptz) is
  'Audited confirmation/ETA correction and explicit dispatch. Requested slot and reserved capacity stay immutable.';
