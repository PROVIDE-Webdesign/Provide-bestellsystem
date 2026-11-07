-- An authorized manual payment is actionable before capture. Its provider deadline
-- is authoritative. Automatic capture and payment at pickup keep their existing rules.
create or replace function private.order_acceptance_eligible(target_order uuid)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists (
    select 1 from public.orders o
    join public.order_payments p on p.order_id=o.id
    left join public.online_payment_jobs j on j.order_id=o.id
    where o.id=target_order and o.status='submitted' and (
      p.collection_mode='on_fulfillment' or (
        p.collection_mode='online' and j.close_requested is null and j.refund_state='none' and (
          (j.capture_method='automatic' and p.status='captured') or
          (j.capture_method='manual' and p.status='authorized' and j.capture_requested_at is null
            and j.acceptance_deadline>statement_timestamp())
        )
      )
    )
  );
$$;

create or replace function private.sync_order_acceptance(target_order uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare a private.order_acceptance_alerts%rowtype; evaluated_at timestamptz:=clock_timestamp();
begin
  if private.order_acceptance_eligible(target_order) then
    insert into private.order_acceptance_alerts(order_id,restaurant_id,location_id,started_at,deadline)
      select o.id,o.restaurant_id,o.location_id,evaluated_at,
        case when j.capture_method='manual' then j.acceptance_deadline
          else evaluated_at+make_interval(mins=>coalesce((select v.acceptance_minutes
            from public.availability_schedule_versions v
            where v.id=private.resolve_availability_schedule_version(o.restaurant_id,o.location_id,evaluated_at)),5))
        end
      from public.orders o left join public.online_payment_jobs j on j.order_id=o.id
      where o.id=target_order and (j.capture_method is distinct from 'manual' or j.acceptance_deadline>evaluated_at)
      on conflict(order_id) do nothing returning * into a;
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

-- Backfill only currently actionable manual authorizations, serialized with order operations.
do $$ declare target_order uuid; begin
  for target_order in
    select o.id from public.orders o join public.online_payment_jobs j on j.order_id=o.id
    where o.status='submitted' and j.capture_method='manual'
      and j.acceptance_deadline>statement_timestamp() for update of o
  loop
    perform private.sync_order_acceptance(target_order);
  end loop;
end $$;
