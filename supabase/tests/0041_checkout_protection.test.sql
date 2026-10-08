begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc
-- DB assertions deliberately exercise the real functions, not a simulated rate/session store.
select ok(c.relrowsecurity,'O3-T02/T48 private table has RLS: '||c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in('checkout_browser_contexts','checkout_sessions','checkout_issue_claims','checkout_gateway_nonces','checkout_rate_buckets');
select ok(not has_table_privilege(role,'private.'||tab,'SELECT,INSERT,UPDATE,DELETE'),'O3-T02/T48 no direct DML for '||role||'/'||tab) from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['checkout_browser_contexts','checkout_sessions','checkout_issue_claims','checkout_gateway_nonces','checkout_rate_buckets'])tab;
select ok(not has_function_privilege(role,p.oid,'EXECUTE'),'O3-T02/T48 no browser EXECUTE: '||role||'/'||p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated'])role where n.nspname='private' and p.proname like 'checkout\_%' escape '\';
select ok(p.proconfig @> array['search_path=""'],'O3-T48 qualified SECURITY DEFINER search_path: '||p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'checkout\_%' escape '\' and p.prosecdef;
create function pg_temp.context(h text, fresh boolean default true) returns jsonb language sql as $$select private.checkout_context(h,fresh)$$;
create function pg_temp.issue(h text,seq integer,renew uuid default null) returns jsonb language plpgsql as $$
declare ch text:=md5('challenge-'||seq)||md5('challenge-b-'||seq);i uuid:=md5('issue-'||seq)::uuid;b text:=repeat('b',43);res jsonb;
begin
 res:=private.checkout_issue_begin(ch,i,b,h);
 if res->>'outcome'='issued' then return res;end if;
 return private.checkout_issue_finish(ch,i,b,h,'storefront-restaurant-a','storefront-a-mitte','o3-synthetic-'||seq,renew,true);
end $$;
create temporary table contexts(h text primary key);insert into contexts select repeat(s,64) from unnest(array['a','b','c','d','e','f'])s;
select is(pg_temp.context(repeat('a',64),false)->>'outcome','forbidden','O3-T08 unknown client verifier cannot bootstrap');
select is(pg_temp.context(h)->>'outcome','allowed','O3-T01 valid server verifier hash starts a context') from contexts;
select is((select expires_at-created_at from private.checkout_browser_contexts where verifier_hash=repeat('a',64)),interval '90 minutes','O3-T04 bootstrap expiry is fixed');
select pg_temp.context(repeat('a',64),false);
select is((select expires_at-created_at from private.checkout_browser_contexts where verifier_hash=repeat('a',64)),interval '90 minutes','O3-T04 bootstrap read cannot extend context');
create temporary table intents(n integer primary key,h text,issue jsonb,sid uuid);
insert into intents(n,h,issue) select n,repeat(case when n<=3 then 'a' when n<=5 then 'b' else 'c' end,64),pg_temp.issue(repeat(case when n<=3 then 'a' when n<=5 then 'b' else 'c' end,64),n) from generate_series(1,6)n;
update intents set sid=(issue#>>'{intent,sessionId}')::uuid;
select is(issue->>'outcome','issued','O3-T01/T33 session issued under valid binding: '||n) from intents;
select is(write_expires_at-created_at,interval '30 minutes','O3-T04 fixed write duration') from private.checkout_sessions;
select is(receipt_expires_at-created_at,interval '90 minutes','O3-T05 fixed receipt duration') from private.checkout_sessions;
select is(pg_temp.issue(repeat('a',64),7)->>'outcome','conflict','O3-T42 fourth open intent refused');
select is(pg_temp.issue(repeat('a',64),1)#>>'{intent,sessionId}',(select sid::text from intents where n=1),'O3-T35 issue replay returns the identical session');
select is(private.checkout_issue_begin(md5('challenge-1')||md5('challenge-b-1'),md5('issue-1')::uuid,repeat('x',43),repeat('a',64))->>'outcome','forbidden','O3-T34 challenge binding cannot change');
select is(private.checkout_issue_begin(md5('challenge-1')||md5('challenge-b-1'),md5('issue-99')::uuid,repeat('b',43),repeat('b',64))->>'outcome','forbidden','O3-T34 used challenge cannot create another session');
create function pg_temp.cmd(n integer) returns jsonb language sql as $$select jsonb_build_object('menuId','f4000000-0000-0000-0000-000000000001','menuVersionId','f5000000-0000-0000-0000-000000000001','requestedFor',date_trunc('hour',statement_timestamp())+interval '4 hours','lines','[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,'submissionKey','o3-synthetic-'||n,'customer','{"contact_name":"Synthetic","phone_e164":"+999100000001","email":"o3@example.invalid"}'::jsonb,'privacyNoticeVersion','preview-v1')$$;
create function pg_temp.submit(n integer, h text default null, fingerprint text default null, changes jsonb default '{}') returns jsonb language sql as $$
 select private.checkout_submit(coalesce(h,(select t.h from intents t where t.n=submit.n)),(select sid from intents t where t.n=submit.n),'storefront-restaurant-a','storefront-a-mitte','orders',coalesce(fingerprint,repeat('f',43)),pg_temp.cmd(n)||changes,30,null)
$$;
select throws_ok($$select pg_temp.submit(1,repeat('f',64))$$,'P0001','Checkout intent unavailable','O3-T02 wrong verifier cannot write');
select throws_ok($$select private.checkout_submit(repeat('a',64),(select sid from intents where n=1),'storefront-restaurant-b','storefront-b-mitte','orders',repeat('f',43),pg_temp.cmd(1),30,null)$$,'P0001','Checkout intent unavailable','O3-T03 wrong tenant/location cannot write');
select throws_ok($$select pg_temp.submit(1,null,null,'{"submissionKey":"different-key"}')$$,'P0001','Checkout intent unavailable','O3-T12 other key cannot write');
create temporary table first_receipt as select pg_temp.submit(1) as data;
select is(pg_temp.submit(1),(select data from first_receipt),'O3-T09 same intent returns identical raw receipt');
select is((select count(*)::integer from public.orders),1,'O3-T09 one actual order');
select is((select count(*)::integer from public.order_payments),1,'O3-T09 one payment snapshot');
select is((select count(*)::integer from public.ordering_capacity_claims),1,'O3-T09 one capacity claim');
select throws_ok($$select pg_temp.submit(1,null,repeat('x',43))$$,'P0001','Checkout payload conflict','O3-T11 changed normalized payload HMAC rejected');
select is(private.checkout_receipt(repeat('b',64),(select sid from intents where n=1),'storefront-restaurant-a','storefront-a-mitte','o3-synthetic-1')->>'outcome','forbidden','O3-T13 foreign browser cannot read known key');
select is(private.checkout_receipt(repeat('a',64),(select sid from intents where n=1),'storefront-restaurant-a','storefront-a-mitte','different-key')->>'outcome','forbidden','O3-T05 wrong receipt key refused');
-- Controlled administrator clock fixtures: production functions have no caller-supplied session time.
with tm as (select clock_timestamp() as t) update private.checkout_sessions set created_at=tm.t-interval '30 minutes',write_expires_at=tm.t,receipt_expires_at=tm.t+interval '60 minutes' from tm where id=(select sid from intents where n=2);
select throws_ok($$select pg_temp.submit(2)$$,'P0001','Checkout session expired','O3-T04 write closed at/after 30 minutes');
select is(private.checkout_receipt(repeat('a',64),(select sid from intents where n=2),'storefront-restaurant-a','storefront-a-mitte','o3-synthetic-2')->>'outcome','unsubmitted','O3-T07 expired uncommitted session can be checked before explicit renewal');
select is(pg_temp.issue(repeat('a',64),8,(select sid from intents where n=2))->>'outcome','issued','O3-T07 new challenge atomically renews an uncommitted intent');
select ok((select revoked_at is not null from private.checkout_sessions where id=(select sid from intents where n=2)),'O3-T07 old intent atomically revoked');
select is(pg_temp.issue(repeat('a',64),8,(select sid from intents where n=2))->>'outcome','issued','O3-T35 successful renewal reply can be replayed');
select is(pg_temp.issue(repeat('a',64),9,(select sid from intents where n=1))->>'outcome','conflict','O3-T07 committed intent cannot be renewed into a second order');
with tm as (select clock_timestamp() as t) update private.checkout_sessions set created_at=tm.t-interval '31 minutes',write_expires_at=tm.t-interval '1 minute',receipt_expires_at=tm.t+interval '59 minutes' from tm where id=(select sid from intents where n=1);
select is(private.checkout_receipt(repeat('a',64),(select sid from intents where n=1),'storefront-restaurant-a','storefront-a-mitte','o3-synthetic-1')->>'outcome','committed','O3-T05 committed receipt survives 30-minute write expiry');
update public.location_activation_states set go_live_status='blocked' where location_id='f3000000-0000-0000-0000-000000000001';
select is(pg_temp.submit(1),(select data from first_receipt),'O3-T16 replay remains read only after catalog closes');
with tm as (select clock_timestamp() as t) update private.checkout_sessions set created_at=tm.t-interval '90 minutes',write_expires_at=tm.t-interval '60 minutes',receipt_expires_at=tm.t from tm where id=(select sid from intents where n=1);
select is(private.checkout_receipt(repeat('a',64),(select sid from intents where n=1),'storefront-restaurant-a','storefront-a-mitte','o3-synthetic-1')->>'outcome','expired','O3-T06 receipt closed at 90 minutes');
select is((select count(*)::integer from public.orders),1,'O3-T06 session expiry leaves order history untouched');
-- Each configured start profile is an actual token bucket, including last token and DB-clock refill.
create function pg_temp.guard(k text,cap integer,period integer,n uuid default gen_random_uuid()) returns jsonb language sql as $$select private.checkout_guard(n,clock_timestamp(),jsonb_build_array(jsonb_build_object('key',k,'capacity',cap,'period',period)))$$;
create temporary table profiles(label text,capacity integer,period integer);
insert into profiles values('issue-primary',5,600),('issue-network',120,600),('write-primary',6,60),('write-network',120,60),('receipt-primary',60,60),('read-network',600,60),('quote-primary',60,60),('status-primary',60,60),('payment-primary',20,60),('payment-network',120,60);
select is(pg_temp.guard('test:'||p.label,p.capacity,p.period)->>'outcome','allowed','O3-T25 within burst: '||label||' token '||i) from profiles p cross join lateral generate_series(1,p.capacity)i;
-- Exhaustion is controlled separately from elapsed runtime: a real token bucket refills during a large burst.
update private.checkout_rate_buckets set tokens=0,updated_at=clock_timestamp() where bucket_key like 'test:%';
select is(pg_temp.guard('test:'||label,capacity,period)->>'outcome','limited','O3-T25 controlled exhausted bucket limited: '||label) from profiles;
select ok((pg_temp.guard('test:'||label,capacity,period)->>'retryAfter')::integer between 1 and period,'O3-T25 positive bounded Retry-After: '||label) from profiles;
update private.checkout_rate_buckets set updated_at=clock_timestamp()-make_interval(secs=>period_seconds/capacity+1) where bucket_key like 'test:%';
select is(pg_temp.guard('test:'||label,capacity,period)->>'outcome','allowed','O3-T25 one-token DB-time refill: '||label) from profiles;
create temporary table nonce as select gen_random_uuid() as id;
select is(pg_temp.guard('nonce-test',5,600,(select id from nonce))->>'outcome','allowed','O3-T21 first nonce accepted');
select is(pg_temp.guard('nonce-test',5,600,(select id from nonce))->>'outcome','forbidden','O3-T21 consumed nonce rejected');
select is(private.checkout_guard(gen_random_uuid(),clock_timestamp()-interval '31 seconds','[{"key":"old-time","capacity":5,"period":600}]')->>'outcome','forbidden','O3-T21 stale gateway timestamp denied');
select is(private.checkout_guard(gen_random_uuid(),clock_timestamp()+interval '3 seconds','[{"key":"future-time","capacity":5,"period":600}]')->>'outcome','forbidden','O3-T21 future gateway timestamp denied');
-- Physical expiry deletion, without deleting the immutable guest order history.
update private.checkout_gateway_nonces set purge_at=clock_timestamp()-interval '1 second';
update private.checkout_rate_buckets set purge_at=clock_timestamp()-interval '1 second';
update private.checkout_issue_claims set purge_at=clock_timestamp()-interval '1 second';
update private.checkout_sessions set purge_at=clock_timestamp()-interval '1 second';
update private.checkout_browser_contexts set purge_at=clock_timestamp()-interval '1 second';
select private.checkout_cleanup(1000); select private.checkout_cleanup(1000); select private.checkout_cleanup(1000);
select is((select count(*)::integer from private.checkout_gateway_nonces),0,'O3-T49 nonces physically deleted');
select is((select count(*)::integer from private.checkout_rate_buckets),0,'O3-T49 expired rate keys physically deleted');
select is((select count(*)::integer from private.checkout_issue_claims),0,'O3-T49 challenge claims physically deleted');
select is((select count(*)::integer from private.checkout_sessions),0,'O3-T49 receipt/session records physically deleted');
select is((select count(*)::integer from private.checkout_browser_contexts),0,'O3-T49 expired verifier hashes physically deleted');
select is((select count(*)::integer from public.orders),1,'O3-T49 cleanup preserves historical order');
select ok(not exists(select 1 from information_schema.columns where table_schema='private' and table_name like 'checkout_%' and column_name in('ip','address','email','phone','verifier','csrf','challenge','status_token','payment_token')),'O3-T49 protection schema has no raw request secret/PII column');
select * from finish();
rollback;
