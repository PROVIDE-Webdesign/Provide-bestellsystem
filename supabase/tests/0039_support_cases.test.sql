begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc
create function pg_temp.u(n integer) returns uuid language sql immutable as $$select ('f1000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.support(q jsonb,actor integer default 6) returns jsonb language sql as $$
 select private.support_command(pg_temp.u(actor),pg_temp.u(actor)::text,'aal2',jsonb_build_object('restaurantId','f2000000-0000-0000-0000-000000000001','locationId','f3000000-0000-0000-0000-000000000001')||q)
$$;
create function pg_temp.read_support(actor integer default 6) returns jsonb language sql as $$select pg_temp.support('{"action":"read","caseId":null,"cursor":null}',actor)$$;
-- Rights are deliberately independent of every existing restaurant/platform role.
update public.restaurant_memberships set role='viewer' where user_id=pg_temp.u(6);
select is(pg_temp.read_support(n)->>'outcome','forbidden','T04 restaurant role grants no support right (6 = viewer): '||n) from generate_series(1,6)n;
update public.restaurant_memberships set role='manager' where user_id=pg_temp.u(6);
insert into private.provide_admin_grants(user_id) values(pg_temp.u(6));
select is(pg_temp.read_support()->>'outcome','forbidden','T03 global platform grant is not support authority');
insert into private.support_grants(user_id,restaurant_id,location_id,can_read,can_manage) values(pg_temp.u(6),'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',true,true);
insert into private.support_grants(user_id,can_read) values(pg_temp.u(2),true);
insert into private.support_grants(user_id,restaurant_id,can_read,can_manage) values(pg_temp.u(5),'f2000000-0000-0000-0000-000000000001',true,true);
select is(pg_temp.read_support()->>'outcome','allowed','T01 explicit grant and current session permit access');
select is(private.support_command(pg_temp.u(6),md5(pg_temp.u(6)::text||'aal1'),'aal1','{}')->>'outcome','forbidden','T02 AAL1 grant denied');
select is(pg_temp.support('{"action":"read","caseId":null,"cursor":null,"restaurantId":"f2000000-0000-0000-0000-000000000002","locationId":"f3000000-0000-0000-0000-000000000002"}')->>'outcome','forbidden','T05 foreign tenant/location denied');
select is(pg_temp.support('{"action":"read","caseId":null,"cursor":null,"restaurantId":"f2000000-0000-0000-0000-000000000002","locationId":"f3000000-0000-0000-0000-000000000002"}',2)->>'outcome','allowed','T06 explicit global read scope spans existing sites');
select is(pg_temp.read_support(5)->>'outcome','allowed','T06 restaurant grant permits only its location scope');
select is(pg_temp.read_support(2)->'data'->>'canManage','false','T09 read-only grant cannot manage');
select is(pg_temp.support(jsonb_build_object('action','scan','requestId',gen_random_uuid(),'cursor',null),2)->>'outcome','forbidden','T09 read grant cannot scan/create audit');
update private.support_grants set active=false where user_id=pg_temp.u(6);
select is(pg_temp.read_support()->>'outcome','forbidden','T07 grant revoke is checked freshly');
update private.support_grants set active=true where user_id=pg_temp.u(6);
update auth.users set banned_until=now()+interval '1 hour' where id=pg_temp.u(6);
select is(pg_temp.read_support()->>'outcome','forbidden','T08 banned account denied');
update auth.users set banned_until=null where id=pg_temp.u(6);
update private.account_security_state set blocked=true where user_id=pg_temp.u(6);
select is(pg_temp.read_support()->>'outcome','forbidden','T08 recovery-blocked account denied');
update private.account_security_state set blocked=false where user_id=pg_temp.u(6);
select is(private.support_command(pg_temp.u(6),gen_random_uuid()::text,'aal2','{}')->>'outcome','forbidden','T08 nonexistent session denied');
select is(pg_temp.support('{"action":"read","caseId":null,"cursor":null,"note":"guest@example.invalid"}')->>'outcome','invalid','T11 free PII note rejected');
select is(pg_temp.support('{"action":"read","caseId":null,"cursor":"https://attacker.invalid"}')->>'outcome','invalid','T11 URL cannot be a reference or trigger SSRF');
create temporary table commands(label text primary key,q jsonb,result jsonb);
insert into commands(label,q) select s,jsonb_build_object('action','create','requestId',gen_random_uuid(),'kind','incident','sourceId',null,'severity',s,'reason','incident_recorded') from unnest(array['critical','high','normal'])s;
update commands set result=pg_temp.support(q);
select is(result->>'outcome','allowed','T19 scoped incident allowed without fictional order') from commands;
select is(result#>'{data,cases,0,orderId}','null'::jsonb,'T19 incident has no fabricated payment/order reference') from commands;
select ok(abs(extract(epoch from ((result#>>'{data,cases,0,deadline}')::timestamptz-(result#>>'{data,cases,0,createdAt}')::timestamptz))-(case label when 'critical' then 1800 when 'high' then 14400 else 86400 end))<1,'T26 initial server deadline: '||label) from commands;
create function pg_temp.change_case(op text,extra jsonb default '{}') returns jsonb language sql as $$
 select pg_temp.support(jsonb_build_object('action','update','requestId',gen_random_uuid(),'caseId',(select result#>>'{data,cases,0,caseId}' from commands where label='normal'),
 'expectedRevision',(select revision from private.support_cases where id=(select (result#>>'{data,cases,0,caseId}')::uuid from commands where label='normal')),
 'operation',op,'assigneeUserId',null,'state',null,'severity',null,'deadline',null,'reason','triage','sourceFingerprint',null)||extra)
$$;
select is(pg_temp.change_case('claim')->'data'->'cases'->0->>'assigneeUserId',pg_temp.u(6)::text,'T20 claim sets verified actor');
select is(pg_temp.change_case('assign',jsonb_build_object('assigneeUserId',pg_temp.u(1)))->>'outcome','forbidden','T21 assignee without support grant denied');
select is(pg_temp.change_case('assign',jsonb_build_object('assigneeUserId',pg_temp.u(5)))->>'outcome','allowed','T21 scoped active assignee accepted');
update auth.users set banned_until=now()+interval '1 hour' where id=pg_temp.u(5);
select is(pg_temp.change_case('assign',jsonb_build_object('assigneeUserId',pg_temp.u(5)))->>'outcome','forbidden','T21 banned assignee denied');
update auth.users set banned_until=null where id=pg_temp.u(5);
select is(pg_temp.change_case('assign')->'data'->'cases'->0->'assigneeUserId','null'::jsonb,'T21 unassigned allowed');
select is(pg_temp.change_case('status','{"state":"waiting"}')->>'outcome','invalid','T22 waiting requires finite waiting reason');
select is(pg_temp.change_case('status','{"state":"waiting","reason":"awaiting_provider"}')->>'outcome','allowed','T22 waiting reason accepted');
select is(pg_temp.change_case('status','{"state":"paid"}')->>'outcome','invalid','T22 business state cannot be case state');
select is(pg_temp.change_case('status','{"state":"resolved","reason":"misassignment"}')->'data'->'cases'->0->>'resolution','administrative','T25 administrative closure is explicitly marked');
select is(pg_temp.change_case('status','{"state":"open","reason":"triage"}')->>'outcome','invalid','T25 reopening requires reason');
select is(pg_temp.change_case('status','{"state":"open","reason":"reopened"}')->>'outcome','allowed','T25 justified reopen accepted');
select is(pg_temp.change_case('priority','{"severity":"high","reason":"priority_changed"}')->>'outcome','allowed','T28 priority change has bounded reason');
select is(pg_temp.change_case('deadline',jsonb_build_object('deadline',now()+interval '31 days','reason','deadline_changed'))->>'outcome','invalid','T28 more than thirty days rejected');
select is(pg_temp.change_case('deadline',jsonb_build_object('deadline',now()+interval '2 hours','reason','deadline_changed'))->>'outcome','allowed','T28 valid UTC deadline accepted');
select is(pg_temp.change_case('deadline',jsonb_build_object('deadline',now()+interval '2 hours'))->>'outcome','invalid','T28 deadline without its reason rejected');
select is(pg_temp.change_case('claim','{"expectedRevision":1}')->>'outcome','conflict','T33 stale revision conflicts');
create temporary table audit_count as select count(*) n from private.support_audit;
select is(pg_temp.support(q)->>'outcome','allowed','T34/T36 committed request can be replayed after lost reply') from commands where label='critical';
select is((select count(*) from private.support_audit),(select n from audit_count),'T34/T36 replay adds no audit');
select is(pg_temp.support(q||'{"severity":"normal"}')->>'outcome','conflict','T34 same ID changed payload conflicts') from commands where label='critical';
update private.support_grants set active=false where user_id=pg_temp.u(6);
select is(pg_temp.support(q)->>'outcome','forbidden','T34 current grant checked before receipt replay') from commands where label='critical';
update private.support_grants set active=true where user_id=pg_temp.u(6);
create function pg_temp.audit_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end$$;
create trigger support_test_audit_failure before insert on private.support_audit for each row execute function pg_temp.audit_failure();
select throws_ok($$select pg_temp.change_case('claim')$$,'P0001','synthetic audit failure','T35 audit failure aborts complete mutation');
select is((select count(*) from private.support_audit),(select n from audit_count),'T35 failed audit creates no partial audit');
drop trigger support_test_audit_failure on private.support_audit;
select ok(not has_table_privilege(role,'private.support_cases','INSERT,UPDATE,DELETE'),'T37 no direct case DML: '||role) from unnest(array['anon','authenticated','service_role'])role;
select ok(not has_table_privilege(role,'private.support_audit','INSERT,UPDATE,DELETE'),'T37 no direct audit DML: '||role) from unnest(array['anon','authenticated','service_role'])role;
select ok(not has_function_privilege(role,'private.support_command(uuid,text,text,jsonb)','execute'),'T37 no actor-forging browser RPC: '||role) from unnest(array['anon','authenticated'])role;
select throws_ok($$update private.support_audit set reason='triage'$$,'42501','Account security audit is immutable','T37 append-only audit cannot change');
select * from finish();
rollback;
