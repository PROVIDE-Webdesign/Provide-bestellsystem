-- O1: private, default-closed support workflow. No grants, business writes or provider calls.
create table private.support_grants (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 restaurant_id uuid references public.restaurants(id), location_id uuid,
 can_read boolean not null default false, can_manage boolean not null default false,
 active boolean not null default true,
 check(not can_manage or can_read), check(location_id is null or restaurant_id is not null),
 foreign key(restaurant_id,location_id) references public.locations(restaurant_id,id),
 unique nulls not distinct(user_id,restaurant_id,location_id)
);
create table private.support_cases (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null, location_id uuid not null,
 kind text not null check(kind in ('payment_review','refund_failed','email_uncertain','email_dead_letter','acceptance_overdue','incident')),
 source_id uuid, order_id uuid, order_number text,
 state text not null default 'open' check(state in ('open','in_progress','waiting','resolved')),
 severity text not null check(severity in ('critical','high','normal')), deadline timestamptz not null,
 assignee_user_id uuid, revision integer not null default 1 check(revision>0),
 previous_case_id uuid references private.support_cases(id),
 reason text not null check(reason in ('triage','handover','awaiting_internal','awaiting_provider','source_confirmed','misassignment','duplicate','out_of_scope','reopened','priority_changed','deadline_changed','incident_recorded')),
 resolution text check(resolution in ('technical','administrative')), evidence jsonb,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 foreign key(restaurant_id,location_id) references public.locations(restaurant_id,id),
 foreign key(restaurant_id,location_id,order_id) references public.orders(restaurant_id,location_id,id),
 check((state='resolved')=(resolution is not null)),
 check((kind='incident' and source_id is null and order_id is null and order_number is null and evidence is null)
 or (kind<>'incident' and source_id is not null and order_id is not null and order_number is not null and evidence is not null))
);
create unique index support_one_active_source on private.support_cases(restaurant_id,location_id,kind,source_id) where state<>'resolved';
create index support_case_page on private.support_cases(restaurant_id,location_id,id);
-- Tracks healthy observations independently of case closure; unchanged closed sources stay closed.
create table private.support_source_observations (
 restaurant_id uuid not null,location_id uuid not null,kind text not null,source_id uuid not null,
 problem boolean not null,last_case_id uuid references private.support_cases(id),fingerprint text not null,
 primary key(restaurant_id,location_id,kind,source_id),
 foreign key(restaurant_id,location_id) references public.locations(restaurant_id,id)
);
create table private.support_audit (
 id uuid primary key default gen_random_uuid(),case_id uuid not null references private.support_cases(id),
 action text not null check(action in ('create','observe','claim','assign','status','priority','deadline')),
 provenance text not null check(provenance in ('human','system_observed')),actor_user_id uuid not null,
 reason text not null,revision integer not null,at timestamptz not null default clock_timestamp(),evidence jsonb, before_state jsonb, after_state jsonb not null
);
create index support_audit_page on private.support_audit(case_id,at desc,id);
create trigger support_audit_immutable before update or delete on private.support_audit
 for each row execute function private.immutable_account_security_event();
create table private.support_receipts (
 actor_user_id uuid not null,request_id uuid not null,command jsonb not null,result jsonb not null,
 primary key(actor_user_id,request_id)
);
create trigger support_receipt_immutable before update or delete on private.support_receipts
 for each row execute function private.immutable_account_security_event();
-- Each continuation is a one-use, actor/scope-bound step with a fixed source creation cutoff.
create table private.support_scan_cursors (
 id uuid primary key default gen_random_uuid(),actor_user_id uuid not null,
 restaurant_id uuid not null,location_id uuid not null,cutoff timestamptz not null,
 after_key text not null,expires_at timestamptz not null,used boolean not null default false
);
do $$ declare t text; begin
 foreach t in array array['support_grants','support_cases','support_source_observations','support_audit','support_receipts','support_scan_cursors'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('alter table private.%I force row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

-- Deliberately select only non-personal state columns. No payload, token, destination or provider ID.
create view private.support_sources with (security_invoker=true) as
 select p.restaurant_id,p.location_id,k.kind,p.id source_id,p.order_id,
 private.format_order_number(o.order_number) order_number,p.created_at source_created_at,
 case when k.kind='payment_review' then p.last_error='manual_review' else p.refund_state='failed' end is_problem,
 case when k.kind='payment_review' then p.provider_terminal and p.last_error is distinct from 'manual_review' and p.refund_state not in ('failed','requested','pending')
 else p.refund_state='succeeded' end can_close,
 case when k.kind='payment_review' then case when p.last_error='manual_review' then 'manual_review' when p.provider_terminal then 'payment_known' else 'payment_pending' end
 else case when p.refund_state='failed' then 'refund_failed' when p.refund_state='succeeded' then 'refund_succeeded' else 'refund_pending' end end state_code,
 md5(jsonb_build_array(p.last_error='manual_review',p.refund_state,p.provider_terminal,p.close_requested)::text) fingerprint,
 null::timestamptz recorded_at
 from public.online_payment_jobs p join public.orders o on o.id=p.order_id and o.restaurant_id=p.restaurant_id and o.location_id=p.location_id
 cross join (values('payment_review'),('refund_failed'))k(kind)
 union all
 select e.restaurant_id,e.location_id,k.kind,e.id,e.order_id,private.format_order_number(o.order_number),e.created_at,
 case when k.kind='email_uncertain' then e.status='uncertain' else e.status='dead_letter' end,
 e.status in ('accepted','delivered','bounced','suppressed'),e.status,
 md5(jsonb_build_array(e.status,e.attempt_count,e.accepted_at,e.delivered_at,e.revision)::text),
 coalesce(e.delivered_at,e.accepted_at)
 from private.email_deliveries e join public.orders o on o.id=e.order_id and o.restaurant_id=e.restaurant_id and o.location_id=e.location_id
 cross join (values('email_uncertain'),('email_dead_letter'))k(kind)
 union all
 select a.restaurant_id,a.location_id,'acceptance_overdue',a.order_id,a.order_id,private.format_order_number(o.order_number),a.started_at,
 a.resolved_at is null and a.deadline<=statement_timestamp(),a.resolved_at is not null,
 case when a.resolved_at is not null then 'acceptance_resolved' when a.deadline<=statement_timestamp() then 'overdue' else 'acceptance_pending' end,
 md5(jsonb_build_array(a.deadline,a.resolved_at,a.escalated_at)::text),coalesce(a.resolved_at,a.escalated_at,a.started_at)
 from private.order_acceptance_alerts a join public.orders o on o.id=a.order_id and o.restaurant_id=a.restaurant_id and o.location_id=a.location_id;
revoke all on private.support_sources from public,anon,authenticated,service_role;

create function private.support_allowed(u uuid,r uuid,l uuid,manage boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.support_grants g join auth.users a on a.id=g.user_id
 join private.account_security_state st on st.user_id=a.id
 where g.user_id=u and g.active and g.can_read and (not manage or g.can_manage)
 and (g.restaurant_id is null or g.restaurant_id=r) and (g.location_id is null or g.location_id=l)
 and (a.banned_until is null or a.banned_until<=now()) and not st.blocked)
$$;
create function private.support_source_projection(s private.support_sources) returns jsonb
language sql volatile set search_path='' as $$
 select jsonb_build_object('kind',s.kind,'sourceId',s.source_id,'orderId',s.order_id,'orderNumber',s.order_number,
 'stateCode',s.state_code,'problem',coalesce(s.is_problem,false),'canClose',s.can_close,
 'fingerprint',s.fingerprint,'recordedAt',s.recorded_at,'observedAt',clock_timestamp())
$$;
create function private.support_case_projection(c private.support_cases) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('caseId',c.id,'kind',c.kind,'sourceId',c.source_id,'orderId',c.order_id,'orderNumber',c.order_number,
 'state',c.state,'severity',c.severity,'deadline',c.deadline,'assigneeUserId',c.assignee_user_id,'revision',c.revision,
 'createdAt',c.created_at,'updatedAt',c.updated_at,'previousCaseId',c.previous_case_id,'resolution',c.resolution,'reason',c.reason,'evidence',c.evidence)
$$;
create function private.support_change_projection(c private.support_cases) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('state',c.state,'severity',c.severity,'deadline',c.deadline,'assigneeUserId',c.assignee_user_id,'resolution',c.resolution)
$$;
create function private.support_projection(u uuid,r uuid,l uuid,cid uuid,page uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare cases jsonb;next_id uuid;source jsonb;audits jsonb;begin
 select coalesce(jsonb_agg(private.support_case_projection(c) order by c.id),'[]') into cases
 from(select * from private.support_cases where restaurant_id=r and location_id=l
 and (cid is null or id=cid) and (page is null or id>page) order by id limit 50)c;
 if cid is null and jsonb_array_length(cases)=50 then
 next_id:=(cases->49->>'caseId')::uuid;
 if not exists(select 1 from private.support_cases where restaurant_id=r and location_id=l and id>next_id) then next_id:=null;end if;
 end if;
 if cid is not null then
 select private.support_source_projection(s) into source from private.support_sources s
 join private.support_cases c on c.restaurant_id=s.restaurant_id and c.location_id=s.location_id and c.kind=s.kind and c.source_id=s.source_id
 where c.id=cid and c.restaurant_id=r and c.location_id=l;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'caseId',a.case_id,'action',a.action,'provenance',a.provenance,
 'actorUserId',a.actor_user_id,'reason',a.reason,'revision',a.revision,'at',a.at,'evidence',a.evidence,'before',a.before_state,'after',a.after_state) order by a.at desc,a.id),'[]') into audits
 from(select a.* from private.support_audit a join private.support_cases c on c.id=a.case_id
 where c.restaurant_id=r and c.location_id=l and cid is not null and c.id=cid order by a.at desc,a.id limit 30)a;
 return jsonb_build_object('restaurantId',r,'locationId',l,'serverNow',clock_timestamp(),
 'timezone',(select timezone from public.locations where restaurant_id=r and id=l),
 'canManage',private.support_allowed(u,r,l,true),'cases',cases,'nextCursor',next_id,
 'scanned',0,'scanCursor',null,'currentSource',source,'audit',audits);
end $$;

-- A source lock makes closure evidence and its audit atomic with respect to existing job writes.
create function private.lock_support_source(r uuid,l uuid,k text,sid uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 if k in ('payment_review','refund_failed') then perform 1 from public.online_payment_jobs where restaurant_id=r and location_id=l and id=sid for share;
 elsif k in ('email_uncertain','email_dead_letter') then perform 1 from private.email_deliveries where restaurant_id=r and location_id=l and id=sid for share;
 elsif k='acceptance_overdue' then perform 1 from private.order_acceptance_alerts where restaurant_id=r and location_id=l and order_id=sid for share;end if;
end $$;

create function private.support_observe(u uuid,r uuid,l uuid,k text,sid uuid,severity text,manual boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare s private.support_sources;o private.support_source_observations;c private.support_cases;proof jsonb;prior jsonb;begin
 perform private.lock_support_source(r,l,k,sid);
 select * into s from private.support_sources where restaurant_id=r and location_id=l and kind=k and source_id=sid;
 if not found then return null;end if;
 proof:=private.support_source_projection(s);
 select * into o from private.support_source_observations where restaurant_id=r and location_id=l and kind=k and source_id=sid for update;
 select * into c from private.support_cases where restaurant_id=r and location_id=l and kind=k and source_id=sid and state<>'resolved' for update;
 if c.id is null and coalesce(s.is_problem,false) and (o.last_case_id is null or not o.problem) then
 insert into private.support_cases(restaurant_id,location_id,kind,source_id,order_id,order_number,severity,deadline,reason,evidence,previous_case_id)
 values(r,l,k,sid,s.order_id,s.order_number,severity,clock_timestamp()+case severity when 'critical' then interval '30 minutes' when 'high' then interval '4 hours' else interval '24 hours' end,'triage',proof,o.last_case_id) returning * into c;
 insert into private.support_audit(case_id,action,provenance,actor_user_id,reason,revision,evidence,before_state,after_state)
 values(c.id,'create',case when manual then 'human' else 'system_observed' end,u,'triage',c.revision,proof,null,private.support_change_projection(c));
 elsif c.id is not null and c.evidence->>'fingerprint' is distinct from s.fingerprint then
 prior:=private.support_change_projection(c);
 update private.support_cases set evidence=proof,revision=revision+1,updated_at=clock_timestamp() where id=c.id returning * into c;
 insert into private.support_audit(case_id,action,provenance,actor_user_id,reason,revision,evidence,before_state,after_state) values(c.id,'observe','system_observed',u,'triage',c.revision,proof,prior,private.support_change_projection(c));
 end if;
 insert into private.support_source_observations values(r,l,k,sid,coalesce(s.is_problem,false),coalesce(c.id,o.last_case_id),s.fingerprint)
 on conflict(restaurant_id,location_id,kind,source_id) do update set problem=excluded.problem,last_case_id=excluded.last_case_id,fingerprint=excluded.fingerprint;
 return c.id;
end $$;

create function private.support_valid_command(q jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare fields text[];act text;op text;k text;v text;begin
 if q is null or jsonb_typeof(q)<>'object' then return false;end if;
 act:=q->>'action';
 fields:=array['action','restaurantId','locationId'];
 if act='read' then fields:=fields||array['cursor','caseId'];
 elsif act='scan' then fields:=fields||array['requestId','cursor'];
 elsif act='create' then fields:=fields||array['requestId','kind','sourceId','severity','reason'];
 elsif act='update' then fields:=fields||array['requestId','caseId','expectedRevision','operation','assigneeUserId','state','severity','deadline','reason','sourceFingerprint'];
 else return false;end if;
 if q-fields<>'{}'::jsonb or not q ?& fields then return false;end if;
 foreach k in array array['restaurantId','locationId'] loop
 if jsonb_typeof(q->k)<>'string' or (q->>k)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return false;end if;
 end loop;
 foreach k in array array['requestId','caseId','sourceId','cursor','assigneeUserId'] loop
 if q ? k and q->k<>'null'::jsonb and (jsonb_typeof(q->k)<>'string' or (q->>k)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then return false;end if;
 end loop;
 if act<>'read' and q->'requestId'='null'::jsonb then return false;end if;
 if act='read' then return q->'cursor'='null'::jsonb or q->'caseId'='null'::jsonb;end if;
 if act='scan' then return true;end if;
 if act='create' then
 if coalesce(q->>'severity','') not in ('critical','high','normal') then return false;end if;
 if q->>'kind'='incident' then return q->'sourceId'='null'::jsonb and q->>'reason'='incident_recorded';end if;
 return coalesce(q->>'kind','') in ('payment_review','refund_failed','email_uncertain','email_dead_letter','acceptance_overdue') and q->'sourceId'<>'null'::jsonb and q->>'reason'='triage';
 end if;
 if q->'caseId'='null'::jsonb or jsonb_typeof(q->'expectedRevision')<>'number' or (q->>'expectedRevision')!~'^[1-9][0-9]{0,8}$' then return false;end if;
 op:=q->>'operation';
 if q->'sourceFingerprint'<>'null'::jsonb and (jsonb_typeof(q->'sourceFingerprint')<>'string' or (q->>'sourceFingerprint')!~'^[a-f0-9]{32}$') then return false;end if;
 if op in ('assign','claim') then
 return q->'state'='null'::jsonb and q->'severity'='null'::jsonb and q->'deadline'='null'::jsonb and q->'sourceFingerprint'='null'::jsonb
 and (op='assign' or q->'assigneeUserId'='null'::jsonb) and coalesce(q->>'reason','') in ('triage','handover');
 elsif op='priority' then
 return q->'assigneeUserId'='null'::jsonb and q->'state'='null'::jsonb and q->'deadline'='null'::jsonb and q->'sourceFingerprint'='null'::jsonb and coalesce(q->>'severity','') in ('critical','high','normal') and q->>'reason'='priority_changed';
 elsif op='deadline' then
 v:=q->>'deadline';
 if coalesce(v,'')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then return false;end if;
 perform v::timestamptz;
 return q->'assigneeUserId'='null'::jsonb and q->'state'='null'::jsonb and q->'severity'='null'::jsonb and q->'sourceFingerprint'='null'::jsonb and q->>'reason'='deadline_changed';
 elsif op='status' then
 if q->'assigneeUserId'<>'null'::jsonb or q->'severity'<>'null'::jsonb or q->'deadline'<>'null'::jsonb then return false;end if;
 if q->>'state'='resolved' then return (q->>'reason'='source_confirmed' and q->'sourceFingerprint'<>'null'::jsonb)
 or (coalesce(q->>'reason','') in ('misassignment','duplicate','out_of_scope') and q->'sourceFingerprint'='null'::jsonb);end if;
 if q->'sourceFingerprint'<>'null'::jsonb then return false;end if;
 return (q->>'state'='waiting' and coalesce(q->>'reason','') in ('awaiting_internal','awaiting_provider'))
 or (coalesce(q->>'state','') in ('open','in_progress') and coalesce(q->>'reason','') in ('triage','reopened'));
 end if;
 return false;
 exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;

create function private.support_command(u uuid,sid text,aal text,q jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r uuid;l uuid;act text;rid uuid;c private.support_cases;s private.support_sources;old private.support_receipts;
 result jsonb;proof jsonb;prior jsonb;target uuid;page uuid;sc private.support_scan_cursors;cutoff timestamptz;after_key text;
 batch record;n integer:=0;next_cursor uuid;last_key text;cid uuid;operation text;v_reason text;begin
 if aal is distinct from 'aal2' or not private.lock_account_session(u,sid,aal) then return jsonb_build_object('outcome','forbidden');end if;
 if not private.support_valid_command(q) then return jsonb_build_object('outcome','invalid');end if;
 r:=(q->>'restaurantId')::uuid;l:=(q->>'locationId')::uuid;act:=q->>'action';
 -- Lock actor and prospective assignee grants in a consistent order before evaluating current rights.
 target:=case when act='update' and q->>'operation'='assign' then (q->>'assigneeUserId')::uuid else null end;
 perform 1 from private.support_grants where user_id=u or user_id=target order by user_id,id for share;
 if not private.support_allowed(u,r,l,act is distinct from 'read') then return jsonb_build_object('outcome','forbidden');end if;
 if not exists(select 1 from public.locations where restaurant_id=r and id=l) then return jsonb_build_object('outcome','not_found');end if;
 if act='read' then
 if (q-array['action','restaurantId','locationId','cursor','caseId'])<>'{}'::jsonb  then return jsonb_build_object('outcome','invalid');end if;
 cid:=(q->>'caseId')::uuid;page:=(q->>'cursor')::uuid;
 if cid is not null and page is not null then return jsonb_build_object('outcome','invalid');end if;
 if (cid is not null and not exists(select 1 from private.support_cases where id=cid and restaurant_id=r and location_id=l))
 or (page is not null and not exists(select 1 from private.support_cases where id=page and restaurant_id=r and location_id=l)) then return jsonb_build_object('outcome','forbidden');end if;
 return jsonb_build_object('outcome','allowed','data',private.support_projection(u,r,l,cid,page));
 end if;
 if act not in ('scan','create','update') then return jsonb_build_object('outcome','invalid');end if;
 rid:=(q->>'requestId')::uuid;if rid is null then return jsonb_build_object('outcome','invalid');end if;
 -- Scope lock serializes active-case uniqueness, scan observations, revision changes and request replay.
 perform pg_advisory_xact_lock(hashtextextended(r::text||l::text,4101));
 if act='update' then
 select * into c from private.support_cases where id=(q->>'caseId')::uuid and restaurant_id=r and location_id=l for update;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 if c.kind<>'incident' then
 perform private.lock_support_source(r,l,c.kind,c.source_id);
 if not exists(select 1 from private.support_sources where restaurant_id=r and location_id=l and kind=c.kind and source_id=c.source_id and order_id=c.order_id) then return jsonb_build_object('outcome','conflict');end if;
 end if;
 elsif act='create' and q->>'kind'<>'incident' then
 perform private.lock_support_source(r,l,q->>'kind',(q->>'sourceId')::uuid);
 if not exists(select 1 from private.support_sources where restaurant_id=r and location_id=l and kind=q->>'kind' and source_id=(q->>'sourceId')::uuid) then return jsonb_build_object('outcome','not_found');end if;
 elsif act='scan' and q->>'cursor' is not null then
 select * into sc from private.support_scan_cursors where id=(q->>'cursor')::uuid and actor_user_id=u and restaurant_id=r and location_id=l for update;
 if not found or sc.expires_at<=clock_timestamp() then return jsonb_build_object('outcome','forbidden');end if;
 end if;
 if target is not null and not private.support_allowed(target,r,l,true) then return jsonb_build_object('outcome','forbidden');end if;
 -- Request IDs serialize across scopes, and rights/source binding are rechecked before replay.
 perform pg_advisory_xact_lock(hashtextextended(u::text||rid::text,4102));
 select * into old from private.support_receipts where actor_user_id=u and request_id=rid;
 if found then
 if old.command<>q then return jsonb_build_object('outcome','conflict');end if;
 return old.result;
 end if;
 if act='scan' then
 if (q-array['action','restaurantId','locationId','requestId','cursor'])<>'{}'::jsonb then return jsonb_build_object('outcome','invalid');end if;
 if sc.id is not null and sc.used then return jsonb_build_object('outcome','conflict');end if;
 cutoff:=coalesce(sc.cutoff,clock_timestamp());after_key:=coalesce(sc.after_key,'');
 for batch in select kind,source_id,kind||':'||source_id::text key from private.support_sources
 where restaurant_id=r and location_id=l and source_created_at<=cutoff and kind||':'||source_id::text>after_key
 order by kind||':'||source_id::text limit 101 loop
 if n=100 then
 insert into private.support_scan_cursors(actor_user_id,restaurant_id,location_id,cutoff,after_key,expires_at)
 values(u,r,l,cutoff,last_key,clock_timestamp()+interval '1 hour') returning id into next_cursor;exit;end if;
 perform private.support_observe(u,r,l,batch.kind,batch.source_id,'normal',false);
 last_key:=batch.key;n:=n+1;
 end loop;
 if sc.id is not null then update private.support_scan_cursors set used=true where id=sc.id;end if;
 result:=jsonb_build_object('outcome','allowed','data',private.support_projection(u,r,l,null)||jsonb_build_object('scanned',n,'scanCursor',next_cursor));
 elsif act='create' then
 if (q-array['action','restaurantId','locationId','requestId','kind','sourceId','severity','reason'])<>'{}'::jsonb or q->>'severity' not in ('critical','high','normal') then return jsonb_build_object('outcome','invalid');end if;
 if q->>'kind'='incident' then
 if q->>'sourceId' is not null or q->>'reason' is distinct from 'incident_recorded' then return jsonb_build_object('outcome','invalid');end if;
 insert into private.support_cases(restaurant_id,location_id,kind,severity,deadline,reason)
 values(r,l,'incident',q->>'severity',clock_timestamp()+case q->>'severity' when 'critical' then interval '30 minutes' when 'high' then interval '4 hours' else interval '24 hours' end,'incident_recorded') returning * into c;
 insert into private.support_audit(case_id,action,provenance,actor_user_id,reason,revision,after_state) values(c.id,'create','human',u,c.reason,c.revision,private.support_change_projection(c));cid:=c.id;
 else
 if q->>'reason' is distinct from 'triage' then return jsonb_build_object('outcome','invalid');end if;
 cid:=private.support_observe(u,r,l,q->>'kind',(q->>'sourceId')::uuid,q->>'severity',true);
 if cid is null then return jsonb_build_object('outcome','conflict');end if;
 end if;
 result:=jsonb_build_object('outcome','allowed','data',private.support_projection(u,r,l,cid));
 else
 if (q-array['action','restaurantId','locationId','requestId','caseId','expectedRevision','operation','assigneeUserId','state','severity','deadline','reason','sourceFingerprint'])<>'{}'::jsonb then return jsonb_build_object('outcome','invalid');end if;
 prior:=private.support_change_projection(c);
 if c.revision is distinct from (q->>'expectedRevision')::integer then return jsonb_build_object('outcome','conflict');end if;
 operation:=q->>'operation';v_reason:=q->>'reason';
 if operation in ('assign','claim') then
 if v_reason not in ('triage','handover') or q->>'state' is not null or q->>'severity' is not null or q->>'deadline' is not null or q->>'sourceFingerprint' is not null or (operation='claim' and q->>'assigneeUserId' is not null) then return jsonb_build_object('outcome','invalid');end if;
 target:=case when operation='claim' then u else (q->>'assigneeUserId')::uuid end;
 if target is not null and not private.support_allowed(target,r,l,true) then return jsonb_build_object('outcome','forbidden');end if;
 c.assignee_user_id:=target;
 elsif operation='priority' then
 if v_reason is distinct from 'priority_changed' or q->>'severity' not in ('critical','high','normal') or q->>'assigneeUserId' is not null or q->>'state' is not null or q->>'deadline' is not null or q->>'sourceFingerprint' is not null then return jsonb_build_object('outcome','invalid');end if;
 c.severity:=q->>'severity';
 elsif operation='deadline' then
 if v_reason is distinct from 'deadline_changed' or q->>'deadline' is null or q->>'assigneeUserId' is not null or q->>'state' is not null or q->>'severity' is not null or q->>'sourceFingerprint' is not null then return jsonb_build_object('outcome','invalid');end if;
 c.deadline:=(q->>'deadline')::timestamptz;
 if c.deadline<=clock_timestamp() or c.deadline>clock_timestamp()+interval '30 days' then return jsonb_build_object('outcome','invalid');end if;
 elsif operation='status' then
 if q->>'state' not in ('open','in_progress','waiting','resolved') or q->>'assigneeUserId' is not null or q->>'severity' is not null or q->>'deadline' is not null then return jsonb_build_object('outcome','invalid');end if;
 if q->>'state'='resolved' then
 if v_reason='source_confirmed' then
 if c.kind='incident' then return jsonb_build_object('outcome','invalid');end if;
 select * into s from private.support_sources where restaurant_id=r and location_id=l and kind=c.kind and source_id=c.source_id;
 if not s.can_close or s.fingerprint is distinct from q->>'sourceFingerprint' then return jsonb_build_object('outcome','conflict');end if;
 proof:=private.support_source_projection(s);c.evidence:=proof;c.resolution:='technical';
 update private.support_source_observations set problem=coalesce(s.is_problem,false),fingerprint=s.fingerprint
 where restaurant_id=r and location_id=l and kind=c.kind and source_id=c.source_id;
 elsif v_reason in ('misassignment','duplicate','out_of_scope') and q->>'sourceFingerprint' is null then c.resolution:='administrative';
 else return jsonb_build_object('outcome','invalid');end if;
 else
 if q->>'sourceFingerprint' is not null or (c.state='resolved' and (v_reason is distinct from 'reopened' or q->>'state'<>'open')) or (q->>'state'='waiting' and v_reason not in ('awaiting_internal','awaiting_provider')) or (c.state<>'resolved' and q->>'state'<>'waiting' and v_reason is distinct from 'triage') then return jsonb_build_object('outcome','invalid');end if;
 if c.state='resolved' and exists(select 1 from private.support_cases where restaurant_id=r and location_id=l and kind=c.kind and source_id=c.source_id and state<>'resolved') then return jsonb_build_object('outcome','conflict');end if;
 c.resolution:=null;
 end if;
 c.state:=q->>'state';
 else return jsonb_build_object('outcome','invalid');end if;
 update private.support_cases set assignee_user_id=c.assignee_user_id,state=c.state,severity=c.severity,deadline=c.deadline,
 resolution=c.resolution,reason=v_reason,evidence=c.evidence,revision=revision+1,updated_at=clock_timestamp() where id=c.id returning * into c;
 insert into private.support_audit(case_id,action,provenance,actor_user_id,reason,revision,evidence,before_state,after_state)
 values(c.id,operation,'human',u,v_reason,c.revision,proof,prior,private.support_change_projection(c));
 result:=jsonb_build_object('outcome','allowed','data',private.support_projection(u,r,l,c.id));
 end if;
 insert into private.support_receipts values(u,rid,q,result);return result;
 exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return jsonb_build_object('outcome','invalid');
end $$;
revoke all on function private.support_valid_command(jsonb),private.support_allowed(uuid,uuid,uuid,boolean),private.support_source_projection(private.support_sources),
 private.support_case_projection(private.support_cases),private.support_change_projection(private.support_cases),private.support_projection(uuid,uuid,uuid,uuid,uuid),
 private.lock_support_source(uuid,uuid,text,uuid),private.support_observe(uuid,uuid,uuid,text,uuid,text,boolean),
 private.support_command(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.support_command(uuid,text,text,jsonb) to service_role;
