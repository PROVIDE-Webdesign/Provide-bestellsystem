-- A4: current provider state is authoritative; a signed JWT alone cannot reopen access.
create table private.account_security_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  blocked boolean not null default false,
  needs_review boolean not null default false,
  invalid_before timestamptz not null default '-infinity',
  revision bigint not null default 0 check (revision >= 0)
);
create table private.account_security_events (
  id bigint generated always as identity primary key,
  target_user_id uuid not null,
  actor_user_id uuid,
  source text not null check (source in ('application','provider_observation')),
  action text not null,
  factor_id uuid,
  revision bigint not null,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table private.account_security_state enable row level security;
alter table private.account_security_events enable row level security;
revoke all on private.account_security_state,private.account_security_events from public,anon,authenticated,service_role;

insert into private.account_security_state(user_id) select id from auth.users;
create function private.initialize_account_security() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.account_security_state(user_id) values(new.id);
  return new;
end $$;
create trigger initialize_account_security after insert on auth.users
for each row execute function private.initialize_account_security();

create function private.immutable_account_security_event() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Account security audit is immutable' using errcode='42501'; end $$;
create trigger immutable_account_security_event before update or delete on private.account_security_events
for each row execute function private.immutable_account_security_event();

-- This observation deliberately does not invent a human actor from a database role.
-- Controlled recovery will attribute its own command separately; raw provider deletion is fail closed.
create function private.observe_verified_factor_removal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r bigint;
begin
  if old.status::text <> 'verified' then return old; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.user_id::text, 4104));
  update private.account_security_state set blocked=true, needs_review=true,
    invalid_before=clock_timestamp(), revision=revision+1
  where user_id=old.user_id returning revision into r;
  -- Account deletion cascades may have removed its state already; do not prevent provider cleanup.
  if r is not null then
    insert into private.account_security_events(target_user_id,source,action,factor_id,revision)
    values(old.user_id,'provider_observation','verified_factor_removed',old.id,r);
  end if;
  return old;
end $$;
create trigger observe_verified_factor_removal after delete on auth.mfa_factors
for each row execute function private.observe_verified_factor_removal();

create function private.account_session_live(p_user uuid,p_session text,p_aal text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_aal in ('aal1','aal2') and exists (
    select 1 from auth.users u
    join private.account_security_state st on st.user_id=u.id
    join auth.sessions s on s.user_id=u.id and s.id::text=p_session
    where u.id=p_user and (u.banned_until is null or u.banned_until <= now())
      and not st.blocked and s.created_at > st.invalid_before
      and (s.not_after is null or s.not_after > now())
      and s.aal::text=p_aal
      and (p_aal='aal1' or exists (
        select 1 from auth.mfa_factors f where f.id=s.factor_id and f.user_id=u.id
        and f.status::text='verified' and f.factor_type::text='totp'
      ))
  ),false)
$$;
-- Only authenticated self-state is exposed to RLS, never an arbitrary target or a new RPC.
create function private.current_account_session_live() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.account_session_live(auth.uid(), auth.jwt()->>'session_id', auth.jwt()->>'aal')
$$;
-- Server transactions serialize with factor-removal / controlled recovery, and provider revocation.
create function private.lock_account_session(p_user uuid,p_session text,p_aal text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,4104));
  perform 1 from auth.sessions where user_id=p_user and id::text=p_session for share;
  return private.account_session_live(p_user,p_session,p_aal);
end $$;

-- Restrictive policies compose with all existing tenant/role policies. Anon storefront is unchanged.
do $$ declare t record;
begin
  for t in select n.nspname,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and c.relrowsecurity and
      (n.nspname='public' or (n.nspname='realtime' and c.relname='messages'))
  loop
    execute format('create policy account_session_required on %I.%I as restrictive for all to authenticated using ((select private.current_account_session_live())) with check ((select private.current_account_session_live()))',t.nspname,t.relname);
  end loop;
end $$;
revoke all on function private.initialize_account_security(), private.immutable_account_security_event(),
 private.observe_verified_factor_removal(), private.account_session_live(uuid,text,text),
 private.current_account_session_live(), private.lock_account_session(uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function private.current_account_session_live() to authenticated;
grant execute on function private.lock_account_session(uuid,text,text) to service_role;
