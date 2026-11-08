-- A scheduled observation has no user session. Human audit actions still require one.
alter table private.support_audit alter column actor_user_id drop not null;
alter table private.support_audit add constraint support_audit_human_actor_required
  check (provenance <> 'human' or actor_user_id is not null);

create table private.support_reconcile_cursors (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  after_location uuid not null,
  after_kind text not null,
  after_source uuid not null
);
alter table private.support_reconcile_cursors enable row level security;
revoke all on private.support_reconcile_cursors from public,anon,authenticated,service_role;

create function private.reconcile_support_sources(target_restaurant uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare
  cursor_row private.support_reconcile_cursors%rowtype;
  candidate record;
  last_source uuid;
  last_location uuid;
  last_kind text;
  rows_seen integer := 0;
  new_cases integer := 0;
  old_case uuid;
  observed_case uuid;
begin
  if target_restaurant is null or not pg_try_advisory_xact_lock(hashtextextended(target_restaurant::text,4103))
  then return 0; end if;

  select * into cursor_row from private.support_reconcile_cursors where restaurant_id=target_restaurant;
  for candidate in
    select s.location_id,s.kind,s.source_id
    from private.support_sources s
    left join private.support_source_observations o using(restaurant_id,location_id,kind,source_id)
    where s.restaurant_id=target_restaurant
      and (s.is_problem or o.problem)
      and (o.fingerprint is distinct from s.fingerprint or o.problem is distinct from coalesce(s.is_problem,false))
      and (cursor_row.after_source is null or
           (s.location_id,s.kind,s.source_id)>(cursor_row.after_location,cursor_row.after_kind,cursor_row.after_source))
    order by s.location_id,s.kind,s.source_id limit 25
  loop
    last_location:=candidate.location_id;
    last_kind:=candidate.kind;
    last_source:=candidate.source_id;
    rows_seen:=rows_seen+1;
    -- Match the lock order of manual commands and defer a busy location to the next sweep.
    if not pg_try_advisory_xact_lock(hashtextextended(target_restaurant::text||last_location::text,4101))
    then continue; end if;
    select last_case_id into old_case from private.support_source_observations
    where restaurant_id=target_restaurant and location_id=last_location and kind=last_kind and source_id=last_source;
    observed_case:=private.support_observe(null,target_restaurant,last_location,last_kind,last_source,
      case when last_kind in ('payment_review','refund_failed','acceptance_overdue') then 'high' else 'normal' end,false);
    if observed_case is not null and observed_case is distinct from old_case then new_cases:=new_cases+1;end if;
  end loop;

  if rows_seen=25 then
    insert into private.support_reconcile_cursors(restaurant_id,after_location,after_kind,after_source)
    values(target_restaurant,last_location,last_kind,last_source)
    on conflict(restaurant_id) do update set after_location=excluded.after_location,
      after_kind=excluded.after_kind,after_source=excluded.after_source;
  else
    delete from private.support_reconcile_cursors where restaurant_id=target_restaurant;
  end if;
  return new_cases;
end $$;
revoke all on function private.reconcile_support_sources(uuid) from public,anon,authenticated;
grant execute on function private.reconcile_support_sources(uuid) to service_role;
