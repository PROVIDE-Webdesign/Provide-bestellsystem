begin;
select plan(51);
insert into auth.users(id,email,email_confirmed_at) select ('c1000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'personnel'||n||'@example.invalid',now() from generate_series(1,9) n;
insert into public.restaurants(id,slug,display_name) values('c2000000-0000-0000-0000-000000000001','personnel-a','Personnel A'),('c2000000-0000-0000-0000-000000000002','personnel-b','Personnel B');
insert into public.locations(id,restaurant_id,slug,display_name) values
 ('c3000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','a-mitte','Mitte'),
 ('c3000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000001','a-west','West'),
 ('c3000000-0000-0000-0000-000000000003','c2000000-0000-0000-0000-000000000002','b-mitte','Foreign');
insert into public.restaurant_memberships(restaurant_id,user_id,role) values
 ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','owner'),
 ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002','manager'),
 ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000003','kitchen'),
 ('c2000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000004','owner'),
 ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000005','driver');
insert into public.restaurant_membership_locations(restaurant_id,user_id,location_id) values
 ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002','c3000000-0000-0000-0000-000000000001'),
 ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000003','c3000000-0000-0000-0000-000000000001'),
 ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000005','c3000000-0000-0000-0000-000000000001'),
 ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000005','c3000000-0000-0000-0000-000000000002');
create function pg_temp.uid(n int) returns uuid language sql as $$select ('c1000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.read_staff(n int default 1,aal text default 'aal2') returns jsonb language sql as $$select private.read_personnel(pg_temp.uid(n),aal,'{"action":"read","restaurantId":"c2000000-0000-0000-0000-000000000001"}')$$;
create function pg_temp.pc(action text,extra jsonb,n int default 1,aal text default 'aal2') returns jsonb language sql as $$
select private.command_personnel(pg_temp.uid(n),aal,jsonb_build_object('action',action,'restaurantId','c2000000-0000-0000-0000-000000000001','expectedRevision',coalesce((select revision from private.personnel_revisions where restaurant_id='c2000000-0000-0000-0000-000000000001'),0),'requestId',gen_random_uuid(),'reason','Synthetic personnel review')||extra)$$;
select is(pg_temp.read_staff()->>'outcome','allowed','owner reads managed personnel');
select is(pg_temp.read_staff(1,'aal1')->>'outcome','forbidden','owner management requires MFA');
select is(pg_temp.read_staff(3)->>'outcome','forbidden','kitchen cannot manage personnel');
select is(pg_temp.read_staff(4)->>'outcome','forbidden','foreign owner cannot manage personnel');
select is(jsonb_array_length(pg_temp.read_staff(2)->'data'->'locations'),1,'manager sees only own location');
select is(jsonb_array_length(pg_temp.read_staff(2)->'data'->'members'),1,'manager sees only wholly manageable kitchen/driver memberships');
select is(pg_temp.pc('member',jsonb_build_object('userId',pg_temp.uid(5),'role','driver','status','suspended','locationIds','["c3000000-0000-0000-0000-000000000001"]'::jsonb),2)->>'outcome','forbidden','manager cannot take over a membership with another location');
select is(pg_temp.pc('member',jsonb_build_object('userId',pg_temp.uid(3),'role','manager','status','active','locationIds','["c3000000-0000-0000-0000-000000000001"]'::jsonb),2)->>'outcome','forbidden','manager cannot grant a responsible role');
select is(pg_temp.pc('member',jsonb_build_object('userId',pg_temp.uid(3),'role','kitchen','status','active','locationIds','["c3000000-0000-0000-0000-000000000003"]'::jsonb))->>'outcome','forbidden','owner cannot cross tenant locations');
select is(pg_temp.pc('member',jsonb_build_object('userId',pg_temp.uid(1),'role','owner','status','suspended','locationIds','[]'::jsonb))->>'outcome','conflict','self suspension is blocked');
select is(pg_temp.pc('member',jsonb_build_object('userId',pg_temp.uid(3),'role','kitchen','status','suspended','locationIds','["c3000000-0000-0000-0000-000000000001"]'::jsonb),2)->>'outcome','allowed','manager suspends wholly assigned kitchen');
select is(private.dashboard_order_actor_role('c2000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',pg_temp.uid(3),'aal1'),null::text,'existing-token order projection loses access immediately');
select is(pg_temp.pc('member',jsonb_build_object('userId',pg_temp.uid(3),'role','kitchen','status','active','locationIds','["c3000000-0000-0000-0000-000000000002"]'::jsonb))->>'outcome','allowed','owner moves membership atomically to West');
select is(private.dashboard_order_actor_role('c2000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',pg_temp.uid(3),'aal1'),null::text,'old location remains denied after reactivation');
select is(private.dashboard_order_actor_role('c2000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000002',pg_temp.uid(3),'aal1'),'kitchen','new location authorizes existing token');
create temporary table replay(q jsonb);
insert into replay select jsonb_build_object('action','invite','restaurantId','c2000000-0000-0000-0000-000000000001','expectedRevision',(pg_temp.read_staff()->'data'->>'revision')::bigint,'requestId','c4000000-0000-0000-0000-000000000001','reason','Synthetic invitation review','email','personnel6@example.invalid','role','kitchen','locationIds','["c3000000-0000-0000-0000-000000000001"]'::jsonb);
select is(private.command_personnel(pg_temp.uid(1),'aal2',(select q from replay))->>'outcome','allowed','invite reserves a durable dispatch');
select ok(not exists(select 1 from public.restaurant_memberships where user_id=pg_temp.uid(6)),'reservation grants no membership');
create temporary table counters as select count(*) n from private.personnel_audit;
select is(private.command_personnel(pg_temp.uid(1),'aal2',(select q from replay))->>'outcome','allowed','identical invitation retry is accepted');
select is((select count(*) from private.personnel_audit),(select n from counters),'retry duplicates no audit');
select is(private.command_personnel(pg_temp.uid(1),'aal2',(select q||'{"reason":"Different review reason"}'::jsonb from replay))->>'outcome','conflict','same request cannot change intent');
select is(pg_temp.pc('invite','{"email":"personnel7@example.invalid","role":"kitchen","locationIds":["c3000000-0000-0000-0000-000000000001"],"expectedRevision":0}')->>'outcome','conflict','stale revision does not reserve');
select is(private.claim_personnel_dispatch(pg_temp.uid(1),'aal2','c2000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001')->>'email','personnel6@example.invalid','authorized dispatch claims once');
select is(private.claim_personnel_dispatch(pg_temp.uid(1),'aal2','c2000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001'),null::jsonb,'concurrent or repeated claim cannot send again');
select is(private.finish_personnel_dispatch(pg_temp.uid(1),'aal2','c2000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','sent')->>'outcome','allowed','Auth-success finalizes native invitation');
select is((select count(*) from public.restaurant_invitations where invited_user_id=pg_temp.uid(6)),1::bigint,'exactly one invitation recorded');
select is(private.accept_personnel(pg_temp.uid(7),'aal1',(select id from public.restaurant_invitations where invited_user_id=pg_temp.uid(6)))->>'outcome','forbidden','other recipient cannot accept');
select is(private.accept_personnel(pg_temp.uid(6),'aal1',(select id from public.restaurant_invitations where invited_user_id=pg_temp.uid(6)))->>'outcome','allowed','confirmed kitchen recipient consciously accepts');
create temporary table accepted_audits as select count(*) n from private.personnel_audit;
select is(private.accept_personnel(pg_temp.uid(6),'aal1',(select id from public.restaurant_invitations where invited_user_id=pg_temp.uid(6)))->>'outcome','allowed','lost acceptance response replays safely');
select is((select count(*) from private.personnel_audit),(select n from accepted_audits),'acceptance replay duplicates no audit');
select is((select count(*) from public.restaurant_membership_locations where user_id=pg_temp.uid(6)),1::bigint,'accepted scope copied once');
select is(pg_temp.pc('invite','{"email":"personnel7@example.invalid","role":"manager","locationIds":["c3000000-0000-0000-0000-000000000001"]}')->>'outcome','allowed','owner reserves manager invitation');
create temporary table manager_dispatch as select id from private.personnel_dispatches where email='personnel7@example.invalid';
select ok(private.claim_personnel_dispatch(pg_temp.uid(1),'aal2','c2000000-0000-0000-0000-000000000001',(select id from manager_dispatch)) is not null,'manager dispatch claimed');
select is(private.finish_personnel_dispatch(pg_temp.uid(1),'aal2','c2000000-0000-0000-0000-000000000001',(select id from manager_dispatch),'sent')->>'outcome','allowed','manager invite finalized');
select is(private.accept_personnel(pg_temp.uid(7),'aal1',(select id from public.restaurant_invitations where invited_user_id=pg_temp.uid(7)))->>'outcome','forbidden','responsible recipient must verify MFA');
select is(pg_temp.pc('revoke',jsonb_build_object('invitationId',(select id from public.restaurant_invitations where invited_user_id=pg_temp.uid(7))))->>'outcome','allowed','owner revokes pending invitation');
select is(private.accept_personnel(pg_temp.uid(7),'aal2',(select id from public.restaurant_invitations where invited_user_id=pg_temp.uid(7)))->>'outcome','conflict','revoked invite cannot authorize after MFA');
select ok(not has_table_privilege('service_role','public.restaurant_memberships','insert,update,delete'),'direct server membership writes revoked');
select ok(not has_function_privilege('service_role','private.accept_restaurant_invitation(uuid,uuid,text)','execute'),'legacy acceptance cannot bypass audit');
select ok(has_function_privilege('service_role','private.accept_personnel(uuid,text,uuid)','execute'),'server can call bounded acceptance');
select throws_ok('update private.personnel_audit set reason=''Tampered audit reason''','55000',null,'audit is append-only');
select is(pg_temp.pc('invite','{"email":"personnel8@example.invalid","role":"kitchen","locationIds":["c3000000-0000-0000-0000-000000000002"]}',2)->>'outcome','forbidden','manager cannot dispatch outside assigned scope');
update auth.users set banned_until=now()+interval '1 hour' where id=pg_temp.uid(1);
select is(pg_temp.read_staff()->>'outcome','forbidden','Auth ban takes effect for management');
update auth.users set banned_until=null where id=pg_temp.uid(1);
select is((select role from public.restaurant_memberships where restaurant_id='c2000000-0000-0000-0000-000000000002' and user_id=pg_temp.uid(4)),'owner','foreign membership remains intact');
select is(pg_temp.pc('invite','{"email":"personnel8@example.invalid","role":"kitchen","locationIds":["c3000000-0000-0000-0000-000000000001"]}',2)->>'outcome','allowed','manager reserves within their current scope');
create temporary table revoked_dispatch as select id from private.personnel_dispatches where email='personnel8@example.invalid';
select ok(private.claim_personnel_dispatch(pg_temp.uid(2),'aal2','c2000000-0000-0000-0000-000000000001',(select id from revoked_dispatch)) is not null,'authorized manager claim before scope revocation');
delete from public.restaurant_membership_locations where user_id=pg_temp.uid(2);
select is(private.finish_personnel_dispatch(pg_temp.uid(2),'aal2','c2000000-0000-0000-0000-000000000001',(select id from revoked_dispatch),'sent')->>'outcome','forbidden','scope rechecked after external Auth response');
select is((select status from private.personnel_dispatches where id=(select id from revoked_dispatch)),'cancelled','revocation cancels dispatch without creating invitation');
select ok(not exists(select 1 from public.restaurant_invitations where invited_user_id=pg_temp.uid(8)),'late provider success grants no access');
insert into public.restaurant_invitations(id,restaurant_id,invited_user_id,email,role,invited_by_user_id,created_at,expires_at)
values('c5000000-0000-0000-0000-000000000009','c2000000-0000-0000-0000-000000000001',pg_temp.uid(9),'personnel9@example.invalid','kitchen',pg_temp.uid(1),now()-interval '2 days',now()-interval '1 day');
insert into public.restaurant_invitation_locations(restaurant_id,invitation_id,location_id) values('c2000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000009','c3000000-0000-0000-0000-000000000001');
select is(private.accept_personnel(pg_temp.uid(9),'aal1','c5000000-0000-0000-0000-000000000009')->>'outcome','conflict','expired invitation cannot create membership');
select ok(not exists(select 1 from public.restaurant_memberships where user_id=pg_temp.uid(9)),'expired acceptance leaves no partial membership');
select is(pg_temp.pc('revoke','{"invitationId":"c5000000-0000-0000-0000-000000000009"}')->>'outcome','allowed','owner can close expired invitation before a deliberate new invite');
select * from finish();rollback;
