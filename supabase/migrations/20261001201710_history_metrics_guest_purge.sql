-- Read-only restaurant history and bounded, auditable retention processing.
-- Reuse orders_location_created_idx (restaurant,location,created_at DESC,id DESC).
create table private.guest_purge_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default clock_timestamp(),
  cutoff timestamptz not null,
  purged_count integer not null check (purged_count between 0 and 500)
);
create index guest_purge_runs_latest_idx on private.guest_purge_runs(ran_at desc,id desc);
alter table private.guest_purge_runs enable row level security;
alter table private.guest_purge_runs force row level security;
revoke all on private.guest_purge_runs from public,anon,authenticated,service_role;
create trigger guest_purge_runs_append_only before update or delete on private.guest_purge_runs
for each row execute function private.prevent_order_record_mutation();
create function private.run_guest_retention_purge() returns integer
language plpgsql security definer set search_path='' as $$
declare cutoff_at timestamptz:=clock_timestamp(); n integer;
begin
  -- At most one invocation per five-minute window, across concurrent workers.
  if not pg_try_advisory_xact_lock(782613204) then return 0; end if;
  if exists(select 1 from private.guest_purge_runs where ran_at>cutoff_at-interval '5 minutes') then return 0; end if;
  n:=private.purge_expired_guest_checkout_data(cutoff_at,500);
  insert into private.guest_purge_runs(cutoff,purged_count) values(cutoff_at,n);
  return n;
end;
$$;
revoke all on function private.run_guest_retention_purge() from public,anon,authenticated;
grant execute on function private.run_guest_retention_purge() to service_role;

create function private.history_calendar_bounds(first_day date,last_day date,tz text)
returns table(start_at timestamptz,end_at timestamptz) language sql stable set search_path='' as $$
  select first_day::timestamp at time zone tz,(last_day+1)::timestamp at time zone tz;
$$;
revoke all on function private.history_calendar_bounds(date,date,text) from public,anon,authenticated,service_role;
create function private.read_order_history(actor uuid,aal text,restaurant uuid,location uuid,q jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor_role text; tz text; first_day date; last_day date; now_at timestamptz:=statement_timestamp();
  start_at timestamptz; end_at timestamptz; cursor_at timestamptz; cursor_id uuid;
  page_size integer:=coalesce((q->>'limit')::integer,25); rows jsonb; metrics jsonb; next_cursor text;
  detail jsonb:=null; native_detail jsonb; events jsonb; purge jsonb;
begin
  actor_role:=private.dashboard_order_actor_role(restaurant,location,actor,aal);
  if actor_role is null or actor_role not in ('owner','manager') or aal is distinct from 'aal2' then
    return jsonb_build_object('outcome','forbidden');
  end if;
  -- History stays available for suspended restaurant operations; membership still must be active.
  select l.timezone into tz from public.locations l where l.restaurant_id=restaurant and l.id=location;
  if tz is null then return jsonb_build_object('outcome','forbidden'); end if;
  if q is null or jsonb_typeof(q)<>'object' or exists(select 1 from jsonb_object_keys(q) k where k not in
    ('fromDate','toDate','status','fulfillmentType','orderNumber','customerName','cursor','limit','orderId')) then
    return jsonb_build_object('outcome','invalid');
  end if;
  first_day:=coalesce((q->>'fromDate')::date,date_trunc('week',now_at at time zone tz)::date);
  last_day:=coalesce((q->>'toDate')::date,(now_at at time zone tz)::date);
  if (q ? 'fromDate')<>(q ? 'toDate') or first_day>last_day or last_day-first_day>92 or
    first_day<date '2000-01-01' or page_size not between 1 and 50 or
    (q ? 'status' and coalesce(q->>'status','') not in ('submitted','accepted','preparing','ready','completed','rejected','cancelled')) or
    (q ? 'fulfillmentType' and coalesce(q->>'fulfillmentType','') not in ('pickup','delivery')) or
    (q ? 'orderNumber' and coalesce(q->>'orderNumber','') !~ '^BS-[0-9]{8,19}$') or
    (q ? 'customerName' and (coalesce(length(btrim(q->>'customerName')),0) not between 2 and 80 or q->>'customerName' ~ '[[:cntrl:]]')) then
    return jsonb_build_object('outcome','invalid');
  end if;
  select b.start_at,b.end_at into start_at,end_at from private.history_calendar_bounds(first_day,last_day,tz) b;
  if q ? 'cursor' then
    if coalesce(q->>'cursor','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[a-fA-F0-9-]{36}$' then
      return jsonb_build_object('outcome','invalid');
    end if;
    cursor_at:=split_part(q->>'cursor','|',1)::timestamptz;
    cursor_id:=split_part(q->>'cursor','|',2)::uuid;
  end if;
  -- One materialized, scoped cohort for totals, calendar buckets and page. No join fanout.
  with cohort as materialized (
    select o.*,p.collection_mode,p.captured_amount_minor,p.refunded_amount_minor,
      (o.created_at at time zone tz)::date as local_day
    from public.orders o join public.order_payments p on p.restaurant_id=o.restaurant_id and p.location_id=o.location_id and p.order_id=o.id
    where o.restaurant_id=restaurant and o.location_id=location and o.created_at>=start_at and o.created_at<end_at
      and (not(q ? 'status') or o.status=q->>'status')
      and (not(q ? 'fulfillmentType') or o.fulfillment_type=q->>'fulfillmentType')
      and (not(q ? 'orderNumber') or private.format_order_number(o.order_number)=q->>'orderNumber')
      and (not(q ? 'customerName') or exists(select 1 from public.order_customer_contacts c where c.restaurant_id=restaurant and c.location_id=location and c.order_id=o.id
        and c.purged_at is null and c.retention_until>now_at and strpos(lower(c.contact_name),lower(btrim(q->>'customerName')))>0))
  ), selected as (
    select c.*,row_number() over(order by c.created_at desc,c.id desc) as row_n
    from cohort c where cursor_at is null or (c.created_at,c.id)<(cursor_at,cursor_id)
    order by c.created_at desc,c.id desc limit page_size+1
  ), buckets as (
    select 'total'::text as period,first_day as day,c.* from cohort c
    union all select 'day',c.local_day,c.* from cohort c
    union all select 'week',date_trunc('week',c.local_day::timestamp)::date,c.* from cohort c
  ), aggregated as (
    select period,day,currency_code,count(*) as n,count(*) filter(where status='completed') as completed,
      count(*) filter(where status='rejected') as rejected,count(*) filter(where status='cancelled') as cancelled,
      count(*) filter(where fulfillment_type='pickup') as pickup,count(*) filter(where fulfillment_type='delivery') as delivery,
      coalesce(sum(total_amount_minor) filter(where status='completed'),0) as gross,
      sum(captured_amount_minor) as captured,sum(refunded_amount_minor) as refunded
    from buckets group by period,day,currency_code
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
      'orderId',s.id,'orderNumber',private.format_order_number(s.order_number),'status',s.status,
      'fulfillmentType',s.fulfillment_type,'paymentCollectionMode',s.collection_mode,'paymentState',private.online_payment_view(s.id),
      'requestedFor',to_char(s.requested_for at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'currency',s.currency_code,'totalAmountMinor',s.total_amount_minor,'itemCount',s.item_count,
      'updatedAt',to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'allowedTransitions','[]'::jsonb)
      order by s.created_at desc,s.id desc) filter(where s.row_n<=page_size),'[]'::jsonb) from selected s),
    (select case when count(*)>page_size then (select to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||s.id::text from selected s where s.row_n=page_size) end from selected),
    (select coalesce(jsonb_agg(jsonb_build_object('period',a.period,'date',a.day,'currency',a.currency_code,
      'orderCount',a.n,'completedCount',a.completed,'rejectedCount',a.rejected,'cancelledCount',a.cancelled,
      'pickupCount',a.pickup,'deliveryCount',a.delivery,'completedGrossMinor',a.gross,
      'averageCompletedMinor',case when a.completed=0 then null else round(a.gross/a.completed) end,
      'rejectionBasisPoints',round(a.rejected*10000.0/a.n),'capturedMinor',a.captured,'refundedMinor',a.refunded)
      order by a.period,a.day,a.currency_code),'[]'::jsonb) from aggregated a)
  into rows,next_cursor,metrics;
  if q ? 'orderId' then
    native_detail:=private.attach_order_number(private.read_dashboard_order(actor,aal,restaurant,location,(q->>'orderId')::uuid));
    if native_detail->>'outcome'<>'allowed' then return native_detail; end if;
    native_detail:=jsonb_set(native_detail,'{data,allowedTransitions}','[]'::jsonb);
    -- Retention expiry hides contacts even if the next scheduled batch has not run yet.
    if not exists(select 1 from public.order_customer_contacts c where c.restaurant_id=restaurant and c.location_id=location and c.order_id=(q->>'orderId')::uuid and c.purged_at is null and c.retention_until>now_at) then
      native_detail:=jsonb_set(native_detail,'{data,contactName}','null'::jsonb);
      if native_detail->'data' ? 'delivery' then native_detail:=jsonb_set(native_detail,'{data,delivery}','null'::jsonb); end if;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('sequence',e.event_sequence,'fromStatus',e.from_status,
      'toStatus',e.to_status,'actorKind',e.actor_kind,'at',to_char(e.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by e.event_sequence),'[]'::jsonb)
    into events from public.order_status_events e where e.restaurant_id=restaurant and e.location_id=location and e.order_id=(q->>'orderId')::uuid;
    detail:=jsonb_build_object('order',native_detail->'data','events',events);
  end if;
  -- Only cadence, never cross-tenant counts, is exposed to restaurant management.
  select jsonb_build_object('lastRunAt',to_char(p.ran_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    into purge from private.guest_purge_runs p order by p.ran_at desc,p.id desc limit 1;
  return jsonb_build_object('outcome','allowed','data',jsonb_build_object(
    'restaurantId',restaurant,'locationId',location,'timezone',tz,'fromDate',first_day,'toDate',last_day,
    'serverNow',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'orders',rows,'nextCursor',next_cursor,'metrics',metrics,'detail',detail,'purge',purge));
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  return jsonb_build_object('outcome','invalid');
end;
$$;
revoke all on function private.read_order_history(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.read_order_history(uuid,text,uuid,uuid,jsonb) to service_role;
