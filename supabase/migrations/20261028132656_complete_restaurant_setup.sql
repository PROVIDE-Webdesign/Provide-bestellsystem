-- General setup commands; no live identity, grant or activation is created by this migration.
create function private.valid_setup_address(a jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare k text;v text;maximum integer;
begin
 if jsonb_typeof(a) is distinct from 'object' then return false;end if;
 if (select count(*) from jsonb_object_keys(a))<>5 or not a ?& array['addressLine1','addressLine2','postalCode','city','countryCode'] then return false;end if;
 foreach k in array array['addressLine1','addressLine2','postalCode','city','countryCode'] loop
  if k='addressLine2' and a->k='null'::jsonb then continue;end if;
  if jsonb_typeof(a->k) is distinct from 'string' then return false;end if;
  v:=a->>k;maximum:=case k when 'postalCode' then 20 when 'city' then 100 when 'countryCode' then 2 else 160 end;
  if length(v) not between 1 and maximum or v<>btrim(v) or v~'[[:cntrl:]]' then return false;end if;
 end loop;
 return a->>'countryCode' ~ '^[A-Z]{2}$';
end;$$;
revoke all on function private.valid_setup_address(jsonb) from public,anon,authenticated,service_role;

create or replace function private.read_provide_administration(actor uuid,aal text,q jsonb) returns jsonb
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
   'address',case when l is not null and loc.address_line_1 is not null and loc.postal_code is not null and loc.city is not null and loc.country_code is not null then jsonb_build_object('addressLine1',loc.address_line_1,'addressLine2',loc.address_line_2,'postalCode',loc.postal_code,'city',loc.city,'countryCode',loc.country_code) else null end,'locationId',l,'locations',locs,'nextLocationCursor',next_l,'profileStatus',case when l is null then rest.status else loc.status end,
   'onboardingStatus',os,'goLiveStatus',gs,'configuration',cfg,'checks',checks,'features',features,'audit',audit);
 end if;
 return jsonb_build_object('outcome','allowed','data',jsonb_build_object('serverNow',statement_timestamp(),'liveActionsEnabled',false,
  'canCreateRestaurant',private.provide_admin_allowed(actor,aal,null,null),'restaurants',list,'nextRestaurantCursor',next_r,'selected',sel));
exception when invalid_text_representation then return jsonb_build_object('outcome','invalid');
end;
$$;

create or replace function private.command_provide_administration(actor uuid,aal text,q jsonb,allow_live boolean) returns jsonb
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
 when 'locationAddress' then
  cfg:=q->'address';
  if l is null or not private.valid_setup_address(cfg) then return jsonb_build_object('outcome','invalid');end if;
  update public.locations set address_line_1=cfg->>'addressLine1',address_line_2=cfg->>'addressLine2',
   postal_code=cfg->>'postalCode',city=cfg->>'city',country_code=cfg->>'countryCode' where restaurant_id=r and id=l;
 when 'firstOwner' then
  if l is not null or not private.provide_admin_allowed(actor,aal,null,null) then return jsonb_build_object('outcome','forbidden');end if;
  if q->>'confirmation' is distinct from (select t.slug from public.restaurants t where t.id=r) then return jsonb_build_object('outcome','invalid');end if;
  perform pg_advisory_xact_lock(hashtextextended('personnel:'||r::text,0));
  if not exists(select 1 from public.restaurants t where t.id=r and t.status='setup') or
     exists(select 1 from public.restaurant_memberships m where m.restaurant_id=r) or
     exists(select 1 from public.restaurant_activation_states a where a.restaurant_id=r and (a.onboarding_status='approved' or a.go_live_status='live')) then return jsonb_build_object('outcome','conflict');end if;
  perform u.id from auth.users u where u.id=(q->>'ownerUserId')::uuid and u.email_confirmed_at is not null
   and (u.banned_until is null or u.banned_until<=statement_timestamp()) for share;
  if not found then return jsonb_build_object('outcome','conflict');end if;
  perform f.id from auth.mfa_factors f where f.user_id=(q->>'ownerUserId')::uuid and f.status='verified' for share;
  if not found then return jsonb_build_object('outcome','conflict');end if;
  insert into public.restaurant_memberships(restaurant_id,user_id,role,status) values(r,(q->>'ownerUserId')::uuid,'owner','active');
  insert into private.personnel_audit(restaurant_id,actor_user_id,action,reason,before_state,after_state)
   values(r,actor,'bootstrap.owner',why,null,jsonb_build_object('userId',q->>'ownerUserId','role','owner','status','active'));
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
