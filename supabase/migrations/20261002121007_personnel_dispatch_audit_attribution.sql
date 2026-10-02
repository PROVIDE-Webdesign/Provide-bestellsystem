-- R19-01: keep the dispatcher identity immutable in commands; attribute each status transition separately.
-- Historical append-only audits are retained. System transitions have no human actor.
alter table private.personnel_dispatches
 add column status_change_kind text,
 add column status_actor_user_id uuid references auth.users(id),
 add column status_reason text,
 add constraint personnel_dispatch_status_context check (coalesce(
  (status_change_kind is null and status_actor_user_id is null and status_reason is null)
  or (status_change_kind in ('command','system')
   and ((status_change_kind='command' and status_actor_user_id is not null)
     or (status_change_kind='system' and status_actor_user_id is null))
   and length(status_reason) between 8 and 300 and status_reason=btrim(status_reason)
   and status_reason!~'[[:cntrl:]]'),false));
alter table private.personnel_audit alter column actor_user_id drop not null;
alter table private.personnel_audit add constraint personnel_audit_system_actor check (
 actor_user_id is not null or coalesce(action like 'dispatch.%'
 and after_state->>'changeKind'='system'
 and after_state->>'initiatorUserId'~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false));

create or replace function private.personnel_dispatch_state_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare event uuid:=gen_random_uuid();begin
 if old.status is distinct from new.status then
 if new.status_change_kind is null or new.status_reason is null then
 raise exception using errcode='23514',message='Personnel status change requires explicit actor context and reason';end if;
 update private.personnel_revisions set revision=revision+1 where restaurant_id=new.restaurant_id;
 insert into private.personnel_audit(id,restaurant_id,actor_user_id,action,reason,before_state,after_state)
 values(event,new.restaurant_id,new.status_actor_user_id,'dispatch.state',new.status_reason,
 jsonb_build_object('dispatchId',new.id,'status',old.status),
 jsonb_build_object('dispatchId',new.id,'status',new.status,'invitationId',new.invitation_id,
 'changeKind',new.status_change_kind,'initiatorUserId',new.actor_user_id));
 insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
 values(new.restaurant_id,'personnel',new.id,'personnel.dispatch.changed.v1',jsonb_build_object('audit_id',event,'status',new.status),'personnel:'||event::text);
 end if;return new;end $$;

create or replace function private.command_personnel(actor uuid,aal text,q jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 update private.personnel_dispatches set status='cancelled',updated_at=clock_timestamp(),
 status_change_kind='command',status_actor_user_id=actor,status_reason=why where id=d.id;
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

create or replace function private.claim_personnel_dispatch(actor uuid,aal text,r uuid,dispatch uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.personnel_dispatches%rowtype;uid uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('personnel:'||r::text,0));
 perform 1 from public.restaurant_memberships where restaurant_id=r order by user_id for update;
 perform 1 from public.restaurant_membership_locations where restaurant_id=r order by user_id,location_id for update;
 select * into d from private.personnel_dispatches where restaurant_id=r and id=dispatch and actor_user_id=actor for update;
 if not found or private.personnel_actor_role(r,actor,aal) is null or not private.personnel_scope_allowed(r,actor,d.role,d.location_ids) then return null;end if;
 if d.status='sending' and d.updated_at<clock_timestamp()-interval '30 seconds' then update private.personnel_dispatches set status='uncertain',updated_at=clock_timestamp(),
 status_change_kind='system',status_actor_user_id=null,status_reason='Dispatch claim expired; delivery outcome unknown' where id=d.id;return null;end if;
 if d.status<>'pending' or d.expires_at<=now() then return null;end if;
 update private.personnel_dispatches set status='sending',updated_at=clock_timestamp(),
 status_change_kind='system',status_actor_user_id=null,status_reason='Auth dispatch claimed by server' where id=d.id;
 select id into uid from auth.users where lower(email)=d.email order by created_at,id limit 1;
 return jsonb_build_object('email',d.email,'existingUserId',uid);
end $$;

create or replace function private.finish_personnel_dispatch(actor uuid,aal text,r uuid,dispatch uuid,result text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.personnel_dispatches%rowtype;uid uuid;iid uuid:=gen_random_uuid();final_status text;event uuid:=gen_random_uuid();begin
 perform pg_advisory_xact_lock(hashtextextended('personnel:'||r::text,0));
 perform 1 from public.restaurant_memberships where restaurant_id=r order by user_id for update;
 perform 1 from public.restaurant_membership_locations where restaurant_id=r order by user_id,location_id for update;
 select * into d from private.personnel_dispatches where restaurant_id=r and id=dispatch and actor_user_id=actor for update;
 if not found then return jsonb_build_object('outcome','forbidden');end if;
 if private.personnel_actor_role(r,actor,aal) is null or not private.personnel_scope_allowed(r,actor,d.role,d.location_ids) then
 update private.personnel_dispatches set status='cancelled',updated_at=clock_timestamp(),
 status_change_kind='system',status_actor_user_id=null,status_reason='Dispatcher authority revoked before completion' where id=d.id and status='sending';return jsonb_build_object('outcome','forbidden');end if;
 if d.status<>'sending' then return private.read_personnel(actor,aal,jsonb_build_object('action','read','restaurantId',r));end if;
 final_status:=case when result in ('sent','failed','uncertain') then result else 'uncertain' end;
 select id into uid from auth.users where lower(email)=d.email order by created_at,id limit 1;
 if final_status='sent' and uid is not null and d.expires_at>now() and not exists(select 1 from public.restaurant_memberships where restaurant_id=r and user_id=uid) then
 insert into public.restaurant_invitations(id,restaurant_id,invited_user_id,email,role,invited_by_user_id,expires_at) values(iid,r,uid,d.email,d.role,actor,d.expires_at);
 insert into public.restaurant_invitation_locations(restaurant_id,invitation_id,location_id) select r,iid,x from unnest(d.location_ids) x;
 else if final_status='sent' then final_status:='failed';end if;iid:=null;end if;
 update private.personnel_dispatches set status=final_status,invitation_id=iid,updated_at=clock_timestamp(),
 status_change_kind='system',status_actor_user_id=null,status_reason=case final_status
 when 'sent' then 'Auth dispatch confirmed by provider'
 when 'failed' then 'Auth dispatch failed or invitation unavailable'
 else 'Auth dispatch outcome remains unknown' end where id=d.id;
 update private.personnel_revisions set revision=revision+1 where restaurant_id=r;
 insert into private.personnel_audit(id,restaurant_id,actor_user_id,action,reason,before_state,after_state) values(event,r,null,'dispatch.'||final_status,
 case final_status when 'sent' then 'Auth dispatch confirmed by provider' when 'failed' then 'Auth dispatch failed or invitation unavailable' else 'Auth dispatch outcome remains unknown' end,
 jsonb_build_object('dispatchId',d.id,'status','sending'),jsonb_build_object('dispatchId',d.id,'status',final_status,'invitationId',iid,'changeKind','system','initiatorUserId',d.actor_user_id));
 return private.read_personnel(actor,aal,jsonb_build_object('action','read','restaurantId',r));
exception when unique_violation or check_violation or foreign_key_violation then
 update private.personnel_dispatches set status='failed',updated_at=clock_timestamp(),
 status_change_kind='system',status_actor_user_id=null,status_reason='Invitation finalization rejected by database' where id=dispatch and actor_user_id=actor and status='sending';
 return private.read_personnel(actor,aal,jsonb_build_object('action','read','restaurantId',r));end $$;

-- CREATE OR REPLACE retains ACLs; explicitly reaffirm the bounded server boundary.
revoke all on function private.personnel_dispatch_state_audit() from public,anon,authenticated,service_role;
revoke all on function private.command_personnel(uuid,text,jsonb),private.claim_personnel_dispatch(uuid,text,uuid,uuid),private.finish_personnel_dispatch(uuid,text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.command_personnel(uuid,text,jsonb),private.claim_personnel_dispatch(uuid,text,uuid,uuid),private.finish_personnel_dispatch(uuid,text,uuid,uuid,text) to service_role;
