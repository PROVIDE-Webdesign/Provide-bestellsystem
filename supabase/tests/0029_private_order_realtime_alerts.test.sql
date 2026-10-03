begin;

-- Disposable pgTAP fixture only: materialize a provider-shaped session for old role/scope tests.
-- New A4 tests deliberately omit/revoke these rows to exercise the strict product gate.
create function pg_temp.fixture_claims(value text, local_only boolean) returns text
language plpgsql security definer set search_path='' as $$
declare c jsonb := value::jsonb; u uuid; a text; sid uuid;
begin
  u := coalesce(c->>'sub',nullif(current_setting('request.jwt.claim.sub',true),''))::uuid;
  a := coalesce(c->>'aal','aal1');
  if u is not null and exists(select 1 from auth.users where id=u) and a in ('aal1','aal2') then
    sid := case when a='aal2' then u else md5(u::text||'aal1')::uuid end;
    if a='aal2' then
      insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
      values(u,u,'Synthetic test only','totp','verified','SYNTHETICTEST',now(),now()) on conflict(id) do nothing;
    end if;
    insert into auth.sessions(id,user_id,created_at,updated_at,aal,factor_id)
    values(sid,u,clock_timestamp(),clock_timestamp(),a::auth.aal_level,case when a='aal2' then u else null end)
    on conflict(id) do nothing;
    c := c || jsonb_build_object('session_id',sid);
  end if;
  return set_config('request.jwt.claims',c::text,local_only);
end $$;


select plan(32);
\ir fixtures/storefront.fixture.inc

select ok(not has_function_privilege('anon','private.dashboard_order_topic_allowed(text)','EXECUTE'),'anonymous cannot inspect channel authorization');
select ok(has_function_privilege('authenticated','private.dashboard_order_topic_allowed(text)','EXECUTE'),'authenticated helper checks its own JWT subject');
select ok(not has_function_privilege('authenticated','private.invalidate_dashboard_orders(uuid,uuid)','EXECUTE'),'browser cannot forge invalidations');
select ok(not has_function_privilege('authenticated','private.escalate_order_acceptance(integer)','EXECUTE'),'browser cannot forge escalation');
select ok(not has_table_privilege('authenticated','private.order_acceptance_events','SELECT'),'audit has no direct browser projection');
select ok(exists(select 1 from pg_policy where polrelid='realtime.messages'::regclass and polname='dashboard_orders_private_receive' and polcmd='r'),'receive-only private broadcast policy exists');
select is(private.dashboard_order_topic_allowed('orders:v1:invalid:invalid'),false,'invalid scope fails closed');
select pg_temp.fixture_claims('{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
select is(private.dashboard_order_topic_allowed('orders:v1:f2000000-0000-0000-0000-000000000001:f3000000-0000-0000-0000-000000000001'),false,'owner needs MFA for channel');
select pg_temp.fixture_claims('{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is(private.dashboard_order_topic_allowed('orders:v1:f2000000-0000-0000-0000-000000000001:f3000000-0000-0000-0000-000000000001'),true,'owner with MFA can join own scope');
select is(private.dashboard_order_topic_allowed('orders:v1:f2000000-0000-0000-0000-000000000002:f3000000-0000-0000-0000-000000000002'),false,'foreign tenant cannot join');
select is(private.dashboard_order_topic_allowed('orders:v1:f2000000-0000-0000-0000-000000000001:f3000000-0000-0000-0000-000000000002'),false,'foreign location under own tenant cannot join');
select pg_temp.fixture_claims('{"sub":"f1000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}',true);
select is(private.dashboard_order_topic_allowed('orders:v1:f2000000-0000-0000-0000-000000000001:f3000000-0000-0000-0000-000000000001'),true,'assigned kitchen can join at aal1');
update public.restaurant_memberships set status='suspended' where user_id='f1000000-0000-0000-0000-000000000003';
select is(private.dashboard_order_topic_allowed('orders:v1:f2000000-0000-0000-0000-000000000001:f3000000-0000-0000-0000-000000000001'),false,'revoked membership fails fresh authorization');
select pg_temp.fixture_claims('{"sub":"f1000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is(private.dashboard_order_topic_allowed('orders:v1:f2000000-0000-0000-0000-000000000001:f3000000-0000-0000-0000-000000000001'),false,'driver cannot join operational scope');

select private.submit_public_guest_pickup_order('storefront-restaurant-a','storefront-a-mitte',
 'f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',date_trunc('hour',now())+interval '4 hours',
 '[{"menu_item_id":"f6000000-0000-0000-0000-000000000001","quantity":1}]','acceptance-synthetic-001',
 '{"contact_name":"Synthetic","phone_e164":"+999100000045","email":"synthetic@example.invalid"}','preview-v1',30) as submitted \gset
select (:'submitted'::jsonb->>'orderId') as order_id \gset
select is((select count(*)::integer from private.order_acceptance_alerts where order_id=:'order_id'),1,'cash checkout starts exactly one acceptance clock');
select is((select deadline-started_at from private.order_acceptance_alerts where order_id=:'order_id'),interval '5 minutes','acceptance clock is five minutes');
select is((select count(*)::integer from private.order_acceptance_events where order_id=:'order_id' and kind='started'),1,'start is audited');
select is(private.escalate_order_acceptance(100),0,'unexpired order does not escalate');
select private.read_dashboard_acceptance('f1000000-0000-0000-0000-000000000001','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001') as inbox \gset
select is(:'inbox'::jsonb#>>'{data,totalPending}','1','inbox includes actionable order independent of list filters');
select ok(not ((:'inbox'::jsonb#>'{data,orders,0}') ?| array['contactName','phoneE164','email','delivery','totalAmountMinor']),'inbox is PII-minimized');
select is(private.read_dashboard_acceptance('f1000000-0000-0000-0000-000000000001','aal1','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001')->>'outcome','forbidden','inbox needs owner MFA');
select is(private.read_dashboard_acceptance('f1000000-0000-0000-0000-000000000006','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001')->>'outcome','forbidden','unassigned manager cannot read inbox');
-- Synthetic clock shift in disposable transaction only; there is no application deadline-edit RPC.
update private.order_acceptance_alerts set started_at=now()-interval '10 minutes',deadline=now()-interval '5 minutes' where order_id=:'order_id';
select is(private.escalate_order_acceptance(100),1,'due order escalates');
select is(private.escalate_order_acceptance(100),0,'repeat job has no duplicate effect');
select is((select count(*)::integer from private.order_acceptance_events where order_id=:'order_id' and kind='escalated'),1,'one escalation audit');
select is((select status from public.orders where id=:'order_id'),'submitted','timeout never auto-rejects');
select is((select timeout_rule from private.order_acceptance_events where order_id=:'order_id' and kind='escalated'),'manual_review','manual timeout rule is audited');
select throws_ok('delete from private.order_acceptance_events','P0001','acceptance audit is append-only','audit cannot be deleted');
select private.transition_dashboard_order_with_reason('f1000000-0000-0000-0000-000000000001','aal2',
 'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',:'order_id','submitted','accepted',null);
select ok((select resolved_at is not null from private.order_acceptance_alerts where order_id=:'order_id'),'acceptance resolves alert atomically');
select is((select count(*)::integer from private.order_acceptance_events where order_id=:'order_id' and kind='resolved'),1,'resolution is audited once');
select is(private.read_dashboard_acceptance('f1000000-0000-0000-0000-000000000001','aal2','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001')#>>'{data,totalPending}','0','accepted order no longer alarms');
select ok(not has_function_privilege('authenticated','private.read_dashboard_acceptance(uuid,text,uuid,uuid)','EXECUTE'),'inbox stays verified-API-only');
select * from finish();
rollback;
