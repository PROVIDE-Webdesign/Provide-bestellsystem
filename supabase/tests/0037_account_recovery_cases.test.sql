begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select plan(29);
create function pg_temp.u(n integer) returns uuid language sql immutable as $$ select ('a5100000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.c(n integer) returns uuid language sql immutable as $$ select ('a5200000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
insert into auth.users(id,email,email_confirmed_at) select pg_temp.u(n),'a4-'||n||'@example.invalid',now() from generate_series(1,8)n;
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,created_at,updated_at)
 select pg_temp.u(n),pg_temp.u(n),'totp','verified','SYNTHETICTEST',now(),now() from generate_series(1,8)n;
insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at)
 select pg_temp.u(n),pg_temp.u(n),'aal2',pg_temp.u(n),clock_timestamp(),clock_timestamp() from generate_series(1,8)n;
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at)
 select gen_random_uuid(),pg_temp.u(n),case when n>=4 then 'recovery' else 'password' end,now(),now() from generate_series(1,8)n;
insert into private.account_recovery_grants(user_id) values(pg_temp.u(2)),(pg_temp.u(3)),(pg_temp.u(4));
insert into private.provide_admin_grants(user_id) values(pg_temp.u(1)),(pg_temp.u(4));
insert into private.account_recovery_contacts(id,user_id,reference) select pg_temp.u(n),pg_temp.u(n),'prior-contact-'||n from generate_series(4,8)n;
create function pg_temp.run(actor_n integer,case_n integer,action text,extra jsonb default '{}') returns jsonb
language plpgsql as $$ declare q jsonb; begin
 q:=jsonb_build_object('action',action,'caseId',pg_temp.c(case_n),'commandId',gen_random_uuid(),'expectedRevision',(select revision from private.account_recovery_cases where id=pg_temp.c(case_n)))||extra;
 return private.account_recovery_command(pg_temp.u(actor_n),pg_temp.u(actor_n),'aal2',q);
end $$;
select is(pg_temp.run(4,4,'request','{"kind":"lost_factor","reason":"factor_lost"}')->>'outcome','allowed','confirmed email purpose creates loss case');
select is((select state from private.account_recovery_cases where id=pg_temp.c(4)),'requested','request is not approval');
select is((select required_approvals from private.account_recovery_cases where id=pg_temp.c(4)),2,'platform target needs two distinct operators');
select ok(not (select blocked from private.account_security_state where user_id=pg_temp.u(4)),'email request alone never locks account');
select is(pg_temp.run(1,4,'read')->>'outcome','forbidden','platform grant alone gives no recovery rights');
select is(pg_temp.run(4,4,'approve')->>'outcome','forbidden','administrative self approval forbidden');
select is(pg_temp.run(2,4,'execute')->>'outcome','conflict','email possession alone cannot execute');
select is(pg_temp.run(2,4,'verify',jsonb_build_object('contactId',pg_temp.u(8),'evidenceReference','proof-4'))->>'outcome','forbidden','foreign contact cannot prove identity');
select is(pg_temp.run(2,4,'verify',jsonb_build_object('contactId',pg_temp.u(4),'evidenceReference','proof-4'))->>'outcome','allowed','previously agreed independent contact can be recorded');
select is(pg_temp.run(2,4,'approve')->>'outcome','allowed','first independent approval recorded');
select is((select state from private.account_recovery_cases where id=pg_temp.c(4)),'verified','one operator cannot approve platform target alone');
select is(pg_temp.run(2,4,'approve')->>'outcome','allowed','same operator counted once');
select is((select count(*)::integer from private.account_recovery_approvals where case_id=pg_temp.c(4)),1,'duplicate approver remains one person');
select is(pg_temp.run(3,4,'approve')->>'outcome','allowed','second distinct operator approves');
select is((select state from private.account_recovery_cases where id=pg_temp.c(4)),'approved','approved state explicit');
select is(pg_temp.run(2,4,'execute')->>'outcome','allowed','current distinct approvals authorize effect intent');
select ok((select blocked from private.account_security_state where user_id=pg_temp.u(4)),'intent locks every business access');
select is((select state from private.account_recovery_cases where id=pg_temp.c(4)),'executing','effect intent precedes provider mutation');
-- Test-only provider-shaped DML, not the production factor-removal path.
delete from auth.mfa_factors where user_id=pg_temp.u(4);
select is(private.finish_account_recovery_effect(pg_temp.u(2),pg_temp.u(2),'aal2',pg_temp.c(4),gen_random_uuid())->'data'->>'state','awaiting_reenrollment','actual missing factors are reconciled');
select is((select count(*)::integer from auth.sessions where user_id=pg_temp.u(4)),0,'all previous target sessions are physically revoked');
select ok((select blocked from private.account_security_state where user_id=pg_temp.u(4)),'reconciled effect never auto unlocks');
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,created_at,updated_at) values(pg_temp.u(44),pg_temp.u(4),'totp','verified','SYNTHETICTEST',clock_timestamp(),clock_timestamp());
insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at) values(pg_temp.u(44),pg_temp.u(4),'aal2',pg_temp.u(44),clock_timestamp(),clock_timestamp());
select is(private.account_recovery_command(pg_temp.u(4),pg_temp.u(44),'aal2',jsonb_build_object('action','complete','caseId',pg_temp.c(4),'commandId',gen_random_uuid(),'expectedRevision',(select revision from private.account_recovery_cases where id=pg_temp.c(4))))->'data'->>'state','completed','only fresh current verified TOTP session completes');
select ok(private.account_session_live(pg_temp.u(4),pg_temp.u(44)::text,'aal2'),'new session can regain existing rights');
select ok(not private.account_session_live(pg_temp.u(4),pg_temp.u(4)::text,'aal2'),'old JWT never revives after completion');
select is(pg_temp.run(5,5,'request','{"kind":"lost_factor","reason":"factor_lost"}')->>'outcome','allowed','ordinary target case created');
select is((select required_approvals from private.account_recovery_cases where id=pg_temp.c(5)),1,'ordinary target needs one independent operator');
update private.account_recovery_cases set expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.c(5);
select is(pg_temp.run(2,5,'verify',jsonb_build_object('contactId',pg_temp.u(5),'evidenceReference','expired-proof'))->>'outcome','conflict','24 hour deadline cannot be bypassed');
select ok(not (select blocked from private.account_security_state where user_id=pg_temp.u(5)),'expired request never causes lock');
select throws_ok('update private.account_recovery_audit set reason=''changed''','42501','Account security audit is immutable','command audit immutable');
select * from finish();
rollback;
