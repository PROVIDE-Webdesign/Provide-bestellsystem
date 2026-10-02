-- R19-01 regression: synthetic fixtures, no provider calls; every change is rolled back.
begin;
select plan(42);

insert into auth.users(id,email,email_confirmed_at) values
 ('e9100000-0000-0000-0000-000000000001','r19-owner@example.invalid',now()),
 ('e9100000-0000-0000-0000-000000000002','r19-manager@example.invalid',now());
insert into public.restaurants(id,slug,display_name)
 values('e9200000-0000-0000-0000-000000000001','r19-review-synthetic','R19 Synthetic Review');
insert into public.locations(id,restaurant_id,slug,display_name)
 values('e9300000-0000-0000-0000-000000000001','e9200000-0000-0000-0000-000000000001','review-site','Review Site');
insert into public.restaurant_memberships(restaurant_id,user_id,role) values
 ('e9200000-0000-0000-0000-000000000001','e9100000-0000-0000-0000-000000000001','owner'),
 ('e9200000-0000-0000-0000-000000000001','e9100000-0000-0000-0000-000000000002','manager');
insert into public.restaurant_membership_locations(restaurant_id,user_id,location_id)
 values('e9200000-0000-0000-0000-000000000001','e9100000-0000-0000-0000-000000000002','e9300000-0000-0000-0000-000000000001');

create temporary table review_invite(q jsonb);
insert into review_invite select jsonb_build_object(
 'action','invite',
 'restaurantId','e9200000-0000-0000-0000-000000000001',
 'requestId','e9400000-0000-0000-0000-000000000001',
 'expectedRevision',(private.read_personnel('e9100000-0000-0000-0000-000000000002','aal2',
 '{"action":"read","restaurantId":"e9200000-0000-0000-0000-000000000001"}')->'data'->>'revision')::bigint,
 'reason','Original manager invitation reason',
 'email','r19-recipient@example.invalid','role','kitchen',
 'locationIds','["e9300000-0000-0000-0000-000000000001"]'::jsonb
);
select is(private.command_personnel('e9100000-0000-0000-0000-000000000002','aal2',
 (select q from review_invite))->>'outcome','allowed','manager reserves in current scope');

create temporary table review_cancel(q jsonb);
insert into review_cancel select jsonb_build_object(
 'action','cancelDispatch',
 'restaurantId','e9200000-0000-0000-0000-000000000001',
 'requestId','e9400000-0000-0000-0000-000000000002',
 'expectedRevision',(private.read_personnel('e9100000-0000-0000-0000-000000000001','aal2',
 '{"action":"read","restaurantId":"e9200000-0000-0000-0000-000000000001"}')->'data'->>'revision')::bigint,
 'reason','Actual owner cancellation reason',
 'dispatchId','e9400000-0000-0000-0000-000000000001'
);
select is(private.command_personnel('e9100000-0000-0000-0000-000000000001','aal2',
 (select q from review_cancel))->>'outcome','allowed','owner cancels another actor reservation');

select is((select actor_user_id from private.personnel_audit
 where restaurant_id='e9200000-0000-0000-0000-000000000001' and action='cancelDispatch'),
 'e9100000-0000-0000-0000-000000000001'::uuid,'command audit identifies actual owner');
select is((select reason from private.personnel_audit
 where restaurant_id='e9200000-0000-0000-0000-000000000001' and action='cancelDispatch'),
 'Actual owner cancellation reason','command audit carries actual cancellation reason');

-- The following three assertions express the required audit invariant.
select is((select actor_user_id from private.personnel_audit
 where restaurant_id='e9200000-0000-0000-0000-000000000001' and action='dispatch.state'
 and after_state->>'status'='cancelled'),
 'e9100000-0000-0000-0000-000000000001'::uuid,'status audit identifies actual cancelling owner');
select is((select reason from private.personnel_audit
 where restaurant_id='e9200000-0000-0000-0000-000000000001' and action='dispatch.state'
 and after_state->>'status'='cancelled'),
 'Actual owner cancellation reason','status audit carries actual cancellation reason');
select is((select a.actor_user_id from public.outbox_events e join private.personnel_audit a
 on a.id::text=e.payload->>'audit_id'
 where e.restaurant_id='e9200000-0000-0000-0000-000000000001'
 and e.aggregate_id='e9400000-0000-0000-0000-000000000001'
 and e.event_type='personnel.dispatch.changed.v1' and e.payload->>'status'='cancelled'),
 'e9100000-0000-0000-0000-000000000001'::uuid,'status event links the correctly attributed audit');

create temporary table review_audit_count as select count(*) n from private.personnel_audit
 where restaurant_id='e9200000-0000-0000-0000-000000000001';
select private.command_personnel('e9100000-0000-0000-0000-000000000001','aal2',(select q from review_cancel));
select is((select count(*) from private.personnel_audit
 where restaurant_id='e9200000-0000-0000-0000-000000000001'),
 (select n from review_audit_count),'identical cancellation replay adds no audit');


select is((select actor_user_id from private.personnel_dispatches where id='e9400000-0000-0000-0000-000000000001'),
 'e9100000-0000-0000-0000-000000000002'::uuid,'original dispatcher identity is retained');
select is((select reason from private.personnel_dispatches where id='e9400000-0000-0000-0000-000000000001'),
 'Original manager invitation reason','original invitation reason is retained separately');
select ok(not exists(select 1 from jsonb_array_elements(private.read_personnel('e9100000-0000-0000-0000-000000000002','aal2',
 '{"action":"read","restaurantId":"e9200000-0000-0000-0000-000000000001"}')->'data'->'audit') a
 where a->'after'->>'status'='cancelled'),'manager own-action audit excludes cancellation performed by owner');
select is(private.claim_personnel_dispatch('e9100000-0000-0000-0000-000000000002','aal2',
 'e9200000-0000-0000-0000-000000000001','e9400000-0000-0000-0000-000000000001'),null::jsonb,
 'preserved original dispatcher cannot reclaim a cancelled dispatch');

create function pg_temp.review_uid(n int) returns uuid language sql as $$
 select ('e9100000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.review_dispatch(n int) returns uuid language sql as $$
 select ('e9400000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.review_command(action text,extra jsonb,n int default 2) returns jsonb language sql as $$
 select private.command_personnel(pg_temp.review_uid(n),'aal2',jsonb_build_object(
 'action',action,'restaurantId','e9200000-0000-0000-0000-000000000001',
 'requestId',gen_random_uuid(),'expectedRevision',
 (select revision from private.personnel_revisions where restaurant_id='e9200000-0000-0000-0000-000000000001'),
 'reason','Original manager invitation reason')||extra) $$;
create function pg_temp.review_reserve(n int) returns jsonb language sql as $$
 select pg_temp.review_command('invite',jsonb_build_object('requestId',pg_temp.review_dispatch(n),
 'email','r19-recipient'||n||'@example.invalid','role','kitchen',
 'locationIds','["e9300000-0000-0000-0000-000000000001"]'::jsonb)) $$;
create function pg_temp.review_claim(n int) returns jsonb language sql as $$
 select private.claim_personnel_dispatch(pg_temp.review_uid(2),'aal2','e9200000-0000-0000-0000-000000000001',pg_temp.review_dispatch(n)) $$;
create function pg_temp.review_finish(n int,result text) returns jsonb language sql as $$
 select private.finish_personnel_dispatch(pg_temp.review_uid(2),'aal2','e9200000-0000-0000-0000-000000000001',pg_temp.review_dispatch(n),result) $$;
create function pg_temp.review_state_audit(n int,status text) returns jsonb language sql as $$
 select to_jsonb(a) from private.personnel_audit a where a.restaurant_id='e9200000-0000-0000-0000-000000000001'
 and a.action='dispatch.state' and a.after_state->>'dispatchId'=pg_temp.review_dispatch(n)::text and a.after_state->>'status'=status $$;

-- A provider completion after another owner's cancellation must not restore access or rewrite attribution.
insert into auth.users(id,email,email_confirmed_at) values(pg_temp.review_uid(3),'r19-recipient3@example.invalid',now());
select is(pg_temp.review_reserve(3)->>'outcome','allowed','manager reserves second recipient');
select ok(pg_temp.review_claim(3) is not null,'original manager claims once');
select ok(pg_temp.review_state_audit(3,'sending')->'actor_user_id'='null'::jsonb
 and pg_temp.review_state_audit(3,'sending')->'after_state'->>'changeKind'='system'
 and pg_temp.review_state_audit(3,'sending')->'after_state'->>'initiatorUserId'=pg_temp.review_uid(2)::text
 and pg_temp.review_state_audit(3,'sending')->>'reason'='Auth dispatch claimed by server',
 'server claim is system action with separate original initiator');
select is(pg_temp.review_command('cancelDispatch',jsonb_build_object('dispatchId',pg_temp.review_dispatch(3),
 'reason','Actual owner cancellation reason'),1)->>'outcome','allowed','owner cancels sending dispatch');
select is(pg_temp.review_state_audit(3,'cancelled')->>'actor_user_id',pg_temp.review_uid(1)::text,'sending cancellation retains actual owner attribution');
create temporary table late_count as select count(*) n from private.personnel_audit where restaurant_id='e9200000-0000-0000-0000-000000000001';
select is(pg_temp.review_finish(3,'sent')->>'outcome','allowed','late provider result only returns current projection');
select is((select count(*) from private.personnel_audit where restaurant_id='e9200000-0000-0000-0000-000000000001'),
 (select n from late_count),'late provider response adds no audit');
select ok(not exists(select 1 from public.restaurant_invitations where invited_user_id=pg_temp.review_uid(3))
 and not exists(select 1 from public.restaurant_memberships where user_id=pg_temp.review_uid(3)),'cancelled sending dispatch grants no invitation or membership');

-- Expired claims remain uncertain, without silently attributing an automatic action to a person.
select is(pg_temp.review_reserve(4)->>'outcome','allowed','reserve stale-claim case');
select ok(pg_temp.review_claim(4) is not null,'claim stale-claim case');
update private.personnel_dispatches set updated_at=clock_timestamp()-interval '40 seconds' where id=pg_temp.review_dispatch(4);
select is(pg_temp.review_claim(4),null::jsonb,'expired sending claim cannot resend');
select ok(pg_temp.review_state_audit(4,'uncertain')->'actor_user_id'='null'::jsonb
 and pg_temp.review_state_audit(4,'uncertain')->'after_state'->>'changeKind'='system'
 and pg_temp.review_state_audit(4,'uncertain')->>'reason'='Dispatch claim expired; delivery outcome unknown',
 'expired claim has explicit automatic uncertainty reason');
select is(pg_temp.review_claim(4),null::jsonb,'uncertain dispatch remains unreclaimable');

-- Unknown and failed provider outcomes retain the same explicit system contract.
select is(pg_temp.review_reserve(5)->>'outcome','allowed','reserve uncertain provider case');
select ok(pg_temp.review_claim(5) is not null,'claim uncertain provider case');
select is(pg_temp.review_finish(5,'uncertain')->>'outcome','allowed','finish uncertain provider case');
select ok(pg_temp.review_state_audit(5,'uncertain')->'actor_user_id'='null'::jsonb
 and pg_temp.review_state_audit(5,'uncertain')->>'reason'='Auth dispatch outcome remains unknown',
 'unknown provider result is attributed to system with matching reason');
select ok(exists(select 1 from private.personnel_audit where action='dispatch.uncertain'
 and actor_user_id is null and after_state->>'dispatchId'=pg_temp.review_dispatch(5)::text
 and after_state->>'changeKind'='system' and after_state->>'initiatorUserId'=pg_temp.review_uid(2)::text),
 'completion audit also separates system from initiator');
select is(pg_temp.review_reserve(6)->>'outcome','allowed','reserve failed provider case');
select ok(pg_temp.review_claim(6) is not null,'claim failed provider case');
select is(pg_temp.review_finish(6,'failed')->>'outcome','allowed','finish failed provider case');
select ok(pg_temp.review_state_audit(6,'failed')->'actor_user_id'='null'::jsonb
 and pg_temp.review_state_audit(6,'failed')->>'reason'='Auth dispatch failed or invitation unavailable',
 'failed provider result is attributed to system with matching reason');

-- Rights revoked while the Auth call is outside the transaction: cancel safely as a system action.
select is(pg_temp.review_reserve(7)->>'outcome','allowed','reserve rights-revocation case');
select ok(pg_temp.review_claim(7) is not null,'claim before current rights revocation');
delete from public.restaurant_membership_locations where restaurant_id='e9200000-0000-0000-0000-000000000001' and user_id=pg_temp.review_uid(2);
select is(pg_temp.review_finish(7,'sent')->>'outcome','forbidden','current rights revocation prevents finalization');
select ok(pg_temp.review_state_audit(7,'cancelled')->'actor_user_id'='null'::jsonb
 and pg_temp.review_state_audit(7,'cancelled')->'after_state'->>'changeKind'='system'
 and pg_temp.review_state_audit(7,'cancelled')->'after_state'->>'initiatorUserId'=pg_temp.review_uid(2)::text
 and pg_temp.review_state_audit(7,'cancelled')->>'reason'='Dispatcher authority revoked before completion',
 'rights revocation cancellation is explicit system action, not false human cancellation');

-- Missing status context and unattributed human actions fail closed.
-- Diagnostic stays inside the rolled-back synthetic transaction.
do $$ begin
 execute replace(pg_get_functiondef('private.command_personnel(uuid,text,jsonb)'::regprocedure),
 'when check_violation or foreign_key_violation or invalid_text_representation then return',
 'when check_violation or foreign_key_violation or invalid_text_representation then raise notice ''R19 fixture diagnostic %: %'', SQLSTATE, SQLERRM; return');
end $$;
select is(pg_temp.review_command('invite',jsonb_build_object('requestId',pg_temp.review_dispatch(8),
 'email','r19-context@example.invalid','role','kitchen','locationIds','["e9300000-0000-0000-000000000001"]'::jsonb),1)->>'outcome','allowed','owner reserves missing-context fixture');
select throws_ok($$update private.personnel_dispatches set status='sending' where id='e9400000-0000-0000-0000-000000000008'$$,
 '23514',null,'status update requires explicit actor context and reason');
select throws_ok($$insert into private.personnel_audit(restaurant_id,actor_user_id,action,reason,after_state)
 values('e9200000-0000-0000-0000-000000000001',null,'cancelDispatch','Unattributed human cancellation','{}')$$,
 '23514',null,'human audit cannot omit the real actor');
select ok(not has_table_privilege('service_role','private.personnel_dispatches','insert,update,delete,truncate,references,trigger')
 and not has_function_privilege('service_role','private.personnel_dispatch_state_audit()','execute'),
 'new status context is not an exposed direct server capability');

select * from finish();
rollback;
