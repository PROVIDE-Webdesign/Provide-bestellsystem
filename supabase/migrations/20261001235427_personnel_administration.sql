-- Verified API identities only; no browser or broad server-role table writes.
create table private.personnel_revisions (
 restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
 revision bigint not null default 0 check(revision>=0)
);
create table private.personnel_audit (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null,
 actor_user_id uuid not null, action text not null, reason text not null,
 before_state jsonb, after_state jsonb, created_at timestamptz not null default clock_timestamp()
);
create index personnel_audit_restaurant_idx on private.personnel_audit(restaurant_id,created_at desc,id desc);
create table private.personnel_receipts (
 restaurant_id uuid not null,actor_user_id uuid not null,request_id uuid not null,command jsonb not null,
 primary key(restaurant_id,actor_user_id,request_id)
);
create table private.personnel_dispatches (
 id uuid primary key,restaurant_id uuid not null references public.restaurants(id),actor_user_id uuid not null references auth.users(id),
 email text not null check(email=lower(btrim(email)) and length(email)<=254),role text not null check(role in ('owner','manager','kitchen','driver')),
 location_ids uuid[] not null,status text not null default 'pending' check(status in ('pending','sending','sent','uncertain','failed','cancelled')),
 invitation_id uuid references public.restaurant_invitations(id),reason text not null,
 expires_at timestamptz not null default now()+interval '7 days',created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((role='owner' and cardinality(location_ids)=0) or (role<>'owner' and cardinality(location_ids) between 1 and 50))
);
create unique index personnel_dispatches_open_email_idx on private.personnel_dispatches(restaurant_id,email) where status in ('pending','sending','uncertain');
do $$ declare t text; begin
 foreach t in array array['personnel_revisions','personnel_audit','personnel_receipts','personnel_dispatches'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('alter table private.%I force row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop; end $$;
create trigger personnel_audit_immutable before update or delete on private.personnel_audit for each row execute function private.prevent_order_record_mutation();
create trigger personnel_receipts_immutable before update or delete on private.personnel_receipts for each row execute function private.prevent_order_record_mutation();

create function private.personnel_dispatch_state_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare event uuid:=gen_random_uuid();begin
 if old.status is distinct from new.status then
 update private.personnel_revisions set revision=revision+1 where restaurant_id=new.restaurant_id;
 insert into private.personnel_audit(id,restaurant_id,actor_user_id,action,reason,before_state,after_state)
 values(event,new.restaurant_id,new.actor_user_id,'dispatch.state',new.reason,
 jsonb_build_object('dispatchId',new.id,'status',old.status),jsonb_build_object('dispatchId',new.id,'status',new.status,'invitationId',new.invitation_id));
 insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
 values(new.restaurant_id,'personnel',new.id,'personnel.dispatch.changed.v1',jsonb_build_object('audit_id',event,'status',new.status),'personnel:'||event::text);
 end if;return new;end $$;
revoke all on function private.personnel_dispatch_state_audit() from public,anon,authenticated,service_role;
create trigger personnel_dispatch_state_audit after update on private.personnel_dispatches for each row execute function private.personnel_dispatch_state_audit();

create function private.personnel_revision_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare r uuid;begin
 r:=case when tg_op='DELETE' then old.restaurant_id else new.restaurant_id end;
 insert into private.personnel_revisions(restaurant_id,revision) values(r,1)
 on conflict(restaurant_id) do update set revision=private.personnel_revisions.revision+1;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
do $$ declare t text;begin foreach t in array array['restaurant_memberships','restaurant_membership_locations','restaurant_invitations','restaurant_invitation_locations'] loop
 execute format('create trigger personnel_revision_changed after insert or update or delete on public.%I for each row execute function private.personnel_revision_changed()',t);
end loop;end $$;

create function private.personnel_actor_role(r uuid,actor uuid,aal text) returns text language sql stable security definer set search_path='' as $$
 select m.role from public.restaurant_memberships m join auth.users u on u.id=m.user_id
 where m.restaurant_id=r and m.user_id=actor and m.status='active' and m.role in ('owner','manager') and aal='aal2'
 and (u.banned_until is null or u.banned_until<=now())
$$;
create function private.personnel_scope_allowed(r uuid,actor uuid,target_role text,locs uuid[]) returns boolean language sql stable security definer set search_path='' as $$
 select target_role in ('owner','manager','kitchen','driver') and locs is not null
 and cardinality(locs)<=50 and not exists(select 1 from unnest(locs) x where x is null)
 and cardinality(locs)=(select count(distinct x) from unnest(locs) x)
 and not exists(select 1 from unnest(locs) x where not exists(select 1 from public.locations l where l.restaurant_id=r and l.id=x))
 and ((select role from public.restaurant_memberships where restaurant_id=r and user_id=actor and status='active')='owner'
 or (target_role in ('kitchen','driver') and not exists(select 1 from unnest(locs) x where not exists(
 select 1 from public.restaurant_membership_locations a where a.restaurant_id=r and a.user_id=actor and a.location_id=x))))
$$;
create function private.personnel_invitation_json(i public.restaurant_invitations) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',i.id,'restaurantId',i.restaurant_id,'restaurantName',left(btrim(r.display_name),160),'role',i.role,
 'locationIds',coalesce((select jsonb_agg(a.location_id order by a.location_id) from public.restaurant_invitation_locations a where a.invitation_id=i.id),'[]'::jsonb),
 'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'displayName',left(btrim(l.display_name),160)) order by l.id) from public.restaurant_invitation_locations a join public.locations l on l.id=a.location_id and l.restaurant_id=a.restaurant_id where a.invitation_id=i.id),'[]'::jsonb),
 'expiresAt',i.expires_at,'expired',i.expires_at<=now()) from public.restaurants r where r.id=i.restaurant_id
$$;
create function private.read_personnel(actor uuid,aal text,q jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r uuid:=(q->>'restaurantId')::uuid; ar text;members jsonb;next_cursor uuid; invitations jsonb;dispatches jsonb;audits jsonb;
begin
 if aal not in ('aal1','aal2') or not exists(select 1 from auth.users u where u.id=actor and (u.banned_until is null or u.banned_until<=now())) then return jsonb_build_object('outcome','forbidden');end if;
 if q->>'action'='inbox' then
 select coalesce(jsonb_agg(private.personnel_invitation_json(i) order by i.created_at desc),'[]') into invitations from (
 select i.* from public.restaurant_invitations i where i.invited_user_id=actor and i.status='pending' and i.expires_at>now() order by i.created_at desc limit 50) i;
 return jsonb_build_object('outcome','allowed','data',jsonb_build_object('mode','inbox','invitations',invitations));
 end if;
 ar:=private.personnel_actor_role(r,actor,aal); if ar is null then return jsonb_build_object('outcome','forbidden');end if;
 with page as (
 select m.user_id,lower(u.email) email,m.role,m.status,
 coalesce((select array_agg(a.location_id order by a.location_id) from public.restaurant_membership_locations a where a.restaurant_id=r and a.user_id=m.user_id),'{}'::uuid[]) locs
 from public.restaurant_memberships m join auth.users u on u.id=m.user_id where m.restaurant_id=r and (q->>'cursor' is null or m.user_id>(q->>'cursor')::uuid)
 ), visible as(select * from page where ar='owner' or private.personnel_scope_allowed(r,actor,role,locs) order by user_id limit 51)
 select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'email',email,'role',role,'status',status,'locationIds',to_jsonb(locs)) order by user_id) filter(where n<=50),'[]'),
 case when count(*)>50 then (array_agg(user_id order by user_id))[50] else null end into members,next_cursor from(select *,row_number() over(order by user_id) n from visible) p;
 select coalesce(jsonb_agg(private.personnel_invitation_json(i)||jsonb_build_object('email',i.email) order by i.created_at desc),'[]') into invitations from(
 select i.* from public.restaurant_invitations i where i.restaurant_id=r and i.status='pending'
 and (ar='owner' or private.personnel_scope_allowed(r,actor,i.role,coalesce((select array_agg(a.location_id) from public.restaurant_invitation_locations a where a.invitation_id=i.id),'{}'::uuid[])))
 order by i.created_at desc limit 50) i;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'email',d.email,'role',d.role,'locationIds',to_jsonb(d.location_ids),'status',d.status) order by d.created_at desc),'[]') into dispatches from(
 select d.* from private.personnel_dispatches d where d.restaurant_id=r and (ar='owner' or private.personnel_scope_allowed(r,actor,d.role,d.location_ids)) order by d.created_at desc limit 20) d;
 -- Manager audit exposes only their own actions, never another scope's before/after.
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'at',a.created_at,'actorUserId',a.actor_user_id,'action',a.action,'reason',a.reason,'before',a.before_state,'after',a.after_state) order by a.created_at desc),'[]') into audits from(
 select a.* from private.personnel_audit a where a.restaurant_id=r and (ar='owner' or a.actor_user_id=actor) order by a.created_at desc,a.id desc limit 30) a;
 return jsonb_build_object('outcome','allowed','data',jsonb_build_object('mode','management','restaurantId',r,'actorRole',ar,'revision',coalesce((select revision from private.personnel_revisions where restaurant_id=r),0),'serverNow',clock_timestamp(),
 'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'displayName',left(btrim(l.display_name),160)) order by l.id) from(select l.* from public.locations l where l.restaurant_id=r and (ar='owner' or exists(select 1 from public.restaurant_membership_locations a where a.restaurant_id=r and a.user_id=actor and a.location_id=l.id)) order by l.id limit 100) l),'[]'),
 'members',members,'nextCursor',next_cursor,'invitations',invitations,'dispatches',dispatches,'audit',audits));
end $$;

create function private.command_personnel(actor uuid,aal text,q jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r uuid:=(q->>'restaurantId')::uuid;rid uuid:=(q->>'requestId')::uuid;ar text;rev bigint;receipt jsonb;target public.restaurant_memberships%rowtype;i public.restaurant_invitations%rowtype;d private.personnel_dispatches%rowtype;
 locs uuid[];old_locs uuid[];before_state jsonb;after_state jsonb;event uuid:=gen_random_uuid();action text:=q->>'action';why text:=q->>'reason';
begin
 perform pg_advisory_xact_lock(hashtextextended('personnel:'||r::text,0));
 perform 1 from public.restaurant_memberships where restaurant_id=r order by user_id for update;
 perform 1 from public.restaurant_membership_locations where restaurant_id=r order by user_id,location_id for update;
 ar:=private.personnel_actor_role(r,actor,aal);if ar is null then return jsonb_build_object('outcome','forbidden');end if;
 if why is null or length(why) not between 8 and 300 or why<>btrim(why) or why~'[[:cntrl:]]' or rid is null then return jsonb_build_object('outcome','invalid');end if;
 select command into receipt from private.personnel_receipts where restaurant_id=r and actor_user_id=actor and request_id=rid;
 if receipt is not null then
 if receipt<>q then return jsonb_build_object('outcome','conflict');end if;
 -- Scope authority must still hold before a replay returns management data.
 if q ? 'locationIds' and not private.personnel_scope_allowed(r,actor,q->>'role',array(select jsonb_array_elements_text(q->'locationIds')::uuid)) then return jsonb_build_object('outcome','forbidden');end if;
 return private.read_personnel(actor,aal,jsonb_build_object('action','read','restaurantId',r));end if;
 insert into private.personnel_revisions(restaurant_id) values(r) on conflict do nothing;
 select revision into rev from private.personnel_revisions where restaurant_id=r for update;
 if (q->>'expectedRevision')::bigint is distinct from rev then return jsonb_build_object('outcome','conflict');end if;
 if action in ('member','invite') then
 locs:=array(select jsonb_array_elements_text(q->'locationIds')::uuid);
 if not private.personnel_scope_allowed(r,actor,q->>'role',locs) then return jsonb_build_object('outcome','forbidden');end if;
 if ((q->>'role'='owner' and cardinality(locs)<>0) or (q->>'role'<>'owner' and cardinality(locs)=0)) then return jsonb_build_object('outcome','invalid');end if;
 end if;
 case action
 when 'member' then
 select * into target from public.restaurant_memberships where restaurant_id=r and user_id=(q->>'userId')::uuid;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 old_locs:=coalesce((select array_agg(location_id) from public.restaurant_membership_locations where restaurant_id=r and user_id=target.user_id),'{}'::uuid[]);
 if not private.personnel_scope_allowed(r,actor,target.role,old_locs) then return jsonb_build_object('outcome','forbidden');end if;
 if target.user_id=actor then return jsonb_build_object('outcome','conflict');end if;
 if target.role='owner' and target.status='active' and (q->>'role'<>'owner' or q->>'status'='suspended') and
 (select count(*) from public.restaurant_memberships where restaurant_id=r and role='owner' and status='active')<=1 then return jsonb_build_object('outcome','conflict');end if;
 if q->>'status' not in ('active','suspended') then return jsonb_build_object('outcome','invalid');end if;
 before_state:=jsonb_build_object('userId',target.user_id,'role',target.role,'status',target.status,'locationIds',to_jsonb(old_locs));
 update public.restaurant_memberships set role=q->>'role',status=q->>'status' where restaurant_id=r and user_id=target.user_id;
 delete from public.restaurant_membership_locations where restaurant_id=r and user_id=target.user_id;
 insert into public.restaurant_membership_locations(restaurant_id,user_id,location_id) select r,target.user_id,x from unnest(locs) x;
 after_state:=jsonb_build_object('userId',target.user_id,'role',q->>'role','status',q->>'status','locationIds',to_jsonb(locs));
 when 'invite' then
 if q->>'email' is null or q->>'email'<>lower(btrim(q->>'email')) or length(q->>'email')>254 or q->>'email'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return jsonb_build_object('outcome','invalid');end if;
 if exists(select 1 from public.restaurant_memberships m join auth.users u on u.id=m.user_id where m.restaurant_id=r and lower(u.email)=q->>'email') or
 exists(select 1 from public.restaurant_invitations where restaurant_id=r and email=q->>'email' and status='pending') then return jsonb_build_object('outcome','conflict');end if;
 insert into private.personnel_dispatches(id,restaurant_id,actor_user_id,email,role,location_ids,reason) values(rid,r,actor,q->>'email',q->>'role',locs,why);
 after_state:=jsonb_build_object('dispatchId',rid,'role',q->>'role','locationIds',to_jsonb(locs),'status','pending');
 when 'cancelDispatch' then
 select * into d from private.personnel_dispatches where restaurant_id=r and id=(q->>'dispatchId')::uuid for update;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 if not private.personnel_scope_allowed(r,actor,d.role,d.location_ids) then return jsonb_build_object('outcome','forbidden');end if;
 if d.status in ('sent','cancelled') then return jsonb_build_object('outcome','conflict');end if;
 before_state:=jsonb_build_object('dispatchId',d.id,'status',d.status);
 update private.personnel_dispatches set status='cancelled',updated_at=clock_timestamp() where id=d.id;
 after_state:=jsonb_build_object('dispatchId',d.id,'status','cancelled');
 when 'revoke' then
 select * into i from public.restaurant_invitations where restaurant_id=r and id=(q->>'invitationId')::uuid for update;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 locs:=coalesce((select array_agg(location_id) from public.restaurant_invitation_locations where invitation_id=i.id),'{}'::uuid[]);
 if not private.personnel_scope_allowed(r,actor,i.role,locs) then return jsonb_build_object('outcome','forbidden');end if;
 if i.status<>'pending' then return jsonb_build_object('outcome','conflict');end if;
 before_state:=jsonb_build_object('invitationId',i.id,'status',i.status);
 update public.restaurant_invitations set status='revoked',revoked_by_user_id=actor,revoked_at=clock_timestamp() where id=i.id;
 after_state:=jsonb_build_object('invitationId',i.id,'status','revoked');
 else return jsonb_build_object('outcome','invalid');end case;
 update private.personnel_revisions set revision=revision+1 where restaurant_id=r;
 insert into private.personnel_audit(id,restaurant_id,actor_user_id,action,reason,before_state,after_state) values(event,r,actor,action,why,before_state,after_state);
 insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(r,'personnel',r,'personnel.changed.v1',jsonb_build_object('audit_id',event,'action',action),'personnel:'||event::text);
 insert into private.personnel_receipts values(r,actor,rid,q);
 return private.read_personnel(actor,aal,jsonb_build_object('action','read','restaurantId',r));
exception when unique_violation then return jsonb_build_object('outcome','conflict');
 when check_violation or foreign_key_violation or invalid_text_representation then return jsonb_build_object('outcome','invalid');
end $$;

-- Only the server dispatcher calls these stages. No Auth network call holds a database lock.
create function private.claim_personnel_dispatch(actor uuid,aal text,r uuid,dispatch uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.personnel_dispatches%rowtype;uid uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('personnel:'||r::text,0));
 perform 1 from public.restaurant_memberships where restaurant_id=r order by user_id for update;
 perform 1 from public.restaurant_membership_locations where restaurant_id=r order by user_id,location_id for update;
 select * into d from private.personnel_dispatches where restaurant_id=r and id=dispatch and actor_user_id=actor for update;
 if not found or private.personnel_actor_role(r,actor,aal) is null or not private.personnel_scope_allowed(r,actor,d.role,d.location_ids) then return null;end if;
 if d.status='sending' and d.updated_at<clock_timestamp()-interval '30 seconds' then update private.personnel_dispatches set status='uncertain',updated_at=clock_timestamp() where id=d.id;return null;end if;
 if d.status<>'pending' or d.expires_at<=now() then return null;end if;
 update private.personnel_dispatches set status='sending',updated_at=clock_timestamp() where id=d.id;
 select id into uid from auth.users where lower(email)=d.email order by created_at,id limit 1;
 return jsonb_build_object('email',d.email,'existingUserId',uid);
end $$;
create function private.finish_personnel_dispatch(actor uuid,aal text,r uuid,dispatch uuid,result text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.personnel_dispatches%rowtype;uid uuid;iid uuid:=gen_random_uuid();final_status text;event uuid:=gen_random_uuid();begin
 perform pg_advisory_xact_lock(hashtextextended('personnel:'||r::text,0));
 perform 1 from public.restaurant_memberships where restaurant_id=r order by user_id for update;
 perform 1 from public.restaurant_membership_locations where restaurant_id=r order by user_id,location_id for update;
 select * into d from private.personnel_dispatches where restaurant_id=r and id=dispatch and actor_user_id=actor for update;
 if not found then return jsonb_build_object('outcome','forbidden');end if;
 if private.personnel_actor_role(r,actor,aal) is null or not private.personnel_scope_allowed(r,actor,d.role,d.location_ids) then
 update private.personnel_dispatches set status='cancelled',updated_at=clock_timestamp() where id=d.id and status='sending';return jsonb_build_object('outcome','forbidden');end if;
 if d.status<>'sending' then return private.read_personnel(actor,aal,jsonb_build_object('action','read','restaurantId',r));end if;
 final_status:=case when result in ('sent','failed','uncertain') then result else 'uncertain' end;
 select id into uid from auth.users where lower(email)=d.email order by created_at,id limit 1;
 if final_status='sent' and uid is not null and d.expires_at>now() and not exists(select 1 from public.restaurant_memberships where restaurant_id=r and user_id=uid) then
 insert into public.restaurant_invitations(id,restaurant_id,invited_user_id,email,role,invited_by_user_id,expires_at) values(iid,r,uid,d.email,d.role,actor,d.expires_at);
 insert into public.restaurant_invitation_locations(restaurant_id,invitation_id,location_id) select r,iid,x from unnest(d.location_ids) x;
 else if final_status='sent' then final_status:='failed';end if;iid:=null;end if;
 update private.personnel_dispatches set status=final_status,invitation_id=iid,updated_at=clock_timestamp() where id=d.id;
 update private.personnel_revisions set revision=revision+1 where restaurant_id=r;
 insert into private.personnel_audit(id,restaurant_id,actor_user_id,action,reason,before_state,after_state) values(event,r,actor,'dispatch.'||final_status,d.reason,jsonb_build_object('dispatchId',d.id,'status','sending'),jsonb_build_object('dispatchId',d.id,'status',final_status,'invitationId',iid));
 return private.read_personnel(actor,aal,jsonb_build_object('action','read','restaurantId',r));
exception when unique_violation or check_violation or foreign_key_violation then
 update private.personnel_dispatches set status='failed',updated_at=clock_timestamp() where id=dispatch and actor_user_id=actor and status='sending';
 return private.read_personnel(actor,aal,jsonb_build_object('action','read','restaurantId',r));end $$;

create function private.accept_personnel(actor uuid,aal text,invitation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.restaurant_invitations%rowtype;locs uuid[];r uuid;event uuid:=gen_random_uuid();begin
 select restaurant_id into r from public.restaurant_invitations where id=invitation and invited_user_id=actor;
 if r is null then return jsonb_build_object('outcome','forbidden');end if;
 perform pg_advisory_xact_lock(hashtextextended('personnel:'||r::text,0));
 perform 1 from public.restaurant_memberships where restaurant_id=r order by user_id for update;
 perform 1 from public.restaurant_membership_locations where restaurant_id=r order by user_id,location_id for update;
 select * into i from public.restaurant_invitations where id=invitation for update;
 if aal not in ('aal1','aal2') or (i.role in ('owner','manager') and aal<>'aal2') or not exists(select 1 from auth.users u where u.id=actor and lower(u.email)=i.email and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())) then return jsonb_build_object('outcome','forbidden');end if;
 if i.status='accepted' then return private.read_personnel(actor,aal,'{"action":"inbox"}');end if;
 locs:=coalesce((select array_agg(location_id) from public.restaurant_invitation_locations where invitation_id=i.id),'{}'::uuid[]);
 if i.status<>'pending' or i.expires_at<=now() or private.personnel_actor_role(r,i.invited_by_user_id,'aal2') is null or not private.personnel_scope_allowed(r,i.invited_by_user_id,i.role,locs) then return jsonb_build_object('outcome','conflict');end if;
 perform private.accept_restaurant_invitation(invitation,actor,aal);
 insert into private.personnel_audit(id,restaurant_id,actor_user_id,action,reason,before_state,after_state) values(event,r,actor,'accept','Invitation consciously accepted',jsonb_build_object('invitationId',i.id,'status','pending'),jsonb_build_object('invitationId',i.id,'status','accepted','role',i.role,'locationIds',to_jsonb(locs)));
 insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(r,'personnel',actor,'personnel.accepted.v1',jsonb_build_object('audit_id',event),'personnel:'||event::text);
 return private.read_personnel(actor,aal,'{"action":"inbox"}');
exception when unique_violation or raise_exception or check_violation then return jsonb_build_object('outcome','conflict');end $$;

-- A current owner can revoke an invitation whose original creator lost access.
do $$ declare original text;revised text;begin
 original:=pg_get_functiondef('private.validate_restaurant_invitation()'::regprocedure);
 revised:=replace(original,'membership.user_id = new.invited_by_user_id','membership.user_id = case when new.status = ''revoked'' then new.revoked_by_user_id else new.invited_by_user_id end');
 if revised=original then raise exception 'Unknown invitation validator';end if;execute revised;end $$;
-- Replace inherited/default ACLs too, including TRUNCATE, REFERENCES and TRIGGER.
revoke all on public.restaurant_memberships,public.restaurant_membership_locations,public.restaurant_invitations,public.restaurant_invitation_locations from service_role;
grant select on public.restaurant_memberships,public.restaurant_membership_locations,public.restaurant_invitations,public.restaurant_invitation_locations to service_role;
revoke execute on function private.accept_restaurant_invitation(uuid,uuid,text) from service_role;
do $$ declare p record;begin
 for p in select f.oid from pg_proc f join pg_namespace n on n.oid=f.pronamespace where n.nspname='private' and f.proname in (
 'personnel_revision_changed','personnel_actor_role','personnel_scope_allowed','personnel_invitation_json','read_personnel','command_personnel','claim_personnel_dispatch','finish_personnel_dispatch','accept_personnel') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',p.oid::regprocedure);
 end loop;end $$;
grant execute on function private.read_personnel(uuid,text,jsonb),private.command_personnel(uuid,text,jsonb),private.claim_personnel_dispatch(uuid,text,uuid,uuid),private.finish_personnel_dispatch(uuid,text,uuid,uuid,text),private.accept_personnel(uuid,text,uuid) to service_role;
