-- Private, PII-free invalidation hints. Never broadcast order rows or customer data.
create function private.dashboard_order_topic_allowed(target_topic text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare parts text[];
begin
  if auth.uid() is null then return false; end if;
  parts := regexp_match(target_topic,
    '^orders:v1:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$');
  if parts is null then return false; end if;
  return exists(select 1 from public.locations l where l.restaurant_id=parts[1]::uuid and l.id=parts[2]::uuid)
    and private.dashboard_order_actor_role(parts[1]::uuid,parts[2]::uuid,auth.uid(),auth.jwt()->>'aal') is not null;
end;
$$;
revoke all on function private.dashboard_order_topic_allowed(text) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_order_topic_allowed(text) to authenticated;
create policy dashboard_orders_private_receive on realtime.messages for select to authenticated
using (topic=(select realtime.topic()) and extension='broadcast' and (select private.dashboard_order_topic_allowed(realtime.topic())));
-- Restrictive guards keep this namespace protected if unrelated permissive policies are added later.
create policy dashboard_orders_private_boundary on realtime.messages as restrictive for select to authenticated
using (topic not like 'orders:v1:%' or
  (topic=(select realtime.topic()) and extension='broadcast' and (select private.dashboard_order_topic_allowed(realtime.topic()))));
create policy dashboard_orders_no_client_send on realtime.messages as restrictive for insert to anon,authenticated
with check (topic not like 'orders:v1:%' and (select realtime.topic()) not like 'orders:v1:%');
-- No INSERT/Presence policy: browsers cannot forge a server event.

create function private.invalidate_dashboard_orders(target_restaurant uuid,target_location uuid)
returns void language sql volatile security definer set search_path='' as $$
  select realtime.send(jsonb_build_object('schemaVersion',1,'eventId',gen_random_uuid()),
    'orders.invalidated.v1','orders:v1:'||target_restaurant::text||':'||target_location::text,true);
$$;
revoke all on function private.invalidate_dashboard_orders(uuid,uuid) from public,anon,authenticated,service_role;

-- Separate acceptance clock; payment deadlines and jobs are never mutated here.
create table private.order_acceptance_alerts (
  order_id uuid primary key,
  restaurant_id uuid not null,
  location_id uuid not null,
  started_at timestamptz not null,
  deadline timestamptz not null,
  escalated_at timestamptz,
  resolved_at timestamptz,
  foreign key(restaurant_id,location_id,order_id) references public.orders(restaurant_id,location_id,id),
  check(deadline>started_at),
  check(escalated_at is null or escalated_at>=deadline)
);
create index order_acceptance_pending_scope_idx on private.order_acceptance_alerts(restaurant_id,location_id,deadline,order_id) where resolved_at is null;
create index order_acceptance_due_idx on private.order_acceptance_alerts(deadline,order_id) where resolved_at is null and escalated_at is null;
create table private.order_acceptance_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  location_id uuid not null,
  order_id uuid not null,
  kind text not null check(kind in ('started','escalated','resolved')),
  created_at timestamptz not null default statement_timestamp(),
  deadline timestamptz not null,
  timeout_rule text not null default 'manual_review' check(timeout_rule='manual_review'),
  unique(order_id,kind),
  foreign key(restaurant_id,location_id,order_id) references public.orders(restaurant_id,location_id,id)
);
alter table private.order_acceptance_alerts enable row level security;
alter table private.order_acceptance_alerts force row level security;
alter table private.order_acceptance_events enable row level security;
alter table private.order_acceptance_events force row level security;
revoke all on private.order_acceptance_alerts,private.order_acceptance_events from public,anon,authenticated,service_role;
create function private.guard_acceptance_audit() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'acceptance audit is append-only'; end;
$$;
revoke all on function private.guard_acceptance_audit() from public,anon,authenticated,service_role;
create trigger acceptance_audit_immutable before update or delete on private.order_acceptance_events
for each row execute function private.guard_acceptance_audit();

create function private.order_acceptance_eligible(target_order uuid)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists(select 1 from public.orders o join public.order_payments p on p.order_id=o.id
    where o.id=target_order and o.status='submitted' and
      (p.collection_mode='on_fulfillment' or (p.collection_mode='online' and p.status='captured'
        and exists(select 1 from public.online_payment_jobs j where j.order_id=o.id and j.close_requested is null and j.refund_state='none'))));
$$;
revoke all on function private.order_acceptance_eligible(uuid) from public,anon,authenticated,service_role;
create function private.sync_order_acceptance(target_order uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare a private.order_acceptance_alerts%rowtype;
begin
  if private.order_acceptance_eligible(target_order) then
    insert into private.order_acceptance_alerts(order_id,restaurant_id,location_id,started_at,deadline)
      select id,restaurant_id,location_id,statement_timestamp(),statement_timestamp()+interval '5 minutes'
      from public.orders where id=target_order on conflict(order_id) do nothing returning * into a;
    if a.order_id is not null then
      insert into private.order_acceptance_events(restaurant_id,location_id,order_id,kind,deadline)
        values(a.restaurant_id,a.location_id,a.order_id,'started',a.deadline);
    end if;
  else
    update private.order_acceptance_alerts set resolved_at=statement_timestamp()
      where order_id=target_order and resolved_at is null returning * into a;
    if a.order_id is not null then
      insert into private.order_acceptance_events(restaurant_id,location_id,order_id,kind,deadline)
        values(a.restaurant_id,a.location_id,a.order_id,'resolved',a.deadline);
    end if;
  end if;
end;
$$;
revoke all on function private.sync_order_acceptance(uuid) from public,anon,authenticated,service_role;
create function private.dashboard_order_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare target_order uuid; r uuid; l uuid;
begin
  if tg_table_name='orders' then target_order:=new.id; r:=new.restaurant_id; l:=new.location_id;
  else target_order:=new.order_id; select restaurant_id,location_id into r,l from public.orders where id=target_order;
  end if;
  perform private.sync_order_acceptance(target_order);
  perform private.invalidate_dashboard_orders(r,l);
  return null;
end;
$$;
revoke all on function private.dashboard_order_changed() from public,anon,authenticated,service_role;
create trigger dashboard_order_changed after insert or update on public.orders for each row execute function private.dashboard_order_changed();
create trigger dashboard_payment_changed after insert or update on public.order_payments for each row execute function private.dashboard_order_changed();
-- Job close/refund changes can remove acceptance eligibility without changing payment status.
create trigger dashboard_online_job_changed after insert or update on public.online_payment_jobs for each row execute function private.dashboard_order_changed();
create trigger dashboard_communication_changed after insert or update on private.order_communication_state for each row execute function private.dashboard_order_changed();

create function private.escalate_order_acceptance(batch_size integer default 100)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare target_order uuid; alert_record private.order_acceptance_alerts%rowtype; affected integer:=0;
begin
  if batch_size not between 1 and 100 then raise exception 'invalid acceptance batch'; end if;
  -- Same lock order as personnel status changes: order first, alert second.
  for target_order in select o.id from public.orders o join private.order_acceptance_alerts a on a.order_id=o.id
    where a.resolved_at is null and a.escalated_at is null and a.deadline<=statement_timestamp()
    order by a.deadline,o.id limit batch_size for update of o skip locked loop
    perform private.sync_order_acceptance(target_order);
    update private.order_acceptance_alerts set escalated_at=statement_timestamp()
      where order_id=target_order and resolved_at is null and escalated_at is null and deadline<=statement_timestamp()
      returning * into alert_record;
    if alert_record.order_id is not null then
      insert into private.order_acceptance_events(restaurant_id,location_id,order_id,kind,deadline)
        values(alert_record.restaurant_id,alert_record.location_id,alert_record.order_id,'escalated',alert_record.deadline);
      perform private.invalidate_dashboard_orders(alert_record.restaurant_id,alert_record.location_id);
      affected:=affected+1;
    end if;
  end loop;
  return affected;
end;
$$;
revoke all on function private.escalate_order_acceptance(integer) from public,anon,authenticated,service_role;
grant execute on function private.escalate_order_acceptance(integer) to service_role;

create function private.read_dashboard_acceptance(target_actor uuid,target_aal text,target_restaurant uuid,target_location uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pending jsonb; total integer;
begin
  if private.dashboard_order_actor_role(target_restaurant,target_location,target_actor,target_aal) is null
    or not exists(select 1 from public.locations where id=target_location and restaurant_id=target_restaurant)
    then return jsonb_build_object('outcome','forbidden'); end if;
  select count(*) into total from private.order_acceptance_alerts a
    where a.restaurant_id=target_restaurant and a.location_id=target_location and a.resolved_at is null
    and private.order_acceptance_eligible(a.order_id);
  select coalesce(jsonb_agg(row_data order by deadline,order_id),'[]'::jsonb) into pending from (
    select a.deadline,a.order_id,jsonb_build_object('orderId',a.order_id,'orderNumber',private.format_order_number(o.order_number),
      'fulfillmentType',o.fulfillment_type,'deadline',to_char(a.deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'escalatedAt',to_char(a.escalated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as row_data
    from private.order_acceptance_alerts a join public.orders o on o.id=a.order_id
    where a.restaurant_id=target_restaurant and a.location_id=target_location and a.resolved_at is null
      and private.order_acceptance_eligible(a.order_id)
    order by a.deadline,a.order_id limit 100
  ) selected;
  return jsonb_build_object('outcome','allowed','data',jsonb_build_object('restaurantId',target_restaurant,'locationId',target_location,
    'serverNow',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'timeoutRule','manual_review','totalPending',total,'orders',pending));
end;
$$;
revoke all on function private.read_dashboard_acceptance(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.read_dashboard_acceptance(uuid,text,uuid,uuid) to service_role;

-- Existing actionable orders start a fresh clock on migration; no retroactive auto-rejection.
do $$ declare target_order uuid; begin
  for target_order in select id from public.orders where status='submitted' loop perform private.sync_order_acceptance(target_order); end loop;
end $$;
