-- Explicit platform grants. No live identity is granted privileges by this migration.
create table private.provide_admin_grants (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 restaurant_id uuid references public.restaurants(id) on delete cascade, location_id uuid,
 active boolean not null default true, created_at timestamptz not null default now(),
 foreign key(restaurant_id,location_id) references public.locations(restaurant_id,id) on delete cascade,
 check(location_id is null or restaurant_id is not null),
 unique nulls not distinct(user_id,restaurant_id,location_id)
);
create index provide_admin_grants_actor_idx on private.provide_admin_grants(user_id,restaurant_id,location_id) where active;
create table private.provide_admin_revisions (
 restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
 revision integer not null default 0 check(revision>=0)
);
insert into private.provide_admin_revisions(restaurant_id) select id from public.restaurants;
create table private.provide_admin_audit (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid, location_id uuid,
 action text not null, actor_user_id uuid, reason text not null,
 before_state jsonb, after_state jsonb, created_at timestamptz not null default clock_timestamp()
);
create index provide_admin_audit_scope_idx on private.provide_admin_audit(restaurant_id,created_at desc,id desc);
create table private.provide_admin_receipts (
 restaurant_id uuid not null references public.restaurants(id) on delete restrict,
 actor_user_id uuid not null, request_id uuid not null, command jsonb not null,
 created_at timestamptz not null default now(), primary key(restaurant_id,actor_user_id,request_id)
);
create table private.restaurant_launch_configuration (
 restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
 merchant_role text check(merchant_role='restaurant'), payout_account_reference text,
 production_domain text, data_region text check(data_region='eu-central-1'), responsible_user_id uuid references auth.users(id) on delete restrict,
 check(payout_account_reference is null or (length(payout_account_reference) between 3 and 200 and payout_account_reference ~ '^[A-Za-z0-9][A-Za-z0-9:/._#?=&%+\-]*$')),
 check(production_domain is null or (length(production_domain) between 4 and 253 and production_domain ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'))
);
alter table public.restaurant_feature_flags add column expires_at timestamptz,
 add column reason text, add column changed_by_user_id uuid;
create table private.location_feature_flags (
 restaurant_id uuid not null,location_id uuid not null,feature_key text not null references public.feature_definitions(key) on delete restrict,
 enabled boolean not null,expires_at timestamptz,reason text not null,changed_by_user_id uuid not null,
 primary key(restaurant_id,location_id,feature_key), foreign key(restaurant_id,location_id) references public.locations(restaurant_id,id) on delete restrict,
 check(length(btrim(reason)) between 8 and 300)
);
alter table public.onboarding_check_results add column evidence_kind text check(evidence_kind in ('document','test','provider')),
 add column evidence_reference text check(evidence_reference is null or (length(evidence_reference) between 3 and 200 and evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9:/._#?=&%+\-]*$'));

do $secure$
declare t text;
begin
 foreach t in array array['provide_admin_grants','provide_admin_revisions','provide_admin_audit','provide_admin_receipts','restaurant_launch_configuration','location_feature_flags'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('alter table private.%I force row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end;
$secure$;
create trigger provide_admin_audit_immutable before update or delete on private.provide_admin_audit
 for each row execute function private.prevent_order_record_mutation();
create trigger provide_admin_receipts_immutable before update or delete on private.provide_admin_receipts
 for each row execute function private.prevent_order_record_mutation();
-- Registry and flag DML belong to audited private commands, not a general service-role table API.
revoke insert,update,delete on public.feature_definitions,public.restaurant_feature_flags from service_role;
revoke insert,update,delete on public.onboarding_check_definitions,public.onboarding_check_results,
 public.restaurant_activation_states,public.location_activation_states,public.onboarding_transitions from service_role;

create function private.provide_admin_allowed(actor uuid,aal text,r uuid,l uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select aal is not distinct from 'aal2' and exists(
  select 1 from private.provide_admin_grants g join auth.users u on u.id=g.user_id
  where g.user_id=actor and g.active and (u.banned_until is null or u.banned_until<=statement_timestamp())
   and (g.restaurant_id is null or (g.restaurant_id=r and (g.location_id is null or g.location_id=l)))
 );
$$;
create or replace function private.assert_onboarding_actor(
 target_restaurant_id uuid,target_location_id uuid,target_actor_user_id uuid,target_authentication_assurance text
) returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if target_authentication_assurance is distinct from 'aal2' then raise exception using errcode='P0001',message='onboarding administration requires aal2'; end if;
 if not private.provide_admin_allowed(target_actor_user_id,target_authentication_assurance,target_restaurant_id,target_location_id) then
  raise exception using errcode='P0001',message='onboarding requires an assigned PROVIDE administrator';
 end if;
 perform g.id from private.provide_admin_grants g where g.user_id=target_actor_user_id and g.active
  and (g.restaurant_id is null or (g.restaurant_id=target_restaurant_id and (g.location_id is null or g.location_id=target_location_id))) for share;
 if not found or not private.provide_admin_allowed(target_actor_user_id,target_authentication_assurance,target_restaurant_id,target_location_id) then
  raise exception using errcode='P0001',message='onboarding requires an assigned PROVIDE administrator';
 end if;
 perform set_config('provide.actor',target_actor_user_id::text,true);
 if nullif(current_setting('provide.reason',true),'') is null then perform set_config('provide.reason','Internal onboarding transition',true); end if;
end;
$$;

create or replace function private.is_restaurant_feature_enabled(target_restaurant_id uuid,target_feature_key text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.restaurants where id=target_restaurant_id)
 and coalesce((select enabled from public.restaurant_feature_flags where restaurant_id=target_restaurant_id and feature_key=target_feature_key
  and (expires_at is null or expires_at>statement_timestamp())),
  (select default_enabled from public.feature_definitions where key=target_feature_key),false);
$$;
-- A restaurant disable is a kill switch. Location overrides may narrow, never bypass it.
create function private.is_location_feature_enabled(r uuid,l uuid,k text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.locations where restaurant_id=r and id=l)
 and private.is_restaurant_feature_enabled(r,k)
 and coalesce((select enabled from private.location_feature_flags where restaurant_id=r and location_id=l and feature_key=k
  and (expires_at is null or expires_at>statement_timestamp())),true);
$$;

create function private.provide_admin_record_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; v jsonb;r uuid;l uuid;actor uuid;why text;
begin
 b:=case when tg_op='INSERT' then null else to_jsonb(old)-'updated_at'-'created_at'-'note' end;
 a:=case when tg_op='DELETE' then null else to_jsonb(new)-'updated_at'-'created_at'-'note' end;
 if b is not distinct from a then return null; end if;
 v:=coalesce(a,b);r:=case when tg_table_name='restaurants' then (v->>'id')::uuid else (v->>'restaurant_id')::uuid end;
 l:=case when tg_table_name='locations' then (v->>'id')::uuid else (v->>'location_id')::uuid end;
 actor:=nullif(current_setting('provide.actor',true),'')::uuid;
 why:=coalesce(nullif(current_setting('provide.reason',true),''),'Privileged database maintenance');
 if r is not null then
  insert into private.provide_admin_revisions(restaurant_id,revision) select r,1 where exists(select 1 from public.restaurants where id=r)
   on conflict(restaurant_id) do update set revision=private.provide_admin_revisions.revision+1;
 end if;
 insert into private.provide_admin_audit(restaurant_id,location_id,action,actor_user_id,reason,before_state,after_state)
 values(r,l,tg_table_name||'.'||lower(tg_op),actor,why,b,a);
 return null;
end;
$$;
do $audit$
declare t text;
begin
 foreach t in array array['restaurants','locations','restaurant_activation_states','location_activation_states','onboarding_check_results','restaurant_feature_flags'] loop
  execute format('create trigger provide_admin_audit_change after insert or update or delete on public.%I for each row execute function private.provide_admin_record_change()',t);
 end loop;
 foreach t in array array['provide_admin_grants','restaurant_launch_configuration','location_feature_flags'] loop
  execute format('create trigger provide_admin_audit_change after insert or update or delete on private.%I for each row execute function private.provide_admin_record_change()',t);
 end loop;
end;
$audit$;

create function private.reopen_provide_checks(r uuid,l uuid,check_keys text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if l is null then
  update public.restaurant_activation_states set onboarding_status='in_progress',go_live_status='blocked',approved_by_user_id=null,approved_at=null,paused_at=null where restaurant_id=r;
 else
  update public.location_activation_states set onboarding_status='in_progress',go_live_status='blocked',approved_by_user_id=null,approved_at=null,paused_at=null where restaurant_id=r and location_id=l;
 end if;
 update public.onboarding_check_results set status='pending',checked_by_user_id=null,checked_at=null,note=null,evidence_kind=null,evidence_reference=null
 where restaurant_id=r and location_id is not distinct from l and check_key=any(check_keys);
end;
$$;
create function private.provide_critical_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare r uuid;l uuid;ks text[];v jsonb;
begin
 if tg_table_name='restaurant_launch_configuration' then
  if tg_op='UPDATE' and to_jsonb(new) is not distinct from to_jsonb(old) then return null; end if;
  r:=case when tg_op='DELETE' then old.restaurant_id else new.restaurant_id end;
 elsif tg_table_name='restaurants' then
  if (new.slug,new.display_name,new.timezone,new.currency_code) is not distinct from (old.slug,old.display_name,old.timezone,old.currency_code) then return null; end if;
  r:=new.id;
 else
  if (new.slug,new.display_name,new.timezone,new.address_line_1,new.address_line_2,new.postal_code,new.city,new.country_code) is not distinct from
   (old.slug,old.display_name,old.timezone,old.address_line_1,old.address_line_2,old.postal_code,old.city,old.country_code) then return null; end if;
  r:=new.restaurant_id;l:=new.id;
 end if;
 -- Lock order compatible with FK key-share locks used by submissions.
 perform id from public.restaurants where id=r for no key update;
 if l is null then
  perform id from public.locations where restaurant_id=r order by id for update;
  select array_agg(key) into ks from public.onboarding_check_definitions where scope='restaurant';
  perform private.reopen_provide_checks(r,null,ks);
  for v in select to_jsonb(id) from public.locations where restaurant_id=r order by id loop
   select array_agg(key) into ks from public.onboarding_check_definitions where scope='location';
   perform private.reopen_provide_checks(r,(v#>>'{}')::uuid,ks);
  end loop;
 else
  select array_agg(key) into ks from public.onboarding_check_definitions where scope='location';
  perform private.reopen_provide_checks(r,l,ks);
 end if;
 return null;
end;
$$;
create trigger provide_launch_configuration_recheck after insert or update or delete on private.restaurant_launch_configuration
for each row execute function private.provide_critical_change();
create trigger provide_restaurant_profile_recheck after update on public.restaurants
for each row execute function private.provide_critical_change();
create trigger provide_location_profile_recheck after update on public.locations
for each row execute function private.provide_critical_change();

-- Add concrete A2 review points. Existing approved tenants fail closed until new points are reviewed.
insert into public.onboarding_check_definitions(key,scope,description) values
 ('restaurant.payment','restaurant','Merchant role, payment methods and payout evidence reviewed.'),
 ('restaurant.privacy','restaurant','Privacy text, retention and responsibilities reviewed.'),
 ('restaurant.domain','restaurant','Production domain and deployment ownership reviewed.'),
 ('restaurant.region','restaurant','Frankfurt data region confirmed.'),
 ('restaurant.responsible','restaurant','Responsible operator and escalation ownership reviewed.'),
 ('location.menu','location','Published menu, prices, selections, tax and allergens reviewed.'),
 ('location.schedule','location','Opening hours, ordering cutoff and capacity reviewed.'),
 ('location.delivery','location','Delivery scope, minimum and fees or non-applicability reviewed.'),
 ('location.payment','location','Enabled payment methods and provider configuration reviewed.'),
 ('location.email','location','Sender and transactional communication reviewed.'),
 ('location.test_order','location','Required test orders evidenced.'),
 ('location.refund_test','location','Required refund case or documented non-applicability evidenced.'),
 ('location.training','location','Personnel roles, device handling and restaurant training reviewed.');
insert into public.onboarding_check_results(restaurant_id,check_key,scope)
select r.id,d.key,d.scope from public.restaurants r cross join public.onboarding_check_definitions d where d.scope='restaurant'
on conflict do nothing;
create function private.read_provide_administration(actor uuid,aal text,q jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r uuid:=(q->>'restaurantId')::uuid;l uuid:=(q->>'locationId')::uuid;
 cursor_id uuid:=(q->>'cursor')::uuid;loc_cursor uuid:=(q->>'locationCursor')::uuid;
 list jsonb;locs jsonb;checks jsonb;features jsonb;audit jsonb;cfg jsonb;sel jsonb;
 next_r uuid;next_l uuid;rest public.restaurants;loc public.locations;can_root boolean;os text;gs text;rev integer;
begin
 if aal is distinct from 'aal2' or not exists(select 1 from private.provide_admin_grants g join auth.users u on u.id=g.user_id
  where g.user_id=actor and g.active and (u.banned_until is null or u.banned_until<=statement_timestamp())) then return jsonb_build_object('outcome','forbidden');end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'slug',x.slug,'displayName',x.display_name) order by x.id),'[]') into list
 from (select t.* from public.restaurants t where (cursor_id is null or t.id>cursor_id) and
  (private.provide_admin_allowed(actor,aal,t.id,null) or exists(select 1 from public.locations z where z.restaurant_id=t.id and private.provide_admin_allowed(actor,aal,t.id,z.id))) order by t.id limit 25) x;
 if jsonb_array_length(list)=25 and exists(select 1 from public.restaurants t where t.id>(list->24->>'id')::uuid and
  (private.provide_admin_allowed(actor,aal,t.id,null) or exists(select 1 from public.locations z where z.restaurant_id=t.id and private.provide_admin_allowed(actor,aal,t.id,z.id)))) then next_r:=(list->24->>'id')::uuid;end if;
 if r is not null then
  can_root:=private.provide_admin_allowed(actor,aal,r,null);
  if not can_root and not exists(select 1 from public.locations z where z.restaurant_id=r and private.provide_admin_allowed(actor,aal,r,z.id)) then return jsonb_build_object('outcome','forbidden');end if;
  if l is not null and not private.provide_admin_allowed(actor,aal,r,l) then return jsonb_build_object('outcome','forbidden');end if;
  select * into rest from public.restaurants where id=r;
  if rest.id is null then return jsonb_build_object('outcome','not_found');end if;
  select revision into rev from private.provide_admin_revisions where restaurant_id=r;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'slug',x.slug,'displayName',x.display_name) order by x.id),'[]') into locs
  from(select t.* from public.locations t where t.restaurant_id=r and (loc_cursor is null or t.id>loc_cursor) and private.provide_admin_allowed(actor,aal,r,t.id) order by t.id limit 25)x;
  if jsonb_array_length(locs)=25 and exists(select 1 from public.locations t where t.restaurant_id=r and t.id>(locs->24->>'id')::uuid and private.provide_admin_allowed(actor,aal,r,t.id)) then next_l:=(locs->24->>'id')::uuid;end if;
  if l is null then
   select onboarding_status,go_live_status into os,gs from public.restaurant_activation_states where restaurant_id=r;
  else
   select * into loc from public.locations where restaurant_id=r and id=l;
   if loc.id is null then return jsonb_build_object('outcome','not_found');end if;
   select onboarding_status,go_live_status into os,gs from public.location_activation_states where restaurant_id=r and location_id=l;
  end if;
  if can_root then
   select jsonb_build_object('merchantRole',merchant_role,'payoutAccountReference',payout_account_reference,'productionDomain',production_domain,'dataRegion',data_region,'responsibleUserId',responsible_user_id)
    into cfg from private.restaurant_launch_configuration where restaurant_id=r;
   cfg:=coalesce(cfg,jsonb_build_object('merchantRole',null,'payoutAccountReference',null,'productionDomain',null,'dataRegion',null,'responsibleUserId',null));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',d.key,'description',d.description,'required',d.required_for_go_live,'status',c.status,
   'checkedAt',c.checked_at,'checkedByUserId',c.checked_by_user_id,'evidenceKind',c.evidence_kind,'evidenceReference',c.evidence_reference) order by d.key),'[]') into checks
  from public.onboarding_check_results c join public.onboarding_check_definitions d on d.key=c.check_key
  where c.restaurant_id=r and c.location_id is not distinct from l and (can_root or l is not null);
  select coalesce(jsonb_agg(jsonb_build_object('key',d.key,'description',d.description,
   'mode',case when l is null then case when rf.enabled then 'enabled' when rf.enabled=false then 'disabled' else 'inherit' end else case when lf.enabled then 'enabled' when lf.enabled=false then 'disabled' else 'inherit' end end,
   'expiresAt',case when l is null then rf.expires_at else lf.expires_at end,'reason',case when l is null then rf.reason else lf.reason end,
   'effectiveEnabled',case when l is null then private.is_restaurant_feature_enabled(r,d.key) else private.is_location_feature_enabled(r,l,d.key) end,
   'restaurantEnabled',private.is_restaurant_feature_enabled(r,d.key)) order by d.key),'[]') into features
  from public.feature_definitions d left join public.restaurant_feature_flags rf on rf.restaurant_id=r and rf.feature_key=d.key
  left join private.location_feature_flags lf on lf.restaurant_id=r and lf.location_id=l and lf.feature_key=d.key;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'at',a.created_at,'locationId',a.location_id,'action',a.action,'actorUserId',a.actor_user_id,
   'reason',a.reason,'before',a.before_state,'after',a.after_state) order by a.created_at desc,a.id desc),'[]') into audit
  from(select * from private.provide_admin_audit x where x.restaurant_id=r and ((l is null and can_root) or x.location_id=l)
   order by x.created_at desc,x.id desc limit 30)a;
  sel:=jsonb_build_object('restaurantId',r,'scopeSlug',case when l is null then rest.slug else loc.slug end,'scopeDisplayName',case when l is null then rest.display_name else loc.display_name end,'slug',rest.slug,'displayName',rest.display_name,'revision',coalesce(rev,0),'canManageRestaurant',can_root,
   'locationId',l,'locations',locs,'nextLocationCursor',next_l,'profileStatus',case when l is null then rest.status else loc.status end,
   'onboardingStatus',os,'goLiveStatus',gs,'configuration',cfg,'checks',checks,'features',features,'audit',audit);
 end if;
 return jsonb_build_object('outcome','allowed','data',jsonb_build_object('serverNow',statement_timestamp(),'liveActionsEnabled',false,
  'canCreateRestaurant',private.provide_admin_allowed(actor,aal,null,null),'restaurants',list,'nextRestaurantCursor',next_r,'selected',sel));
exception when invalid_text_representation then return jsonb_build_object('outcome','invalid');
end;
$$;

create function private.command_provide_administration(actor uuid,aal text,q jsonb,allow_live boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r uuid:=(q->>'restaurantId')::uuid;l uuid:=(q->>'locationId')::uuid;rid uuid:=(q->>'requestId')::uuid;
 action text:=q->>'action';why text:=btrim(q->>'reason');previous jsonb;rev integer;k text;expiry timestamptz;
 definition_scope text;state text;cfg jsonb;slug text;proof jsonb;event uuid:=gen_random_uuid();target_keys text[];
begin
 if action='read' then return private.read_provide_administration(actor,aal,q);end if;
 if action='createRestaurant' then
  if not private.provide_admin_allowed(actor,aal,null,null) then return jsonb_build_object('outcome','forbidden');end if;
  perform private.assert_onboarding_actor(null,null,actor,aal);
 else
  if not private.provide_admin_allowed(actor,aal,r,case when action='createLocation' then null else l end) then return jsonb_build_object('outcome','forbidden');end if;
  perform private.assert_onboarding_actor(r,case when action='createLocation' then null else l end,actor,aal);
 end if;
 if r is null or rid is null or why is null or length(why) not between 8 and 300 then return jsonb_build_object('outcome','invalid');end if;
 perform set_config('provide.reason',why,true);
 -- The lock is shared by all commands and ordered before location locks.
 perform pg_advisory_xact_lock(hashtextextended('provide-admin:'||r::text,0));
 select command into previous from private.provide_admin_receipts where restaurant_id=r and actor_user_id=actor and request_id=rid;
 if previous is not null then
  if previous<>q then return jsonb_build_object('outcome','conflict');end if;
  return private.read_provide_administration(actor,aal,jsonb_build_object('restaurantId',r,'locationId',l));
 end if;
 if action='createRestaurant' then
  if (q->>'expectedRevision')::integer<>0 or l is not null or exists(select 1 from public.restaurants where id=r) then return jsonb_build_object('outcome','conflict');end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=q->>'timezone') then return jsonb_build_object('outcome','invalid');end if;
  insert into public.restaurants(id,slug,display_name,timezone) values(r,q->>'slug',q->>'displayName',q->>'timezone');rev:=0;
 else
  perform id from public.restaurants where id=r for no key update;
  if not found then return jsonb_build_object('outcome','not_found');end if;
  select revision into rev from private.provide_admin_revisions where restaurant_id=r;
  if rev is distinct from (q->>'expectedRevision')::integer then return jsonb_build_object('outcome','conflict');end if;
  if l is not null and action<>'createLocation' then
   perform id from public.locations where restaurant_id=r and id=l for update;
   if not found then return jsonb_build_object('outcome','forbidden');end if;
  elsif l is null then
   perform id from public.locations where restaurant_id=r order by id for update;
  end if;
 end if;
 case action
 when 'createRestaurant' then null;
 when 'createLocation' then
  if l is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=q->>'timezone') then return jsonb_build_object('outcome','invalid');end if;
  insert into public.locations(id,restaurant_id,slug,display_name,timezone) values(l,r,q->>'slug',q->>'displayName',q->>'timezone');
 when 'feature' then
  k:=q->>'featureKey';expiry:=(q->>'expiresAt')::timestamptz;
  if not exists(select 1 from public.feature_definitions where key=k) or q->>'mode' not in ('enabled','disabled','inherit') or
   (q->>'mode'='enabled' and expiry is null) or (expiry is not null and (expiry<=statement_timestamp() or expiry>statement_timestamp()+interval '30 days')) or
   (q->>'mode'='inherit' and expiry is not null) then return jsonb_build_object('outcome','invalid');end if;
  if l is null then
   if q->>'mode'='inherit' then delete from public.restaurant_feature_flags where restaurant_id=r and feature_key=k;
   else insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled,expires_at,reason,changed_by_user_id)
    values(r,k,q->>'mode'='enabled',expiry,why,actor) on conflict(restaurant_id,feature_key) do update
    set enabled=excluded.enabled,expires_at=excluded.expires_at,reason=excluded.reason,changed_by_user_id=actor;end if;
  else
   if q->>'mode'='inherit' then delete from private.location_feature_flags where restaurant_id=r and location_id=l and feature_key=k;
   else insert into private.location_feature_flags(restaurant_id,location_id,feature_key,enabled,expires_at,reason,changed_by_user_id)
    values(r,l,k,q->>'mode'='enabled',expiry,why,actor) on conflict(restaurant_id,location_id,feature_key) do update
    set enabled=excluded.enabled,expires_at=excluded.expires_at,reason=excluded.reason,changed_by_user_id=actor;end if;
  end if;
 when 'check' then
  k:=q->>'checkKey';select scope into definition_scope from public.onboarding_check_definitions where key=k;
  if definition_scope is distinct from (case when l is null then 'restaurant' else 'location' end) or q->>'status' not in ('pending','passed','failed') then return jsonb_build_object('outcome','invalid');end if;
  if l is null then select onboarding_status into state from public.restaurant_activation_states where restaurant_id=r;
  else select onboarding_status into state from public.location_activation_states where restaurant_id=r and location_id=l;end if;
  if state='approved' then return jsonb_build_object('outcome','conflict');end if;
  if q->>'status'='passed' then
   if q->>'evidenceKind' not in ('document','test','provider') or q->>'evidenceReference' is null or length(q->>'evidenceReference') not between 3 and 200 then return jsonb_build_object('outcome','invalid');end if;
   if k='restaurant.owner' and not exists(select 1 from public.restaurant_memberships where restaurant_id=r and role='owner' and status='active') then return jsonb_build_object('outcome','conflict');end if;
   if k='location.address' and not private.location_profile_is_complete(r,l) then return jsonb_build_object('outcome','conflict');end if;
  end if;
  update public.onboarding_check_results set status=q->>'status',note=why,
   checked_by_user_id=case when q->>'status'='pending' then null else actor end,checked_at=case when q->>'status'='pending' then null else now() end,
   evidence_kind=case when q->>'status'='pending' then null else q->>'evidenceKind' end,evidence_reference=case when q->>'status'='pending' then null else q->>'evidenceReference' end
   where restaurant_id=r and location_id is not distinct from l and check_key=k;
 when 'onboarding' then
  if q->>'status' in ('ready_for_review','approved') and exists(select 1 from public.onboarding_check_results c join public.onboarding_check_definitions d on d.key=c.check_key
   where c.restaurant_id=r and c.location_id is not distinct from l and d.required_for_go_live and (c.status<>'passed' or c.evidence_kind is null or c.evidence_reference is null)) then return jsonb_build_object('outcome','conflict');end if;
  if l is null and q->>'status'='approved' and not exists(select 1 from private.restaurant_launch_configuration where restaurant_id=r and merchant_role='restaurant'
   and payout_account_reference is not null and production_domain is not null and data_region='eu-central-1' and responsible_user_id is not null) then return jsonb_build_object('outcome','conflict');end if;
  if l is null then perform private.transition_restaurant_onboarding(r,q->>'status',actor,aal);
  else perform private.transition_location_onboarding(r,l,q->>'status',actor,aal);end if;
 when 'goLive' then
  if l is null then select t.slug into slug from public.restaurants t where id=r;else select t.slug into slug from public.locations t where restaurant_id=r and id=l;end if;
  if q->>'confirmation' is distinct from slug then return jsonb_build_object('outcome','invalid');end if;
  if q->>'status'='live' and allow_live is not true then return jsonb_build_object('outcome','forbidden');end if;
  if l is null then perform private.transition_restaurant_go_live(r,q->>'status',actor,aal);else perform private.transition_location_go_live(r,l,q->>'status',actor,aal);end if;
 when 'reopen' then
  select array_agg(x) into target_keys from jsonb_array_elements_text(q->'checkKeys')x;
  if target_keys is null or cardinality(target_keys) not between 1 and 30 or exists(select 1 from unnest(target_keys)x where not exists(select 1 from public.onboarding_check_results c where c.restaurant_id=r and c.location_id is not distinct from l and c.check_key=x)) then return jsonb_build_object('outcome','invalid');end if;
  perform private.reopen_provide_checks(r,l,target_keys);
 when 'critical' then
  if l is not null then return jsonb_build_object('outcome','forbidden');end if;cfg:=q->'configuration';
  insert into private.restaurant_launch_configuration(restaurant_id,merchant_role,payout_account_reference,production_domain,data_region,responsible_user_id)
   values(r,cfg->>'merchantRole',cfg->>'payoutAccountReference',cfg->>'productionDomain',cfg->>'dataRegion',(cfg->>'responsibleUserId')::uuid)
  on conflict(restaurant_id) do update set merchant_role=excluded.merchant_role,payout_account_reference=excluded.payout_account_reference,
   production_domain=excluded.production_domain,data_region=excluded.data_region,responsible_user_id=excluded.responsible_user_id;
 when 'profileStatus' then
  if q->>'status' not in ('setup','active','suspended') then return jsonb_build_object('outcome','invalid');end if;
  if q->>'status'='active' and allow_live is not true and ((l is null and exists(select 1 from public.restaurant_activation_states where restaurant_id=r and go_live_status='live')) or
   (l is not null and exists(select 1 from public.location_activation_states where restaurant_id=r and location_id=l and go_live_status='live'))) then return jsonb_build_object('outcome','forbidden');end if;
  if l is null then update public.restaurants set status=q->>'status' where id=r;else update public.locations set status=q->>'status' where restaurant_id=r and id=l;end if;
 else return jsonb_build_object('outcome','invalid');
 end case;
 update private.provide_admin_revisions set revision=revision+1 where restaurant_id=r;
 insert into private.provide_admin_audit(id,restaurant_id,location_id,action,actor_user_id,reason,before_state,after_state)
 values(event,r,l,'command.'||action,actor,why,jsonb_build_object('revision',rev),jsonb_build_object('revision',(select revision from private.provide_admin_revisions where restaurant_id=r)));
 insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
 values(r,'provide_administration',coalesce(l,r),'provide.administration.changed.v1',jsonb_build_object('audit_id',event,'action',action,'location_id',l),'provide-admin:'||event::text);
 insert into private.provide_admin_receipts(restaurant_id,actor_user_id,request_id,command) values(r,actor,rid,q);
 return private.read_provide_administration(actor,aal,jsonb_build_object('restaurantId',r,'locationId',l));
exception when unique_violation then return jsonb_build_object('outcome','conflict');
 when check_violation or foreign_key_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('outcome','invalid');
 when raise_exception then return jsonb_build_object('outcome','conflict');
end;
$$;
insert into public.onboarding_check_results(restaurant_id,location_id,check_key,scope)
select l.restaurant_id,l.id,d.key,d.scope from public.locations l cross join public.onboarding_check_definitions d where d.scope='location'
on conflict do nothing;

-- Preserve these six tested transaction bodies and replace only their explicit feature guard.
-- Abort migration if the known signatures/bindings no longer match; never silently skip a consumer.
do $guards$
declare p record;original text;rewritten text;n integer:=0;
begin
 for p in select f.oid,f.proname from pg_catalog.pg_proc f join pg_catalog.pg_namespace ns on ns.oid=f.pronamespace
  where ns.nspname='private' and f.proname=any(array['resolve_ordering_availability','resolve_public_menu_version','read_storefront_catalog_without_stops','initialize_order_payment','create_payment_attempt','submit_public_guest_online_order']) loop
  original:=pg_catalog.pg_get_functiondef(p.oid);
  rewritten:=regexp_replace(original,'private\.is_restaurant_feature_enabled\(\s*target_restaurant_id\s*,','private.is_location_feature_enabled(target_restaurant_id, target_location_id,','g');
  rewritten:=regexp_replace(rewritten,'private\.is_restaurant_feature_enabled\(\s*selected_restaurant\.id\s*,','private.is_location_feature_enabled(selected_restaurant.id, selected_location.id,','g');
  rewritten:=regexp_replace(rewritten,'private\.is_restaurant_feature_enabled\(\s*restaurant\s*,','private.is_location_feature_enabled(restaurant, location,','g');
  if rewritten=original or position('private.is_restaurant_feature_enabled(' in rewritten)>0 then raise exception 'unmatched location feature guard in %',p.proname;end if;
  execute rewritten;n:=n+1;
 end loop;
 if n<>6 then raise exception 'expected six location feature guard consumers, found %',n;end if;
end;
$guards$;

revoke all on function private.provide_admin_allowed(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.is_location_feature_enabled(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.is_location_feature_enabled(uuid,uuid,text) to service_role;
revoke all on function private.provide_admin_record_change() from public,anon,authenticated,service_role;
revoke all on function private.reopen_provide_checks(uuid,uuid,text[]) from public,anon,authenticated,service_role;
revoke all on function private.provide_critical_change() from public,anon,authenticated,service_role;
revoke all on function private.read_provide_administration(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function private.command_provide_administration(uuid,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function private.read_provide_administration(uuid,text,jsonb),private.command_provide_administration(uuid,text,jsonb,boolean) to service_role;
-- Legacy transition bodies remain internal helpers of the audited command.
-- Service-role RPC callers must not bypass evidence, revision or live switches.
revoke all on function private.assert_onboarding_actor(uuid,uuid,uuid,text),
 private.update_onboarding_check(uuid,uuid,text,text,uuid,text,text),
 private.transition_restaurant_onboarding(uuid,text,uuid,text),
 private.transition_location_onboarding(uuid,uuid,text,uuid,text),
 private.transition_restaurant_go_live(uuid,text,uuid,text),
 private.transition_location_go_live(uuid,uuid,text,uuid,text) from service_role;
