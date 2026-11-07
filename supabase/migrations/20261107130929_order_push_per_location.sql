-- Keep existing registrations and their delivery history, with one row per device and location.
alter table private.order_push_subscriptions
  add constraint order_push_subscriptions_endpoint_scope_key unique (endpoint,restaurant_id,location_id),
  drop constraint order_push_subscriptions_endpoint_key;

create or replace function private.manage_order_push(actor uuid, session_id text, assurance text, command text,
  restaurant uuid, location uuid, endpoint_url text, public_key text, auth_secret text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.lock_account_session(actor,session_id,assurance) then
    return jsonb_build_object('outcome','forbidden');
  end if;

  if command in ('subscribe','remove','remove_scope') then
    -- Serialize changes for a shared browser installation.
    perform pg_advisory_xact_lock(hashtextextended('order_push:' || endpoint_url, 0));
  end if;

  if command in ('remove','remove_scope') then
    -- Old dashboards unsubscribe the browser after removal. Reject that command
    -- when it would also stop alarms for another location.
    if command='remove' and (select count(*) from private.order_push_subscriptions s
      where s.endpoint=endpoint_url) > 1 then
      return jsonb_build_object('outcome','conflict');
    end if;
    delete from private.order_push_subscriptions s
      where s.actor_id=actor and s.endpoint=endpoint_url
        and s.restaurant_id=restaurant and s.location_id=location;
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

  -- Keep the device limit independent of how many locations each device uses.
  if not exists(select 1 from private.order_push_subscriptions s where s.endpoint=endpoint_url and s.actor_id=actor)
    and (select count(distinct s.endpoint) from private.order_push_subscriptions s where s.actor_id=actor) >= 10 then
    return jsonb_build_object('outcome','conflict');
  end if;
  -- A shared installation must not deliver notifications for a previous account.
  delete from private.order_push_subscriptions s
    where s.endpoint=endpoint_url and s.actor_id<>actor;
  insert into private.order_push_subscriptions as s
    (endpoint,p256dh,auth_key,actor_id,session_id,aal,restaurant_id,location_id)
  values(endpoint_url,public_key,auth_secret,actor,session_id,assurance,restaurant,location)
  on conflict(endpoint,restaurant_id,location_id) do update set
    p256dh=excluded.p256dh,auth_key=excluded.auth_key,actor_id=excluded.actor_id,
    session_id=excluded.session_id,aal=excluded.aal,registered_at=case
      when (s.actor_id,s.session_id,s.restaurant_id,s.location_id,s.p256dh,s.auth_key)
        is distinct from (excluded.actor_id,excluded.session_id,excluded.restaurant_id,excluded.location_id,excluded.p256dh,excluded.auth_key)
      then statement_timestamp() else s.registered_at end;
  return jsonb_build_object('outcome','allowed','active',true);
end $$;

create or replace function private.finish_order_push(target_event uuid,target_subscription uuid,target_lease uuid,
  outcome text,target_endpoint text,target_key text,target_auth text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if outcome='gone' then
    -- A provider rejection concerns the device, but only the exact claimed
    -- subscription and key material may authorize removing its registrations.
    perform pg_advisory_xact_lock(hashtextextended('order_push:' || target_endpoint, 0));
    delete from private.order_push_subscriptions s
      using private.order_push_subscriptions claimed, private.order_push_deliveries d
      where claimed.id=target_subscription and d.subscription_id=claimed.id
        and d.event_id=target_event and d.lease_token=target_lease
        and (claimed.endpoint,claimed.p256dh,claimed.auth_key)=(target_endpoint,target_key,target_auth)
        and (s.endpoint,s.p256dh,s.auth_key)=(target_endpoint,target_key,target_auth);
  else
    update private.order_push_deliveries d set delivered=(outcome='sent')
      where d.event_id=target_event and d.subscription_id=target_subscription and d.lease_token=target_lease;
  end if;
  return 'true'::jsonb;
end $$;
