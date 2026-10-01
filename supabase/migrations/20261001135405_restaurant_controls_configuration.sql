-- B3/B4 reuse immutable availability schedules and delivery policies; no live activation.
alter table public.availability_schedule_versions
 add column revision integer not null default 0 check(revision>=0),
 add column order_cutoff_minutes integer not null default 0 check(order_cutoff_minutes between 0 and 1440),
 add column acceptance_minutes integer not null default 5 check(acceptance_minutes between 1 and 60),
 add column max_open_orders integer check(max_open_orders between 1 and 1000000),
 add column delivery_zones jsonb check(delivery_zones is null or jsonb_typeof(delivery_zones)='array');

create table private.location_operation_events(
 id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity,
 restaurant_id uuid not null, location_id uuid not null, scope text not null check(scope in ('all','pickup','delivery')),
 ends_at timestamptz, settings jsonb not null, reason text not null check(char_length(btrim(reason)) between 1 and 300),
 actor_user_id uuid not null references auth.users(id), created_at timestamptz not null default statement_timestamp(),
 foreign key(restaurant_id,location_id) references public.locations(restaurant_id,id),
 check(jsonb_typeof(settings)='object')
);
create index location_operation_events_current on private.location_operation_events(restaurant_id,location_id,scope,sequence desc);
alter table private.location_operation_events enable row level security;
revoke all on private.location_operation_events from public,anon,authenticated,service_role;
create trigger location_operation_events_immutable before update or delete on private.location_operation_events
 for each row execute function private.prevent_ordering_history_mutation();
create table private.location_configuration_audit(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null,location_id uuid not null,
 action text not null, actor_user_id uuid not null references auth.users(id),reason text not null,
 before_state jsonb,after_state jsonb,created_at timestamptz not null default statement_timestamp(),
 foreign key(restaurant_id,location_id) references public.locations(restaurant_id,id)
);
alter table private.location_configuration_audit enable row level security;
revoke all on private.location_configuration_audit from public,anon,authenticated,service_role;
create trigger location_configuration_audit_immutable before update or delete on private.location_configuration_audit
 for each row execute function private.prevent_ordering_history_mutation();

create function private.active_location_operations(r uuid,l uuid,f text,t timestamptz)
returns jsonb language sql stable security definer set search_path='' as $$
 with latest as (
  select distinct on(scope) scope,settings,ends_at from private.location_operation_events
  where restaurant_id=r and location_id=l and created_at<=t order by scope,sequence desc
 ), a as(select settings from latest where scope='all' and ends_at>t),
 c as(select settings from latest where scope=f and ends_at>t)
 select jsonb_build_object('paused',coalesce((select (settings->>'paused')::boolean from a),false) or coalesce((select (settings->>'paused')::boolean from c),false),
 'leadMinutes',coalesce((select settings->>'leadMinutes' from c),(select settings->>'leadMinutes' from a))::integer,
 'orderCapacity',coalesce((select settings->>'orderCapacity' from c),(select settings->>'orderCapacity' from a))::integer,
 'itemCapacity',coalesce((select settings->>'itemCapacity' from c),(select settings->>'itemCapacity' from a))::integer,
 'maxOpenOrders',coalesce((select settings->>'maxOpenOrders' from c),(select settings->>'maxOpenOrders' from a))::integer,
 'globalMaxOpenOrders',(select settings->>'maxOpenOrders' from a)::integer);
$$;
revoke all on function private.active_location_operations(uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;

create function private.location_ordering_paused(r uuid,l uuid,f text,t timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((private.active_location_operations(r,l,f,t)->>'paused')::boolean,false) or exists(
  select 1 from (select distinct on(fulfillment_type) event_kind,pause_until from public.ordering_pause_events
   where restaurant_id=r and location_id=l and (fulfillment_type is null or fulfillment_type=f) and created_at<=t
   order by fulfillment_type,event_sequence desc) p where event_kind='pause' and pause_until>t);
$$;
revoke all on function private.location_ordering_paused(uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;

create function private.location_open_order_count(r uuid,l uuid,f text default null)
returns integer language sql stable security definer set search_path='' as $$
 select count(*)::integer from public.orders where restaurant_id=r and location_id=l
 and (f is null or fulfillment_type=f) and status in ('submitted','accepted','preparing','ready');
$$;
revoke all on function private.location_open_order_count(uuid,uuid,text) from public,anon,authenticated,service_role;
create or replace function private.resolve_ordering_availability(
  target_restaurant_id uuid,
  target_location_id uuid,
  target_fulfillment_type text,
  target_requested_for timestamptz,
  target_requested_item_count integer default 1,
  target_evaluated_at timestamptz default now()
)
returns table (
  is_available boolean,
  reason_code text,
  schedule_version_id uuid,
  slot_start timestamptz,
  maximum_orders integer,
  maximum_items integer,
  reserved_orders integer,
  reserved_items integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  location_timezone text;
  resolved_schedule_id uuid;
  schedule public.availability_schedule_versions%rowtype;
  resolved_window record;
  local_requested_at timestamp;
  local_slot_start timestamp;
  resolved_slot_start timestamptz;
  operations jsonb;
  regular_max_open integer;
  global_max_open integer;
  channel_max_open integer;
  used_orders integer := 0;
  used_items integer := 0;
begin
  if target_fulfillment_type not in ('pickup', 'delivery') then
    return query select false, 'invalid_fulfillment'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if private.location_ordering_paused(target_restaurant_id,target_location_id,target_fulfillment_type,target_evaluated_at) then
    return query select false, 'manual_pause'::text, null::uuid, null::timestamptz,null::integer,null::integer,0,0;
    return;
  end if;
  if target_requested_item_count is null or target_requested_item_count <= 0 then
    return query select false, 'invalid_item_count'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  select location.timezone
  into location_timezone
  from public.locations as location
  where location.restaurant_id = target_restaurant_id
    and location.id = target_location_id
    and location.status = 'active';

  if location_timezone is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names as timezone
      where timezone.name = location_timezone
    )
  then
    return query select false, 'location_unavailable'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if not private.is_location_go_live(target_restaurant_id, target_location_id) then
    return query select false, 'go_live_closed'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if not private.is_restaurant_feature_enabled(target_restaurant_id, 'ordering.accept_orders') then
    return query select false, 'ordering_disabled'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if not private.is_restaurant_feature_enabled(
    target_restaurant_id,
    case
      when target_fulfillment_type = 'pickup' then 'fulfillment.pickup'
      else 'fulfillment.delivery'
    end
  ) then
    return query select false, 'fulfillment_disabled'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if not exists (
    select 1
    from public.menus as menu
    where menu.restaurant_id = target_restaurant_id
      and menu.status = 'active'
      and private.resolve_public_menu_version(
        target_restaurant_id,
        target_location_id,
        menu.id,
        target_evaluated_at
      ) is not null
  ) then
    return query select false, 'menu_unavailable'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  resolved_schedule_id := private.resolve_availability_schedule_version(
    target_restaurant_id,
    target_location_id,
    target_evaluated_at
  );

  if resolved_schedule_id is null then
    return query select false, 'schedule_unavailable'::text, null::uuid, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  select version.*
  into schedule
  from public.availability_schedule_versions as version
  where version.id = resolved_schedule_id;

  operations:=private.active_location_operations(target_restaurant_id,target_location_id,target_fulfillment_type,target_evaluated_at);
  schedule.minimum_lead_minutes:=coalesce((operations->>'leadMinutes')::integer,schedule.minimum_lead_minutes);
  regular_max_open:=schedule.max_open_orders;
  global_max_open:=coalesce((operations->>'globalMaxOpenOrders')::integer,regular_max_open);
  channel_max_open:=(operations->>'maxOpenOrders')::integer;
  if (global_max_open is not null and private.location_open_order_count(target_restaurant_id,target_location_id)>=global_max_open)
    or (channel_max_open is not null and private.location_open_order_count(target_restaurant_id,target_location_id,target_fulfillment_type)>=channel_max_open) then
    return query select false, 'capacity_exhausted'::text,resolved_schedule_id,null::timestamptz,null::integer,null::integer,0,0;
    return;
  end if;
  if target_requested_for < target_evaluated_at + make_interval(mins => schedule.minimum_lead_minutes) then
    return query select false, 'lead_time'::text, resolved_schedule_id, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if target_requested_for > target_evaluated_at + make_interval(days => schedule.maximum_advance_days) then
    return query select false, 'advance_horizon'::text, resolved_schedule_id, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  local_requested_at := target_requested_for at time zone location_timezone;

  select availability_result.*
  into resolved_window
  from private.resolve_availability_window(
    resolved_schedule_id,
    target_fulfillment_type,
    local_requested_at
  ) as availability_result;

  if resolved_window.window_start_local is null then
    return query select false, 'outside_window'::text, resolved_schedule_id, null::timestamptz,
      null::integer, null::integer, 0, 0;
    return;
  end if;

  if target_evaluated_at >= (resolved_window.window_end_local at time zone location_timezone)-make_interval(mins=>schedule.order_cutoff_minutes) then
    return query select false,'outside_window'::text,resolved_schedule_id,null::timestamptz,null::integer,null::integer,0,0;
    return;
  end if;
  resolved_window.order_capacity:=coalesce((operations->>'orderCapacity')::integer,resolved_window.order_capacity);
  resolved_window.item_capacity:=coalesce((operations->>'itemCapacity')::integer,resolved_window.item_capacity);
  local_slot_start := resolved_window.window_start_local
    + make_interval(
      mins => (
        floor(
          extract(epoch from (local_requested_at - resolved_window.window_start_local))
          / 60
          / schedule.slot_interval_minutes
        )::integer * schedule.slot_interval_minutes
      )
    );
  resolved_slot_start := local_slot_start at time zone location_timezone;

  select
    coalesce(sum(case when claim.claim_kind = 'reserve' then claim.order_count else -claim.order_count end), 0)::integer,
    coalesce(sum(case when claim.claim_kind = 'reserve' then claim.item_count else -claim.item_count end), 0)::integer
  into used_orders, used_items
  from public.ordering_capacity_claims as claim
  join public.availability_schedule_versions old_schedule on old_schedule.id=claim.schedule_version_id
  where claim.restaurant_id = target_restaurant_id
    and claim.location_id = target_location_id
    and claim.fulfillment_type = target_fulfillment_type
    and claim.slot_start < resolved_slot_start+make_interval(mins=>schedule.slot_interval_minutes)
    and resolved_slot_start < claim.slot_start+make_interval(mins=>old_schedule.slot_interval_minutes);

  if (
    resolved_window.order_capacity is not null
    and used_orders + 1 > resolved_window.order_capacity
  ) or (
    resolved_window.item_capacity is not null
    and used_items + target_requested_item_count > resolved_window.item_capacity
  ) then
    return query select false, 'capacity_exhausted'::text, resolved_schedule_id,
      resolved_slot_start, resolved_window.order_capacity, resolved_window.item_capacity,
      used_orders, used_items;
    return;
  end if;

  return query select true, 'available'::text, resolved_schedule_id,
    resolved_slot_start, resolved_window.order_capacity, resolved_window.item_capacity,
    used_orders, used_items;
end;
$$;


alter function private.reserve_ordering_capacity(uuid,uuid,text,timestamptz,integer,text,timestamptz) rename to reserve_ordering_capacity_before_location_controls;
revoke all on function private.reserve_ordering_capacity_before_location_controls(uuid,uuid,text,timestamptz,integer,text,timestamptz) from public,anon,authenticated,service_role;
create function private.reserve_ordering_capacity(r uuid,l uuid,f text,t timestamptz,n integer,k text,e timestamptz default now())
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('delivery-policy:'||l::text,0));
 return private.reserve_ordering_capacity_before_location_controls(r,l,f,t,n,k,e+(clock_timestamp()-statement_timestamp()));
end;$$;
revoke all on function private.reserve_ordering_capacity(uuid,uuid,text,timestamptz,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function private.reserve_ordering_capacity(uuid,uuid,text,timestamptz,integer,text,timestamptz) to service_role;
create or replace function private.sync_order_acceptance(target_order uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare a private.order_acceptance_alerts%rowtype; evaluated_at timestamptz:=clock_timestamp();
begin
  if private.order_acceptance_eligible(target_order) then
    insert into private.order_acceptance_alerts(order_id,restaurant_id,location_id,started_at,deadline)
      select id,restaurant_id,location_id,evaluated_at,evaluated_at+make_interval(mins=>coalesce((select acceptance_minutes from public.availability_schedule_versions v
        where v.id=private.resolve_availability_schedule_version(o.restaurant_id,o.location_id,evaluated_at)),5))
      from public.orders o where id=target_order on conflict(order_id) do nothing returning * into a;
    if a.order_id is not null then
      insert into private.order_acceptance_events(restaurant_id,location_id,order_id,kind,deadline)
        values(a.restaurant_id,a.location_id,a.order_id,'started',a.deadline);
    end if;
  else
    update private.order_acceptance_alerts set resolved_at=evaluated_at
      where order_id=target_order and resolved_at is null returning * into a;
    if a.order_id is not null then
      insert into private.order_acceptance_events(restaurant_id,location_id,order_id,kind,deadline)
        values(a.restaurant_id,a.location_id,a.order_id,'resolved',a.deadline);
    end if;
  end if;
end;
$$;

-- Bounded configuration projection; historical schedules retain native immutable rules.
create function private.location_configuration_json(v public.availability_schedule_versions)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('minimumLeadMinutes',v.minimum_lead_minutes,'maximumAdvanceDays',v.maximum_advance_days,
 'slotIntervalMinutes',v.slot_interval_minutes,'defaultOrderCapacity',v.default_order_capacity,'defaultItemCapacity',v.default_item_capacity,
 'orderCutoffMinutes',v.order_cutoff_minutes,'acceptanceMinutes',v.acceptance_minutes,'maxOpenOrders',v.max_open_orders,
 'windows',coalesce((select jsonb_agg(jsonb_build_object('fulfillment',w.fulfillment_type,'weekday',w.weekday,'opensAt',to_char(w.opens_at,'HH24:MI'),
  'closesAt',to_char(w.closes_at,'HH24:MI'),'orderCapacity',w.order_capacity,'itemCapacity',w.item_capacity) order by w.fulfillment_type,w.weekday,w.opens_at)
  from public.availability_windows w where w.schedule_version_id=v.id),'[]'::jsonb),
 'exceptions',coalesce((select jsonb_agg(jsonb_build_object('fulfillment',e.fulfillment_type,'date',e.local_date,'closed',e.availability_status='closed',
  'opensAt',to_char(e.opens_at,'HH24:MI'),'closesAt',to_char(e.closes_at,'HH24:MI'),'reason',coalesce(e.reason,'Sondertag'),
  'orderCapacity',e.order_capacity,'itemCapacity',e.item_capacity) order by e.local_date,e.fulfillment_type)
  from public.availability_exceptions e where e.schedule_version_id=v.id),'[]'::jsonb),
 'zones',coalesce(v.delivery_zones,(select d.zones from public.delivery_policy_versions d join public.delivery_policy_publications p on p.policy_id=d.id
  where p.restaurant_id=v.restaurant_id and p.location_id=v.location_id order by p.id desc limit 1),'[]'::jsonb));
$$;
revoke all on function private.location_configuration_json(public.availability_schedule_versions) from public,anon,authenticated,service_role;

create function private.location_operations_dashboard(actor uuid,aal text,r uuid,l uuid,command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare role_name text;timezone text;action text;reason text;version_id uuid;v public.availability_schedule_versions%rowtype;
 c jsonb;x jsonb;policy uuid;new_policy uuid;publication uuid;sequence_number bigint;event uuid;before_value jsonb;after_value jsonb;versions jsonb;overrides jsonb;audit jsonb;
begin
 role_name:=private.dashboard_order_actor_role(r,l,actor,aal);
 if aal is distinct from 'aal2' or role_name is null or role_name not in ('owner','manager') then return jsonb_build_object('outcome','forbidden');end if;
 select loc.timezone into timezone from public.locations loc where loc.restaurant_id=r and loc.id=l;
 if timezone is null then return jsonb_build_object('outcome','forbidden');end if;
 if command is not null then
  action:=command->>'action';reason:=btrim(command->>'reason');
  if reason is null or char_length(reason) not between 1 and 300 or reason ~ '[[:cntrl:]]' then return jsonb_build_object('outcome','invalid');end if;
  -- Same first lock as delivery checkout. Publication, overrides and final reservation cannot interleave.
  perform pg_advisory_xact_lock(hashtextextended('delivery-policy:'||l::text,0));
  select p.id into publication from public.availability_publications p where p.restaurant_id=r and p.location_id=l
   and p.effective_at<=statement_timestamp() order by p.effective_at desc,p.created_at desc,p.id desc limit 1;
  select p.policy_id into policy from public.delivery_policy_publications p where p.restaurant_id=r and p.location_id=l order by p.id desc limit 1;
  select coalesce(max(e.sequence),0) into sequence_number from private.location_operation_events e where e.restaurant_id=r and e.location_id=l;
  if action in ('override','clear_override') then
   if (command->>'expectedSequence')::bigint is distinct from sequence_number then return jsonb_build_object('outcome','conflict');end if;
   if command->>'scope' is null or command->>'scope' not in ('all','pickup','delivery') then return jsonb_build_object('outcome','invalid');end if;
   if action='override' then
    c:=command->'values';
    if jsonb_typeof(c) is distinct from 'object' or (c-array['paused','leadMinutes','orderCapacity','itemCapacity','maxOpenOrders'])<>'{}'::jsonb
     or not c ?& array['paused','leadMinutes','orderCapacity','itemCapacity','maxOpenOrders'] or jsonb_typeof(c->'paused') is distinct from 'boolean'
     or (command->>'endsAt')::timestamptz<=statement_timestamp() or (command->>'endsAt')::timestamptz>statement_timestamp()+interval '24 hours'
     then return jsonb_build_object('outcome','invalid');end if;
    if c->'leadMinutes'<>'null'::jsonb and (jsonb_typeof(c->'leadMinutes')<>'number' or (c->>'leadMinutes')!~'^[0-9]{1,5}$' or (c->>'leadMinutes')::integer>10080) then return jsonb_build_object('outcome','invalid');end if;
    foreach action in array array['orderCapacity','itemCapacity','maxOpenOrders'] loop
     if c->action<>'null'::jsonb and (jsonb_typeof(c->action)<>'number' or (c->>action)!~'^[0-9]{1,7}$' or (c->>action)::integer not between 1 and 1000000) then return jsonb_build_object('outcome','invalid');end if;
    end loop;
    action:=command->>'action';
   else c:=jsonb_build_object('paused',false,'leadMinutes',null,'orderCapacity',null,'itemCapacity',null,'maxOpenOrders',null);end if;
   perform private.set_ordering_pause(r,l,case when command->>'scope'='all' then null else command->>'scope' end,
    case when action='override' and (c->>'paused')::boolean then (command->>'endsAt')::timestamptz else null end,reason,actor,aal);
   select to_jsonb(e) into before_value from private.location_operation_events e where e.restaurant_id=r and e.location_id=l and e.scope=command->>'scope' order by e.sequence desc limit 1;
   insert into private.location_operation_events(restaurant_id,location_id,scope,ends_at,settings,reason,actor_user_id)
    values(r,l,command->>'scope',case when action='override' then (command->>'endsAt')::timestamptz else null end,c,reason,actor) returning id,to_jsonb(location_operation_events.*) into event,after_value;
  elsif action='create_draft' then
   version_id:=private.create_availability_schedule_draft(r,l,(command->>'sourceVersionId')::uuid,actor,aal);
   if command->>'sourceVersionId' is not null then
    select private.location_configuration_json(s) into c from public.availability_schedule_versions s where s.id=(command->>'sourceVersionId')::uuid and s.restaurant_id=r and s.location_id=l;
    update public.availability_schedule_versions set order_cutoff_minutes=(c->>'orderCutoffMinutes')::integer,
     acceptance_minutes=(c->>'acceptanceMinutes')::integer,max_open_orders=(c->>'maxOpenOrders')::integer,delivery_zones=c->'zones' where id=version_id;
   else
    update public.availability_schedule_versions set delivery_zones=coalesce((select zones from public.delivery_policy_versions where id=policy),'[]'::jsonb) where id=version_id;
   end if;
   select private.location_configuration_json(s) into after_value from public.availability_schedule_versions s where id=version_id;
  elsif action in ('save_draft','publish') then
   version_id:=(command->>'versionId')::uuid;
   select s.* into v from public.availability_schedule_versions s where s.id=version_id and s.restaurant_id=r and s.location_id=l for update;
   if v.id is null then return jsonb_build_object('outcome','forbidden');end if;
   if v.revision is distinct from (command->>'expectedRevision')::integer then return jsonb_build_object('outcome','conflict');end if;
   before_value:=private.location_configuration_json(v);
   if action='save_draft' then
    if v.status<>'draft' then return jsonb_build_object('outcome','conflict');end if;
    c:=command->'configuration';
    if jsonb_typeof(c) is distinct from 'object' or not c ?& array['minimumLeadMinutes','maximumAdvanceDays','slotIntervalMinutes','defaultOrderCapacity','defaultItemCapacity','orderCutoffMinutes','acceptanceMinutes','maxOpenOrders','windows','exceptions','zones'] or jsonb_typeof(c->'windows') is distinct from 'array' or jsonb_array_length(c->'windows')>100 or jsonb_typeof(c->'exceptions') is distinct from 'array' or jsonb_array_length(c->'exceptions')>366 or jsonb_typeof(c->'zones') is distinct from 'array' or jsonb_array_length(c->'zones')>100 then return jsonb_build_object('outcome','invalid');end if;
    -- Existing policy validator enforces all monetary/postcode/duplicate rules without publication.
    if jsonb_array_length(c->'zones')>0 then perform private.create_delivery_policy(actor,aal,r,l,c->'zones');end if;
    perform private.update_availability_schedule_draft(r,l,version_id,(c->>'minimumLeadMinutes')::integer,(c->>'maximumAdvanceDays')::integer,
     (c->>'slotIntervalMinutes')::integer,(c->>'defaultOrderCapacity')::integer,(c->>'defaultItemCapacity')::integer,actor,aal);
    update public.availability_schedule_versions set revision=revision+1,order_cutoff_minutes=(c->>'orderCutoffMinutes')::integer,
     acceptance_minutes=(c->>'acceptanceMinutes')::integer,max_open_orders=(c->>'maxOpenOrders')::integer,delivery_zones=c->'zones' where id=version_id;
    delete from public.availability_windows where schedule_version_id=version_id;
    for x in select value from jsonb_array_elements(c->'windows') loop
     insert into public.availability_windows(restaurant_id,location_id,schedule_version_id,fulfillment_type,weekday,opens_at,closes_at,order_capacity,item_capacity)
      values(r,l,version_id,x->>'fulfillment',(x->>'weekday')::smallint,(x->>'opensAt')::time,(x->>'closesAt')::time,(x->>'orderCapacity')::integer,(x->>'itemCapacity')::integer);
    end loop;
    delete from public.availability_exceptions where schedule_version_id=version_id;
    for x in select value from jsonb_array_elements(c->'exceptions') loop
     insert into public.availability_exceptions(restaurant_id,location_id,schedule_version_id,fulfillment_type,local_date,availability_status,opens_at,closes_at,reason,order_capacity,item_capacity)
      values(r,l,version_id,x->>'fulfillment',(x->>'date')::date,case when (x->>'closed')::boolean then 'closed' else 'custom_hours' end,
       (x->>'opensAt')::time,(x->>'closesAt')::time,x->>'reason',(x->>'orderCapacity')::integer,(x->>'itemCapacity')::integer);
    end loop;
   else
    if publication is distinct from (command->>'expectedPublicationId')::uuid or policy is distinct from (command->>'expectedDeliveryPolicyId')::uuid then return jsonb_build_object('outcome','conflict');end if;
    -- Pending legacy scheduled publications must be addressed separately, never silently supersede B4.
    if exists(select 1 from public.availability_publications where restaurant_id=r and location_id=l and effective_at>statement_timestamp()) then return jsonb_build_object('outcome','conflict');end if;
    c:=before_value;
    if exists(select 1 from public.availability_windows where schedule_version_id=version_id and fulfillment_type='delivery') and jsonb_array_length(c->'zones')=0 then return jsonb_build_object('outcome','invalid');end if;
    perform private.publish_availability_schedule(r,l,version_id,statement_timestamp(),actor,aal);
    if jsonb_array_length(c->'zones')>0 then
     new_policy:=private.create_delivery_policy(actor,aal,r,l,c->'zones');
     insert into private.delivery_tax_declarations(policy_id,restaurant_id,location_id,declaration,actor_user_id)
      select new_policy,r,l,declaration,actor from private.delivery_tax_declarations where policy_id=policy and restaurant_id=r and location_id=l;
     perform private.publish_delivery_policy(actor,aal,r,l,new_policy);
    end if;
   end if;
   select private.location_configuration_json(s) into after_value from public.availability_schedule_versions s where s.id=version_id;
  else return jsonb_build_object('outcome','invalid');end if;
  insert into private.location_configuration_audit(restaurant_id,location_id,action,actor_user_id,reason,before_state,after_state)
   values(r,l,action,actor,reason,before_value,after_value) returning id into event;
  insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
   values(r,'location_configuration',l,'location.configuration.'||action,jsonb_build_object('audit_id',event,'location_id',l,'actor_user_id',actor),'location-configuration:'||event::text);
 end if;
 select p.id into publication from public.availability_publications p where p.restaurant_id=r and p.location_id=l and p.effective_at<=statement_timestamp() order by p.effective_at desc,p.created_at desc,p.id desc limit 1;
 select p.policy_id into policy from public.delivery_policy_publications p where p.restaurant_id=r and p.location_id=l order by p.id desc limit 1;
 select coalesce(max(e.sequence),0) into sequence_number from private.location_operation_events e where e.restaurant_id=r and e.location_id=l;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'number',s.version_number,'status',s.status,'revision',s.revision,'configuration',private.location_configuration_json(s)) order by s.version_number desc),'[]'::jsonb)
 into versions from (select * from public.availability_schedule_versions where restaurant_id=r and location_id=l order by version_number desc limit 50) s;
 select coalesce(jsonb_agg(jsonb_build_object('scope',e.scope,'sequence',e.sequence,'endsAt',to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reason',e.reason,'values',e.settings) order by e.scope),'[]'::jsonb)
 into overrides from (select distinct on(scope) * from private.location_operation_events where restaurant_id=r and location_id=l order by scope,sequence desc) e where e.ends_at>statement_timestamp();
 select overrides||coalesce(jsonb_agg(jsonb_build_object('scope',coalesce(p.fulfillment_type,'all'),'sequence',0,'endsAt',to_char(p.pause_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'reason',coalesce(p.reason,'Bestehende Betriebspause'),'values',jsonb_build_object('paused',true,'leadMinutes',null,'orderCapacity',null,'itemCapacity',null,'maxOpenOrders',null))),'[]'::jsonb)
 into overrides from (select distinct on(fulfillment_type) * from public.ordering_pause_events where restaurant_id=r and location_id=l order by fulfillment_type,event_sequence desc) p
 where p.event_kind='pause' and p.pause_until>statement_timestamp() and not exists(select 1 from jsonb_array_elements(overrides) o where o->>'scope'=coalesce(p.fulfillment_type,'all'));
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'actorId',a.actor_user_id,'reason',a.reason,'createdAt',to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by a.created_at desc),'[]'::jsonb)
 into audit from (select * from private.location_configuration_audit where restaurant_id=r and location_id=l order by created_at desc,id desc limit 30) a;
 return jsonb_build_object('outcome','allowed','data',jsonb_build_object('timezone',timezone,'serverNow',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'publicationId',publication,'deliveryPolicyId',policy,
 'currentVersionId',private.resolve_availability_schedule_version(r,l,statement_timestamp()),'operationSequence',sequence_number,'openOrders',private.location_open_order_count(r,l),
 'versions',versions,'overrides',overrides,'audit',audit));
exception when invalid_text_representation or check_violation or unique_violation or datetime_field_overflow or raise_exception then
 return jsonb_build_object('outcome','invalid');
end;$$;
revoke all on function private.location_operations_dashboard(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.location_operations_dashboard(uuid,text,uuid,uuid,jsonb) to service_role;

-- Checkout lock order must be location -> submission -> menu -> slot in every channel.
-- Acquiring the new location lock only at reservation would invert delivery's existing
-- location -> menu order against pickup's menu -> location order and permit deadlocks.
alter function private.submit_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz) rename to submit_order_before_location_controls;
revoke all on function private.submit_order_before_location_controls(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz) from public,anon,authenticated,service_role;
create function private.submit_order(
 target_restaurant_id uuid,target_location_id uuid,target_menu_id uuid,target_menu_version_id uuid,
 target_fulfillment_type text,target_requested_for timestamptz,target_lines jsonb,target_submission_key text,
 target_evaluated_at timestamptz default now()
) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('delivery-policy:'||target_location_id::text,0));
 return private.submit_order_before_location_controls(target_restaurant_id,target_location_id,target_menu_id,target_menu_version_id,
  target_fulfillment_type,target_requested_for,target_lines,target_submission_key,target_evaluated_at);
end;$$;
revoke all on function private.submit_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz) from public,anon,authenticated,service_role;

alter function private.submit_priced_delivery_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz,uuid,bigint) rename to submit_priced_delivery_order_before_location_controls;
revoke all on function private.submit_priced_delivery_order_before_location_controls(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz,uuid,bigint) from public,anon,authenticated,service_role;
create function private.submit_priced_delivery_order(
 target_restaurant_id uuid,target_location_id uuid,target_menu_id uuid,target_menu_version_id uuid,
 target_fulfillment_type text,target_requested_for timestamptz,target_lines jsonb,target_submission_key text,
 target_evaluated_at timestamptz,target_policy_id uuid,target_fee bigint
) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('delivery-policy:'||target_location_id::text,0));
 return private.submit_priced_delivery_order_before_location_controls(target_restaurant_id,target_location_id,target_menu_id,target_menu_version_id,
  target_fulfillment_type,target_requested_for,target_lines,target_submission_key,target_evaluated_at,target_policy_id,target_fee);
end;$$;
revoke all on function private.submit_priced_delivery_order(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,text,timestamptz,uuid,bigint) from public,anon,authenticated,service_role;
