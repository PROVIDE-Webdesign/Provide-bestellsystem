-- Server-only subscriptions. One installation receives alarms for one selected location.
create table private.order_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique check (char_length(endpoint) between 1 and 1500),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth_key text not null check (auth_key ~ '^[A-Za-z0-9_-]{22}$'),
  actor_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  aal text not null check (aal in ('aal1','aal2')),
  restaurant_id uuid not null,
  location_id uuid not null,
  registered_at timestamptz not null default statement_timestamp(),
  foreign key (restaurant_id,location_id) references public.locations(restaurant_id,id) on delete cascade
);
create index order_push_subscriptions_scope on private.order_push_subscriptions(restaurant_id,location_id);
create index order_push_subscriptions_actor on private.order_push_subscriptions(actor_id);

create table private.order_push_deliveries (
  event_id uuid not null references private.order_acceptance_events(id),
  subscription_id uuid not null references private.order_push_subscriptions(id) on delete cascade,
  created_at timestamptz not null default statement_timestamp(),
  lease_token uuid not null,
  next_at timestamptz not null,
  delivered boolean not null default false,
  primary key (event_id,subscription_id)
);
create index order_push_delivery_expiry on private.order_push_deliveries(created_at);
create index order_push_recent_starts on private.order_acceptance_events(created_at)
  where kind='started';

alter table private.order_push_subscriptions enable row level security;
alter table private.order_push_subscriptions force row level security;
alter table private.order_push_deliveries enable row level security;
alter table private.order_push_deliveries force row level security;
revoke all on private.order_push_subscriptions,private.order_push_deliveries from public,anon,authenticated,service_role;

create function private.manage_order_push(actor uuid, session_id text, assurance text, command text,
  restaurant uuid, location uuid, endpoint_url text, public_key text, auth_secret text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.lock_account_session(actor,session_id,assurance) then
    return jsonb_build_object('outcome','forbidden');
  end if;

  if command='remove' then
    delete from private.order_push_subscriptions s where s.actor_id=actor and s.endpoint=endpoint_url;
    return jsonb_build_object('outcome','allowed','active',false);
  end if;

  if command not in ('status','subscribe') or
    private.dashboard_order_actor_role(restaurant,location,actor,assurance) is null or
    not coalesce(private.dashboard_order_allowed_transitions('submitted',
      private.dashboard_order_actor_role(restaurant,location,actor,assurance)) ? 'accepted',false) or
    not exists(select 1 from public.locations l where l.restaurant_id=restaurant and l.id=location) then
    return jsonb_build_object('outcome','forbidden');
  end if;

  if command='status' then
    return jsonb_build_object('outcome','allowed','active',exists (
      select 1 from private.order_push_subscriptions s
      where s.endpoint=endpoint_url and s.actor_id=actor and s.session_id=manage_order_push.session_id
        and s.restaurant_id=restaurant and s.location_id=location
    ));
  end if;

  -- A new account or scope on a shared installation replaces the prior subscription.
  if not exists(select 1 from private.order_push_subscriptions s where s.endpoint=endpoint_url and s.actor_id=actor)
    and (select count(*) from private.order_push_subscriptions s where s.actor_id=actor) >= 10 then
    return jsonb_build_object('outcome','conflict');
  end if;
  insert into private.order_push_subscriptions as s
    (endpoint,p256dh,auth_key,actor_id,session_id,aal,restaurant_id,location_id)
  values(endpoint_url,public_key,auth_secret,actor,session_id,assurance,restaurant,location)
  on conflict(endpoint) do update set
    p256dh=excluded.p256dh,auth_key=excluded.auth_key,actor_id=excluded.actor_id,
    session_id=excluded.session_id,aal=excluded.aal,restaurant_id=excluded.restaurant_id,
    location_id=excluded.location_id,registered_at=case
      when (s.actor_id,s.session_id,s.restaurant_id,s.location_id,s.p256dh,s.auth_key)
        is distinct from (excluded.actor_id,excluded.session_id,excluded.restaurant_id,excluded.location_id,excluded.p256dh,excluded.auth_key)
      then statement_timestamp() else s.registered_at end;
  return jsonb_build_object('outcome','allowed','active',true);
end $$;

-- An outbox row leases a recent acceptance event to one worker. Failed attempts retry
-- until the order is no longer actionable or the two-minute delivery window closes.
create function private.claim_order_push(batch_size integer)
returns jsonb language sql volatile security definer set search_path='' as $$
  with candidates as materialized (
    select e.id as event_id,s.id as subscription_id
    from private.order_acceptance_events e
    join private.order_acceptance_alerts a on a.order_id=e.order_id
    join private.order_push_subscriptions s on s.restaurant_id=e.restaurant_id and s.location_id=e.location_id
    left join private.order_push_deliveries d on d.event_id=e.id and d.subscription_id=s.id
    where e.kind='started' and e.created_at>statement_timestamp()-interval '2 minutes'
      and a.resolved_at is null and a.deadline>statement_timestamp() and e.created_at>=s.registered_at
      and (d.event_id is null or (not d.delivered and d.next_at<=statement_timestamp()))
      and private.account_session_live(s.actor_id,s.session_id,s.aal)
      and private.dashboard_order_actor_role(s.restaurant_id,s.location_id,s.actor_id,s.aal) is not null
      and private.dashboard_order_allowed_transitions('submitted',
        private.dashboard_order_actor_role(s.restaurant_id,s.location_id,s.actor_id,s.aal)) ? 'accepted'
      and private.order_acceptance_eligible(a.order_id)
    order by e.created_at,e.id,s.id
    limit greatest(0,least(batch_size,12))
  ), claimed as (
    insert into private.order_push_deliveries as d(event_id,subscription_id,lease_token,next_at)
      select event_id,subscription_id,gen_random_uuid(),statement_timestamp()+interval '30 seconds'
      from candidates order by event_id,subscription_id
    on conflict(event_id,subscription_id) do update set
      lease_token=excluded.lease_token,next_at=excluded.next_at
      where not d.delivered and d.next_at<=statement_timestamp()
    returning event_id,subscription_id,lease_token
  )
  select coalesce(jsonb_agg(jsonb_build_object('eventId',c.event_id,'subscriptionId',c.subscription_id,
    'lease',c.lease_token,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth_key)),'[]'::jsonb)
  from claimed c join private.order_push_subscriptions s on s.id=c.subscription_id;
$$;

create function private.finish_order_push(target_event uuid,target_subscription uuid,target_lease uuid,
  outcome text,target_endpoint text,target_key text,target_auth text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if outcome='gone' then
    delete from private.order_push_subscriptions s where s.id=target_subscription
      and (s.endpoint,s.p256dh,s.auth_key)=(target_endpoint,target_key,target_auth)
      and exists(select 1 from private.order_push_deliveries d where d.event_id=target_event
        and d.subscription_id=s.id and d.lease_token=target_lease);
  else
    update private.order_push_deliveries d set delivered=(outcome='sent')
      where d.event_id=target_event and d.subscription_id=target_subscription and d.lease_token=target_lease;
  end if;
  return 'true'::jsonb;
end $$;

create function private.cleanup_order_push()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  delete from private.order_push_deliveries where (event_id,subscription_id) in (
    select event_id,subscription_id from private.order_push_deliveries
    where created_at<statement_timestamp()-interval '1 day' order by created_at limit 1000
  );
  delete from private.order_push_subscriptions where id in (
    select s.id from private.order_push_subscriptions s where not private.account_session_live(s.actor_id,s.session_id,s.aal)
    limit 100
  );
  return 'true'::jsonb;
end $$;

revoke all on function private.manage_order_push(uuid,text,text,text,uuid,uuid,text,text,text),
  private.claim_order_push(integer),private.finish_order_push(uuid,uuid,uuid,text,text,text,text),
  private.cleanup_order_push() from public,anon,authenticated,service_role;
grant execute on function private.manage_order_push(uuid,text,text,text,uuid,uuid,text,text,text),
  private.claim_order_push(integer),private.finish_order_push(uuid,uuid,uuid,text,text,text,text),
  private.cleanup_order_push() to service_role;
