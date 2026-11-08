-- These claims are scoped to one explicitly enabled integration. Existing
-- notification triggers keep using their own delivery tables.
alter table public.outbox_events add column webhook_lock_token uuid;

create function private.domain_webhook_claim(
  target_restaurant uuid, activation timestamptz, token uuid
) returns setof public.outbox_events
language plpgsql security invoker set search_path='' as $$
declare
  event_types constant text[] := array[
    'order.submitted', 'order.status_changed',
    'payment.status_changed', 'menu.version.published'
  ];
  checked_at timestamptz := statement_timestamp();
begin
  if target_restaurant is null or activation is null or not isfinite(activation) or token is null
  then raise exception 'invalid domain webhook claim'; end if;

  with exhausted as (
    select id from public.outbox_events
    where restaurant_id=target_restaurant and created_at>=activation and event_version=1
      and event_type=any(event_types) and status='processing' and attempt_count>=6
      and locked_at<=checked_at-interval '2 minutes'
    order by locked_at, id limit 25 for update skip locked
  )
  update public.outbox_events e
  set status='dead_letter', last_error='confirmation_unknown', locked_at=null, webhook_lock_token=null
  from exhausted x where e.id=x.id;

  return query
  with candidates as (
    select e.id from public.outbox_events e
    where e.restaurant_id=target_restaurant and e.created_at>=activation and e.event_version=1
      and e.event_type=any(event_types) and e.attempt_count<6
      and ((e.status in ('pending','retry') and e.available_at<=checked_at)
        or (e.status='processing' and e.locked_at<=checked_at-interval '2 minutes'))
      and not exists (
        select 1 from public.outbox_events predecessor
        where predecessor.restaurant_id=e.restaurant_id and predecessor.created_at>=activation
          and predecessor.event_version=1 and predecessor.event_type=any(event_types)
          and predecessor.aggregate_type=e.aggregate_type and predecessor.aggregate_id=e.aggregate_id
          and predecessor.status<>'published'
          and (predecessor.created_at, predecessor.id)<(e.created_at,e.id)
      )
    order by e.created_at,e.id limit 10 for update of e skip locked
  )
  update public.outbox_events e
  set status='processing', locked_at=checked_at, webhook_lock_token=token, attempt_count=e.attempt_count+1
  from candidates c where e.id=c.id returning e.*;
end;
$$;

create function private.domain_webhook_finish(
  event_id uuid, token uuid, outcome text
) returns text
language plpgsql security invoker set search_path='' as $$
declare
  checked_at timestamptz := statement_timestamp();
  next_status text;
begin
  if event_id is null or token is null or outcome is null or outcome not in (
    'accepted','temporary_failure','confirmation_unknown','request_rejected','invalid_event'
  ) then raise exception 'invalid domain webhook result'; end if;

  update public.outbox_events e
  set status=case when outcome='accepted' then 'published'
        when outcome in ('request_rejected','invalid_event') or e.attempt_count>=6 then 'dead_letter'
        else 'retry' end,
      published_at=case when outcome='accepted' then checked_at end,
      last_error=case when outcome='accepted' then null else outcome end,
      available_at=checked_at+make_interval(secs=>least(1800,30*(2^least(e.attempt_count-1,6))::integer)),
      locked_at=null, webhook_lock_token=null
  where e.id=event_id and e.status='processing' and e.webhook_lock_token=token
    and e.locked_at>checked_at-interval '2 minutes'
  returning e.status into next_status;
  return coalesce(next_status,'conflict');
end;
$$;

revoke all on function private.domain_webhook_claim(uuid,timestamptz,uuid),
  private.domain_webhook_finish(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.domain_webhook_claim(uuid,timestamptz,uuid),
  private.domain_webhook_finish(uuid,uuid,text) to service_role;

-- Controlled operator recovery. The regular dispatcher cannot authorize replays.
create table private.domain_webhook_recoveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.outbox_events(id) on delete restrict,
  previous_attempt_count integer not null,
  previous_error text not null,
  recovery_reason text not null check (recovery_reason in ('receiver_fixed','receiver_confirmed_absent')),
  database_actor text not null,
  created_at timestamptz not null default statement_timestamp()
);
alter table private.domain_webhook_recoveries enable row level security;
revoke all on private.domain_webhook_recoveries from public,anon,authenticated,service_role;
create trigger domain_webhook_recoveries_immutable before update or delete
on private.domain_webhook_recoveries for each row
execute function private.prevent_ordering_history_mutation();

create function private.recover_domain_webhook(
  target_restaurant uuid, target_event uuid, expected_attempt_count integer,
  expected_error text, reason text
) returns boolean
language plpgsql security invoker set search_path='' as $$
declare
  event public.outbox_events%rowtype;
begin
  if reason is null or reason not in ('receiver_fixed','receiver_confirmed_absent')
    or expected_error is null or expected_error not in (
      'request_rejected','confirmation_unknown','temporary_failure'
    )
    or (reason='receiver_fixed' and expected_error='confirmation_unknown')
  then return false; end if;

  select * into event from public.outbox_events
  where id=target_event and restaurant_id=target_restaurant for update;
  if event.id is null or event.status<>'dead_letter'
    or event.last_error is distinct from expected_error
    or event.attempt_count is distinct from expected_attempt_count
  then return false; end if;

  insert into private.domain_webhook_recoveries (
    event_id,previous_attempt_count,previous_error,recovery_reason,database_actor
  ) values (event.id,event.attempt_count,event.last_error,reason,current_user);
  update public.outbox_events
  set status='retry',attempt_count=0,available_at=statement_timestamp()
  where id=event.id;
  return true;
end;
$$;
revoke all on function private.recover_domain_webhook(uuid,uuid,integer,text,text)
from public,anon,authenticated,service_role;
