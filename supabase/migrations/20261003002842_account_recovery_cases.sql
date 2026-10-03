-- A4 bounded recovery. Empty grants/contacts: no real person receives authority in a migration.
create table private.account_recovery_grants (
 user_id uuid primary key references auth.users(id) on delete cascade,
 active boolean not null default true, revision bigint not null default 1 check(revision>0)
);
create table private.account_recovery_contacts (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 reference text not null check(reference ~ '^[A-Za-z0-9:_-]{1,120}$'),
 active boolean not null default true,created_at timestamptz not null default now()
);
create table private.account_recovery_cases (
 id uuid primary key, target_user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('password','replace_factor','lost_factor')),
 state text not null check(state in ('requested','verified','approved','executing','awaiting_reenrollment','completed','rejected','cancelled','expired','needs_review')),
 security_revision bigint, revision integer not null default 1, bound_session_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 approval_expires_at timestamptz,executing_at timestamptz,
 identity_snapshot text not null,factor_snapshot text not null,execution_factor_snapshot text,
 required_approvals integer not null check(required_approvals in (0,1,2)),
 contact_id uuid references private.account_recovery_contacts(id),evidence_reference text,
 new_factor_id uuid,old_factor_ids uuid[] not null default '{}',
 executor_user_id uuid,executor_session_id uuid
);
create unique index one_open_account_recovery on private.account_recovery_cases(target_user_id)
 where state in ('requested','verified','approved','executing','awaiting_reenrollment','needs_review');
create table private.account_recovery_approvals (
 case_id uuid not null references private.account_recovery_cases(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,session_id uuid not null,
 actor_snapshot text not null,grant_revision bigint not null,
 primary key(case_id,user_id)
);
create table private.account_recovery_audit (
 id bigint generated always as identity primary key,case_id uuid not null,
 target_user_id uuid not null,actor_user_id uuid not null,
 command_id uuid not null,source text not null default 'application' check(source='application'),action text not null,reason text not null,
 revision integer not null,recorded_at timestamptz not null default clock_timestamp()
);
create table private.account_recovery_receipts (
 actor_user_id uuid not null,command_id uuid not null,command jsonb not null,
 result jsonb not null,primary key(actor_user_id,command_id)
);
do $$ declare t text; begin
 foreach t in array array['account_recovery_grants','account_recovery_contacts','account_recovery_cases','account_recovery_approvals','account_recovery_audit','account_recovery_receipts'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
create trigger immutable_account_recovery_audit before update or delete on private.account_recovery_audit
 for each row execute function private.immutable_account_security_event();

create function private.recovery_identity_snapshot(u uuid) returns text
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email',a.email,'confirmed',a.email_confirmed_at,'banned',a.banned_until,
 'memberships',(select coalesce(jsonb_agg(to_jsonb(m) order by m.restaurant_id),'[]') from public.restaurant_memberships m where m.user_id=u),
 'locations',(select coalesce(jsonb_agg(to_jsonb(l) order by l.restaurant_id,l.location_id),'[]') from public.restaurant_membership_locations l where l.user_id=u),
 'recovery_grant',(select to_jsonb(g) from private.account_recovery_grants g where g.user_id=u),
 'contacts',(select coalesce(jsonb_agg(to_jsonb(k) order by k.id),'[]') from private.account_recovery_contacts k where k.user_id=u),
 'platform',(select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]') from private.provide_admin_grants g where g.user_id=u))::text
 from auth.users a where a.id=u
$$;
-- Snapshots are private server-only comparison values, never included in API/audit projections.
create function private.recovery_factor_snapshot(u uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'type',factor_type,'updated',updated_at) order by id),'[]')::text
 from auth.mfa_factors where user_id=u
$$;
create function private.recovery_factor_snapshot_except(u uuid,f uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'type',factor_type,'updated',updated_at) order by id),'[]')::text
 from auth.mfa_factors where user_id=u and id<>f
$$;
-- Only the claimed deletions may disappear during the external effect. No added,
-- modified or unrelated removed factor may silently inherit the previous approval.
create function private.recovery_factor_effect_consistent(c private.account_recovery_cases) returns boolean
language sql stable security definer set search_path='' as $$
 with current_factors as (select value f from jsonb_array_elements(private.recovery_factor_snapshot(c.target_user_id)::jsonb)),
 expected_factors as (select value f from jsonb_array_elements(c.execution_factor_snapshot::jsonb))
 select c.execution_factor_snapshot is not null
 and not exists(select 1 from current_factors x where not exists(select 1 from expected_factors e where e.f=x.f))
 and not exists(select 1 from expected_factors e where
   (c.kind='password' or not (e.f->>'id')::uuid=any(c.old_factor_ids))
   and not exists(select 1 from current_factors x where x.f=e.f))
$$;
create function private.recovery_provider_session(u uuid,sid uuid,a text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users x join auth.sessions s on s.user_id=x.id
 where x.id=u and s.id=sid and s.aal::text=a and a in ('aal1','aal2')
 and (x.banned_until is null or x.banned_until<=now()) and (s.not_after is null or s.not_after>now())
 and (a='aal1' or exists(select 1 from auth.mfa_factors f where f.id=s.factor_id and f.user_id=u and f.status::text='verified' and f.factor_type::text='totp')))
$$;
create function private.recovery_operator(u uuid,sid uuid,a text) returns boolean
language sql stable security definer set search_path='' as $$
 select a='aal2' and private.account_session_live(u,sid::text,a)
 and exists(select 1 from private.account_recovery_grants where user_id=u and active)
$$;
create function private.recovery_projection(c private.account_recovery_cases) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('caseId',c.id,'kind',c.kind,'state',c.state,'revision',c.revision,
 'expiresAt',c.expires_at,'approvalExpiresAt',c.approval_expires_at,'requiredApprovals',c.required_approvals)
$$;
create function private.account_recovery_command(actor uuid,sid uuid,aal text,q jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.account_recovery_cases; act text:=q->>'action'; cid uuid:=(q->>'caseId')::uuid;
 cmd uuid:=(q->>'commandId')::uuid;receipt private.account_recovery_receipts;
 expected integer:=(q->>'expectedRevision')::integer;reason text:=q->>'reason';
 r jsonb;required integer;op boolean;purpose boolean;target uuid;f uuid;old_ids uuid[];
begin
 if not private.recovery_provider_session(actor,sid,aal) then return jsonb_build_object('outcome','forbidden');end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,4104));
 op:=private.recovery_operator(actor,sid,aal);
 select * into c from private.account_recovery_cases where id=cid for update;
 if c.id is not null and c.target_user_id<>actor and not op then return jsonb_build_object('outcome','forbidden');end if;
 -- Recheck authority before receipt replay, not only before the first execution.
 if act in ('verify','approve','execute','reject') and (not op or c.target_user_id=actor) then
 return jsonb_build_object('outcome','forbidden');end if;
 if act in ('request','begin_password','begin_replacement','complete','cancel') and c.id is not null and c.target_user_id<>actor then
 return jsonb_build_object('outcome','forbidden');end if;
 if act='reconcile' and (actor<>c.executor_user_id or (c.kind='lost_factor' and not op)) then return jsonb_build_object('outcome','forbidden');end if;
 select * into receipt from private.account_recovery_receipts where actor_user_id=actor and command_id=cmd;
 if receipt.command_id is not null then
  if receipt.command<>q then return jsonb_build_object('outcome','conflict');end if;
  -- Authorization, deadlines and snapshots still apply to replay; no external effect is repeated.
  if c.id is null or private.recovery_identity_snapshot(c.target_user_id)<>c.identity_snapshot or
    (c.state in ('requested','verified','approved') and (clock_timestamp()>c.expires_at or
      (c.state='approved' and clock_timestamp()>c.approval_expires_at))) then
   return jsonb_build_object('outcome','conflict');end if;
  return jsonb_build_object('outcome','allowed','data',private.recovery_projection(c));
 end if;
 if act='request' then
  if c.id is not null or reason not in ('forgot_password','factor_lost','factor_replaced') or
     q->>'kind' not in ('password','replace_factor','lost_factor') then return jsonb_build_object('outcome','invalid');end if;
  select exists(select 1 from auth.mfa_amr_claims where session_id=sid and authentication_method='recovery') into purpose;
  if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then return jsonb_build_object('outcome','forbidden');end if;
  if q->>'kind'<>'lost_factor' and exists(select 1 from private.account_security_state where user_id=actor and (blocked or needs_review)) then return jsonb_build_object('outcome','forbidden');end if;
  if q->>'kind' in ('password','lost_factor') and not purpose then return jsonb_build_object('outcome','forbidden');end if;
  if q->>'kind'='replace_factor' then
    if not private.account_session_live(actor,sid::text,aal) or aal<>'aal2' then return jsonb_build_object('outcome','forbidden');end if;
    f:=(q->>'oldFactorId')::uuid;
    if not exists(select 1 from auth.mfa_factors mf join auth.sessions ss on ss.factor_id=mf.id
       where ss.id=sid and mf.id=f and mf.user_id=actor and mf.status::text='verified' and mf.factor_type::text='totp')
       then return jsonb_build_object('outcome','forbidden');end if;
    old_ids:=array[f]; f:=null;
  else
    select coalesce(array_agg(id order by id),'{}') into old_ids from auth.mfa_factors where user_id=actor and status::text='verified';
  end if;
  required:=case when q->>'kind'<>'lost_factor' then 0 when exists(select 1 from private.provide_admin_grants where user_id=actor and active) then 2 else 1 end;
  insert into private.account_recovery_cases(id,target_user_id,kind,state,bound_session_id,expires_at,
    identity_snapshot,factor_snapshot,required_approvals,new_factor_id,old_factor_ids)
  values(cid,actor,q->>'kind','requested',sid,clock_timestamp()+interval '24 hours',
    private.recovery_identity_snapshot(actor),private.recovery_factor_snapshot(actor),required,f,old_ids)
  returning * into c;
 else
  if c.id is null then return jsonb_build_object('outcome','not_found');end if;
  if act='read' then return jsonb_build_object('outcome','allowed','data',private.recovery_projection(c));end if;
  if c.revision<>expected then return jsonb_build_object('outcome','conflict');end if;
  if act='reconcile' then return jsonb_build_object('outcome','allowed','data',private.recovery_projection(c));end if;
  target:=c.target_user_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target::text,4104));
  if c.state in ('completed','rejected','cancelled','expired','needs_review') then return jsonb_build_object('outcome','conflict');end if;
  if (c.state in ('requested','verified','approved') and (not exists(select 1 from auth.sessions ss where ss.id=c.bound_session_id and ss.user_id=target and (ss.not_after is null or ss.not_after>now())) or
    (c.kind in ('password','lost_factor') and not exists(select 1 from auth.mfa_amr_claims where session_id=c.bound_session_id and authentication_method='recovery')))) or
     private.recovery_identity_snapshot(target)<>c.identity_snapshot or
     (c.state in ('requested','verified','approved') and (case when act='begin_replacement' and c.kind='replace_factor' then private.recovery_factor_snapshot_except(target,(q->>'newFactorId')::uuid) else private.recovery_factor_snapshot(target) end)<>c.factor_snapshot) or
     (clock_timestamp()>c.expires_at) or
     (c.state='approved' and clock_timestamp()>c.approval_expires_at) then
    update private.account_recovery_cases set state=case when state in ('executing','awaiting_reenrollment') then 'needs_review' else 'expired' end,revision=revision+1 where id=cid returning * into c;
    insert into private.account_recovery_audit(case_id,target_user_id,actor_user_id,command_id,action,reason,revision)
      values(cid,target,actor,cmd,'invalidate','snapshot_or_deadline',c.revision);
    return jsonb_build_object('outcome','conflict');
  end if;
  if act='verify' then
   if c.state<>'requested' or c.kind<>'lost_factor' or not (q->>'evidenceReference' ~ '^[A-Za-z0-9:_-]{1,120}$') or
    not exists(select 1 from private.account_recovery_contacts where id=(q->>'contactId')::uuid and user_id=target and active and created_at<c.created_at)
    then return jsonb_build_object('outcome','forbidden');end if;
   update private.account_recovery_cases set state='verified',contact_id=(q->>'contactId')::uuid,evidence_reference=q->>'evidenceReference' where id=cid;
  elsif act='approve' then
   if c.state<>'verified' or c.kind<>'lost_factor' or
    not exists(select 1 from private.account_recovery_contacts where id=c.contact_id and user_id=target and active and created_at<c.created_at)
    then return jsonb_build_object('outcome','conflict');end if;
   insert into private.account_recovery_approvals(case_id,user_id,session_id,actor_snapshot,grant_revision)
   select cid,actor,sid,private.recovery_identity_snapshot(actor),revision from private.account_recovery_grants where user_id=actor and active
   on conflict(case_id,user_id) do nothing;
   if (select count(*) from private.account_recovery_approvals where case_id=cid)>=c.required_approvals then
    update private.account_recovery_cases set state='approved',approval_expires_at=clock_timestamp()+interval '15 minutes' where id=cid;
   end if;
  elsif act in ('execute','begin_password','begin_replacement') then
   if (act='execute' and (c.kind<>'lost_factor' or c.state<>'approved')) or
      (act='begin_password' and (c.kind<>'password' or c.state<>'requested' or sid<>c.bound_session_id)) or
      (act='begin_replacement' and (c.kind<>'replace_factor' or c.state<>'requested' or sid<>c.bound_session_id)) then return jsonb_build_object('outcome','conflict');end if;
   if c.kind='lost_factor' and (exists(select 1 from private.account_recovery_approvals a left join private.account_recovery_grants g on g.user_id=a.user_id
     where a.case_id=cid and (not private.recovery_operator(a.user_id,a.session_id,'aal2') or not g.active or a.grant_revision<>g.revision or a.actor_snapshot<>private.recovery_identity_snapshot(a.user_id))) or
     (select count(*) from private.account_recovery_approvals where case_id=cid)<c.required_approvals) then return jsonb_build_object('outcome','forbidden');end if;
   if c.kind='replace_factor' then
    f:=(q->>'newFactorId')::uuid;
    if f=any(c.old_factor_ids) or not exists(select 1 from auth.mfa_factors where id=f and user_id=target and status::text='verified' and factor_type::text='totp' and created_at>=c.created_at) then return jsonb_build_object('outcome','forbidden');end if;
    update private.account_recovery_cases set new_factor_id=f where id=cid;
   end if;
   if c.kind='password' and cardinality(c.old_factor_ids)>0 and aal<>'aal2' then return jsonb_build_object('outcome','forbidden');end if;
   update private.account_security_state set blocked=true,invalid_before=clock_timestamp(),revision=revision+1 where user_id=target;
   -- Narrow server-only session revocation; never edit factors or bans through database DML.
   delete from auth.sessions where user_id=target and id<>c.bound_session_id;
   update private.account_recovery_cases set security_revision=(select revision from private.account_security_state where user_id=target),execution_factor_snapshot=private.recovery_factor_snapshot(target),state='executing',executing_at=clock_timestamp(),executor_user_id=actor,executor_session_id=sid where id=cid;
  elsif act='complete' then
   if c.state<>'awaiting_reenrollment' or sid=c.bound_session_id or
    not exists(select 1 from auth.sessions s join private.account_security_state st on st.user_id=s.user_id
      where s.id=sid and s.user_id=target and s.created_at>st.invalid_before) or
    exists(select 1 from auth.mfa_amr_claims where session_id=sid and authentication_method='recovery') or
    (c.kind in ('lost_factor','replace_factor') and (aal<>'aal2' or not exists(select 1 from auth.mfa_factors f join auth.sessions ss on ss.factor_id=f.id
      where ss.id=sid and ss.user_id=target and f.user_id=target and f.status::text='verified' and f.factor_type::text='totp' and
      ((c.kind='replace_factor' and f.id=c.new_factor_id) or (c.kind='lost_factor' and f.created_at>c.executing_at))))) or
    (c.kind='password' and (cardinality(c.old_factor_ids)>0 or exists(select 1 from public.restaurant_memberships where user_id=target and status='active' and role in ('owner','manager')) or exists(select 1 from private.provide_admin_grants where user_id=target and active)) and aal<>'aal2')
    then return jsonb_build_object('outcome','forbidden');end if;
   if (select needs_review from private.account_security_state where user_id=target) then return jsonb_build_object('outcome','forbidden');end if;
   update private.account_security_state set blocked=false,revision=revision+1 where user_id=target;
   update private.account_recovery_cases set state='completed' where id=cid;
  elsif act in ('cancel','reject') then
   update private.account_recovery_cases set state=case when state in ('executing','awaiting_reenrollment') then 'needs_review' when act='cancel' then 'cancelled' else 'rejected' end where id=cid;
  else return jsonb_build_object('outcome','invalid');end if;
  update private.account_recovery_cases set revision=revision+1 where id=cid returning * into c;
 end if;
 insert into private.account_recovery_audit(case_id,target_user_id,actor_user_id,command_id,action,reason,revision)
 values(cid,c.target_user_id,actor,cmd,act,coalesce(reason,act),c.revision);
 r:=jsonb_build_object('outcome','allowed','data',private.recovery_projection(c),'effectClaimed',act in ('execute','begin_password','begin_replacement'));
 insert into private.account_recovery_receipts(actor_user_id,command_id,command,result) values(actor,cmd,q,r);
 return r;
exception when unique_violation then return jsonb_build_object('outcome','conflict');
end $$;
-- Completion of external Auth effect is server only and compares real provider state.
create function private.finish_account_recovery_effect(actor uuid,sid uuid,aal text,cid uuid,cmd uuid,p_attempt_finished boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.account_recovery_cases;applied boolean;authorized boolean;
begin
 select * into c from private.account_recovery_cases where id=cid for update;
 if c.id is null then return jsonb_build_object('outcome','not_found');end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.target_user_id::text,4104));
 authorized:=private.recovery_provider_session(actor,sid,aal) and actor=c.executor_user_id and (sid=c.executor_session_id or exists(select 1 from auth.sessions ss join private.account_security_state st on st.user_id=ss.user_id where ss.id=sid and ss.user_id=actor and ss.created_at>st.invalid_before)) and
   (c.kind<>'lost_factor' or private.recovery_operator(actor,sid,aal));
 if c.state<>'executing' then return jsonb_build_object('outcome','conflict');end if;
 applied:=case when c.kind='password' then exists(select 1 from auth.audit_log_entries where payload->>'actor_id'=c.target_user_id::text and payload->>'action'='user_updated_password' and created_at>=c.executing_at)
 else not exists(select 1 from auth.mfa_factors where user_id=c.target_user_id and id=any(c.old_factor_ids)) end;
 if not p_attempt_finished and not applied and authorized and clock_timestamp()<c.executing_at+interval '30 seconds' and
   private.recovery_identity_snapshot(c.target_user_id)=c.identity_snapshot and clock_timestamp()<c.expires_at and
   (c.kind<>'lost_factor' or clock_timestamp()<c.approval_expires_at) then
  return jsonb_build_object('outcome','allowed','data',private.recovery_projection(c));
 end if;
 if not authorized or not applied or not private.recovery_factor_effect_consistent(c) or clock_timestamp()>c.expires_at or exists(select 1 from private.account_security_events e where e.target_user_id=c.target_user_id and e.revision>c.security_revision and
   ((c.kind='password' and e.action<>'password_changed') or (c.kind<>'password' and (e.action<>'verified_factor_removed' or not e.factor_id=any(c.old_factor_ids))))) or private.recovery_identity_snapshot(c.target_user_id)<>c.identity_snapshot or
   (c.kind='lost_factor' and (clock_timestamp()>c.approval_expires_at or exists(select 1 from private.account_recovery_approvals a where a.case_id=cid and (not private.recovery_operator(a.user_id,a.session_id,'aal2') or a.actor_snapshot<>private.recovery_identity_snapshot(a.user_id))))) then
  update private.account_security_state set needs_review=true where user_id=c.target_user_id;
  update private.account_recovery_cases set state='needs_review',revision=revision+1 where id=cid;
 else
  -- Controlled effect attribution belongs to the command actor, separately from provider observations.
  update private.account_security_state set needs_review=false where user_id=c.target_user_id;
  update private.account_recovery_cases set state='awaiting_reenrollment',revision=revision+1 where id=cid;
 end if;
 -- The bound recovery session is no longer needed after the Auth effect; old refresh cannot revive it.
 delete from auth.sessions where user_id=c.target_user_id;
 select * into c from private.account_recovery_cases where id=cid;
 insert into private.account_recovery_audit(case_id,target_user_id,actor_user_id,command_id,action,reason,revision)
 values(cid,c.target_user_id,actor,cmd,'effect_reconciled',case when applied then 'provider_state_applied' else 'provider_state_uncertain' end,c.revision);
 return jsonb_build_object('outcome','allowed','data',private.recovery_projection(c));
end $$;
revoke all on function private.recovery_identity_snapshot(uuid),private.recovery_factor_snapshot(uuid),private.recovery_factor_snapshot_except(uuid,uuid),private.recovery_factor_effect_consistent(private.account_recovery_cases),private.recovery_provider_session(uuid,uuid,text),
 private.recovery_operator(uuid,uuid,text),private.recovery_projection(private.account_recovery_cases),private.account_recovery_command(uuid,uuid,text,jsonb),private.finish_account_recovery_effect(uuid,uuid,text,uuid,uuid,boolean)
 from public,anon,authenticated,service_role;
grant execute on function private.account_recovery_command(uuid,uuid,text,jsonb),private.finish_account_recovery_effect(uuid,uuid,text,uuid,uuid,boolean) to service_role;

-- Grant revocation and regrant cannot revive an old approval.
create function private.revise_account_recovery_grant() returns trigger
language plpgsql set search_path='' as $$ begin new.revision:=old.revision+1;return new;end $$;
create trigger revise_account_recovery_grant before update on private.account_recovery_grants
for each row execute function private.revise_account_recovery_grant();
revoke all on function private.revise_account_recovery_grant() from public,anon,authenticated,service_role;

-- Direct provider password update is also observed; UI bypass never leaves business access open.
-- Initial invitation password assignment has no prior password and is not an account takeover event.
create function private.observe_account_password_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare r bigint;controlled boolean;
begin
 if coalesce(old.encrypted_password,'')='' or new.encrypted_password is not distinct from old.encrypted_password then return new;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.id::text,4104));
 controlled:=exists(select 1 from private.account_recovery_cases where target_user_id=new.id and kind='password' and state='executing');
 update private.account_security_state set blocked=true,needs_review=needs_review or not controlled,
 invalid_before=clock_timestamp(),revision=revision+1 where user_id=new.id returning revision into r;
 insert into private.account_security_events(target_user_id,source,action,revision)
 values(new.id,'provider_observation','password_changed',r);
 return new;
end $$;
create trigger observe_account_password_change after update of encrypted_password on auth.users
for each row execute function private.observe_account_password_change();
revoke all on function private.observe_account_password_change() from public,anon,authenticated,service_role;

create function private.account_recovery_effect_plan(actor uuid,sid uuid,aal text,cid uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.account_recovery_cases;
begin
 select * into c from private.account_recovery_cases where id=cid for update;
 if c.id is null or c.state<>'executing' or actor<>c.executor_user_id or sid<>c.executor_session_id or
 not private.recovery_provider_session(actor,sid,aal) or clock_timestamp()>c.expires_at or not private.recovery_factor_effect_consistent(c) or private.recovery_identity_snapshot(c.target_user_id)<>c.identity_snapshot or
 (c.kind='lost_factor' and (not private.recovery_operator(actor,sid,aal) or clock_timestamp()>c.approval_expires_at or
 exists(select 1 from private.account_recovery_approvals a where a.case_id=cid and
 (not private.recovery_operator(a.user_id,a.session_id,'aal2') or a.actor_snapshot<>private.recovery_identity_snapshot(a.user_id))))) then return null;end if;
 return jsonb_build_object('targetUserId',c.target_user_id,'kind',c.kind,'factorIds',c.old_factor_ids);
end $$;
revoke all on function private.account_recovery_effect_plan(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.account_recovery_effect_plan(uuid,uuid,text,uuid) to service_role;
