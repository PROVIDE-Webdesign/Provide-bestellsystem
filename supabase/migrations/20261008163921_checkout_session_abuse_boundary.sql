-- O3: private, server-authorized browser context; no anonymous Auth identity.
create table private.checkout_browser_contexts (
  verifier_hash text primary key check (verifier_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  purge_at timestamptz not null
);
create index checkout_browser_purge on private.checkout_browser_contexts(purge_at);
create table private.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  verifier_hash text not null references private.checkout_browser_contexts(verifier_hash) on delete cascade,
  restaurant_id uuid not null,
  location_id uuid not null,
  submission_key text not null check (submission_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  created_at timestamptz not null default clock_timestamp(),
  write_expires_at timestamptz not null,
  receipt_expires_at timestamptz not null,
  purge_at timestamptz not null,
  revoked_at timestamptz,
  payload_hmac text check (payload_hmac ~ '^[A-Za-z0-9_-]{43}$'),
  order_id uuid references public.orders(id) on delete restrict,
  mode text check (mode in ('orders','delivery-orders','online-orders')),
  receipt jsonb,
  foreign key (restaurant_id,location_id) references public.locations(restaurant_id,id) on delete restrict,
  unique (restaurant_id,location_id,submission_key),
  check (write_expires_at=created_at+interval '30 minutes'),
  check (receipt_expires_at=created_at+interval '90 minutes'),
  check ((order_id is null and payload_hmac is null and receipt is null and mode is null) or
         (order_id is not null and payload_hmac is not null and receipt is not null and mode is not null))
);
create index checkout_session_context on private.checkout_sessions(verifier_hash,restaurant_id,location_id,receipt_expires_at);
create index checkout_session_purge on private.checkout_sessions(purge_at);
create table private.checkout_issue_claims (
  challenge_hash text primary key check (challenge_hash ~ '^[a-f0-9]{64}$'),
  issue_id uuid not null unique,
  binding_hmac text not null check (binding_hmac ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz not null default clock_timestamp()+interval '5 minutes',
  purge_at timestamptz not null default clock_timestamp()+interval '15 minutes',
  outcome text not null default 'pending' check (outcome in ('pending','rejected','issued')),
  session_id uuid references private.checkout_sessions(id) on delete cascade
);
create index checkout_issue_purge on private.checkout_issue_claims(purge_at);
create table private.checkout_gateway_nonces (
  nonce uuid primary key,
  expires_at timestamptz not null,
  purge_at timestamptz not null
);
create index checkout_nonce_purge on private.checkout_gateway_nonces(purge_at);
create table private.checkout_rate_buckets (
  bucket_key text primary key check (char_length(bucket_key) between 1 and 160),
  capacity integer not null check (capacity between 1 and 600),
  period_seconds integer not null check (period_seconds in (60,600)),
  tokens numeric not null check (tokens >= 0),
  updated_at timestamptz not null,
  purge_at timestamptz not null
);
create index checkout_rate_purge on private.checkout_rate_buckets(purge_at);
alter table private.checkout_browser_contexts enable row level security;
alter table private.checkout_sessions enable row level security;
alter table private.checkout_issue_claims enable row level security;
alter table private.checkout_gateway_nonces enable row level security;
alter table private.checkout_rate_buckets enable row level security;
revoke all on private.checkout_browser_contexts,private.checkout_sessions,private.checkout_issue_claims,
  private.checkout_gateway_nonces,private.checkout_rate_buckets from public,anon,authenticated,service_role;

create function private.checkout_intent(s private.checkout_sessions) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('sessionId',s.id,'submissionKey',s.submission_key,
   'writeExpiresAt',to_char(s.write_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'receiptExpiresAt',to_char(s.receipt_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;
-- Database time, per-key row locking and sorted locks work across Worker instances.
-- Nonce and rate decision commit separately from the order transaction: a rejected attempt
-- cannot reset an abuse budget by rolling back the business operation.
create function private.checkout_guard(n uuid,issued_at timestamptz,budgets jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t timestamptz:=clock_timestamp(); b jsonb; k text; cap integer; period integer;
  current private.checkout_rate_buckets; available numeric; retry integer:=0; keys text[]:='{}';
begin
 if n is null or issued_at is null or issued_at>t+interval '2 seconds' or issued_at<t-interval '30 seconds' or
    jsonb_typeof(budgets)<>'array' or jsonb_array_length(budgets) not between 1 and 5 then
   return jsonb_build_object('outcome','forbidden');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('o3-nonce-capacity',0));
 if (select count(*) from(select 1 from private.checkout_gateway_nonces limit 100000)x)>=100000 then return jsonb_build_object('outcome','unavailable');end if;
 insert into private.checkout_gateway_nonces values(n,issued_at+interval '30 seconds',issued_at+interval '10 minutes 30 seconds') on conflict do nothing;
 if not found then return jsonb_build_object('outcome','forbidden');end if;
 -- Acquire capacity lock BEFORE any bucket row lock, preventing lock-order inversion.
 if exists(select 1 from jsonb_array_elements(budgets) as candidate(value) where not exists(select 1 from private.checkout_rate_buckets r where r.bucket_key=candidate.value->>'key')) then
   perform pg_advisory_xact_lock(hashtextextended('o3-rate-capacity',0));
 end if;
 for b in select value from jsonb_array_elements(budgets) order by value->>'key' loop
   k:=b->>'key'; cap:=(b->>'capacity')::integer; period:=(b->>'period')::integer;
   if k is null or char_length(k) not between 1 and 160 or cap not between 1 and 600 or period not in (60,600) or k=any(keys) then
     raise exception using errcode='22023',message='Invalid checkout rate profile';
   end if;
   keys:=array_append(keys,k);
   if not exists(select 1 from private.checkout_rate_buckets where bucket_key=k) then
     if not exists(select 1 from private.checkout_rate_buckets where bucket_key=k) and
        (select count(*) from (select 1 from private.checkout_rate_buckets limit 100000) x)>=100000 then
       return jsonb_build_object('outcome','unavailable');
     end if;
     insert into private.checkout_rate_buckets values(k,cap,period,cap,t,t+make_interval(secs=>period+600)) on conflict do nothing;
   end if;
   select * into current from private.checkout_rate_buckets where bucket_key=k for update;
   t:=clock_timestamp();
   if current.capacity<>cap or current.period_seconds<>period then raise exception 'Inconsistent checkout rate profile';end if;
   available:=least(cap::numeric,current.tokens+greatest(0,extract(epoch from(t-current.updated_at)))*cap/period);
   update private.checkout_rate_buckets set tokens=available,updated_at=t,purge_at=t+make_interval(secs=>period+600) where bucket_key=k;
   if available<1 then retry:=greatest(retry,ceil((1-available)*period/cap)::integer);end if;
 end loop;
 if retry>0 then return jsonb_build_object('outcome','limited','retryAfter',retry);end if;
 update private.checkout_rate_buckets set tokens=tokens-1 where bucket_key=any(keys);
 return jsonb_build_object('outcome','allowed');
end;
$$;
create function private.checkout_context(h text,create_new boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t timestamptz:=clock_timestamp(); c private.checkout_browser_contexts;
begin
 if h is null or h!~'^[a-f0-9]{64}$' then return jsonb_build_object('outcome','forbidden');end if;
 select * into c from private.checkout_browser_contexts where verifier_hash=h for update;
 t:=clock_timestamp();
 if found then
   if c.expires_at<=t then return jsonb_build_object('outcome','expired');end if;
 else
   if create_new is not true then return jsonb_build_object('outcome','forbidden');end if;
   perform pg_advisory_xact_lock(hashtextextended('o3-context-capacity',0));
   if (select count(*) from(select 1 from private.checkout_browser_contexts limit 10000)x)>=10000 then return jsonb_build_object('outcome','unavailable');end if;
   insert into private.checkout_browser_contexts values(h,t,t+interval '90 minutes',t+interval '25 hours 25 minutes');
 end if;
 return jsonb_build_object('outcome','allowed','contextExpiresAt',to_char((select expires_at from private.checkout_browser_contexts where verifier_hash=h) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;
create function private.checkout_issue_begin(ch text,i uuid,binding text,h text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.checkout_issue_claims; t timestamptz:=clock_timestamp(); s private.checkout_sessions;
begin
 if not exists(select 1 from private.checkout_browser_contexts where verifier_hash=h and expires_at>t) then return jsonb_build_object('outcome','expired');end if;
 -- Bound issuance state independently, including attempts with invalid provider tokens.
 perform pg_advisory_xact_lock(hashtextextended('o3-issue-capacity',0));
 if not exists(select 1 from private.checkout_issue_claims where challenge_hash=ch or issue_id=i) and
    (select count(*) from(select 1 from private.checkout_issue_claims limit 100000)x)>=100000 then return jsonb_build_object('outcome','unavailable');end if;
 insert into private.checkout_issue_claims(challenge_hash,issue_id,binding_hmac) values(ch,i,binding) on conflict do nothing;
 select * into c from private.checkout_issue_claims where challenge_hash=ch for update;
 t:=clock_timestamp();
 if not exists(select 1 from private.checkout_browser_contexts where verifier_hash=h and expires_at>t) then return jsonb_build_object('outcome','expired');end if;
 if c.challenge_hash is null or c.issue_id<>i or c.binding_hmac<>binding or c.expires_at<=t or c.outcome='rejected' then return jsonb_build_object('outcome','forbidden');end if;
 if c.outcome='issued' then
   select * into s from private.checkout_sessions where id=c.session_id and verifier_hash=h;
   if s.id is null or s.receipt_expires_at<=t then return jsonb_build_object('outcome','expired');end if;
   return jsonb_build_object('outcome','issued','intent',private.checkout_intent(s));
 end if;
 return jsonb_build_object('outcome','pending');
end;
$$;
create function private.checkout_issue_finish(ch text,i uuid,binding text,h text,rs text,ls text,submission text,renew uuid,verified boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.checkout_issue_claims;s private.checkout_sessions; old private.checkout_sessions;
  r uuid;l uuid;t timestamptz:=clock_timestamp();
begin
 -- Shared order: browser -> session -> claim, also used by submit/renew.
 perform 1 from private.checkout_browser_contexts where verifier_hash=h and expires_at>t for update;
 if not found then return jsonb_build_object('outcome','expired');end if;
 select a.id,b.id into r,l from public.restaurants a join public.locations b on b.restaurant_id=a.id where a.slug=rs and b.slug=ls;
 if l is null then return jsonb_build_object('outcome','forbidden');end if;
 if renew is not null then
   select * into old from private.checkout_sessions where id=renew and verifier_hash=h and restaurant_id=r and location_id=l for update;
 end if;
 select * into c from private.checkout_issue_claims where challenge_hash=ch for update;
 t:=clock_timestamp();
 if c.challenge_hash is null or c.issue_id<>i or c.binding_hmac<>binding or c.expires_at<=t or c.outcome='rejected' then return jsonb_build_object('outcome','forbidden');end if;
 if c.outcome='issued' then
   select * into s from private.checkout_sessions where id=c.session_id;
   return jsonb_build_object('outcome','issued','intent',private.checkout_intent(s));
 end if;
 if renew is not null and (old.id is null or old.order_id is not null or old.revoked_at is not null or old.receipt_expires_at<=t) then return jsonb_build_object('outcome','conflict');end if;
 if verified is not true then
   update private.checkout_issue_claims set outcome='rejected' where challenge_hash=ch;
   return jsonb_build_object('outcome','forbidden');
 end if;
 if submission is null or submission!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' or
   exists(select 1 from private.checkout_sessions where restaurant_id=r and location_id=l and submission_key=submission) or
   exists(select 1 from public.orders where restaurant_id=r and location_id=l and submission_key=submission) then return jsonb_build_object('outcome','conflict');end if;
 if (select count(*) from private.checkout_sessions where verifier_hash=h and restaurant_id=r and location_id=l and receipt_expires_at>t and order_id is null and revoked_at is null and id is distinct from renew)>=3 then return jsonb_build_object('outcome','conflict');end if;
 perform pg_advisory_xact_lock(hashtextextended('o3-session-capacity',0));
 if (select count(*) from(select 1 from private.checkout_sessions limit 10000)x)>=10000 then return jsonb_build_object('outcome','unavailable');end if;
 if renew is not null then update private.checkout_sessions set revoked_at=t where id=renew;end if;
 insert into private.checkout_sessions(verifier_hash,restaurant_id,location_id,submission_key,created_at,write_expires_at,receipt_expires_at,purge_at)
 values(h,r,l,submission,t,t+interval '30 minutes',t+interval '90 minutes',t+interval '25 hours 25 minutes') returning * into s;
 update private.checkout_browser_contexts set expires_at=t+interval '90 minutes',purge_at=t+interval '25 hours 25 minutes' where verifier_hash=h;
 update private.checkout_issue_claims set outcome='issued',session_id=s.id where challenge_hash=ch;
 return jsonb_build_object('outcome','issued','intent',private.checkout_intent(s));
end;
$$;
create function private.checkout_receipt(h text,sid uuid,rs text,ls text,submission text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.checkout_sessions;t timestamptz:=clock_timestamp();
begin
 select c.* into s from private.checkout_sessions c join public.restaurants r on r.id=c.restaurant_id join public.locations l on l.id=c.location_id
 join private.checkout_browser_contexts b on b.verifier_hash=c.verifier_hash
 where c.id=sid and c.verifier_hash=h and c.submission_key=submission and r.slug=rs and l.slug=ls and b.expires_at>t;
 if not found then return jsonb_build_object('outcome','forbidden');end if;
 if s.receipt_expires_at<=t then return jsonb_build_object('outcome','expired');end if;
 if s.order_id is not null then return jsonb_build_object('outcome','committed','mode',s.mode,'receipt',s.receipt,'fingerprint',s.payload_hmac);end if;
 return jsonb_build_object('outcome',case when s.revoked_at is not null then 'expired' else 'unsubmitted' end,'writeExpired',s.write_expires_at<=t);
end;
$$;
-- Domain validation/slot claim/outbox/payment job and receipt bind in ONE transaction.
create function private.checkout_submit(h text,sid uuid,rs text,ls text,kind text,fingerprint text,cmd jsonb,retention integer,account text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.checkout_sessions;t timestamptz:=clock_timestamp();result jsonb;
begin
 perform 1 from private.checkout_browser_contexts where verifier_hash=h and expires_at>t for update;
 if not found then raise exception using errcode='P0001',message='Checkout context unavailable';end if;
 select c.* into s from private.checkout_sessions c join public.restaurants r on r.id=c.restaurant_id join public.locations l on l.id=c.location_id
 where c.id=sid and c.verifier_hash=h and r.slug=rs and l.slug=ls for update of c;
 t:=clock_timestamp();
 if not exists(select 1 from private.checkout_browser_contexts where verifier_hash=h and expires_at>t) then raise exception using errcode='P0001',message='Checkout context expired';end if;
 if s.id is null or s.submission_key is distinct from cmd->>'submissionKey' or s.receipt_expires_at<=t or fingerprint is null or fingerprint!~'^[A-Za-z0-9_-]{43}$' then raise exception using errcode='P0001',message='Checkout intent unavailable';end if;
 if s.order_id is not null then
   if s.payload_hmac<>fingerprint or s.mode<>kind then raise exception using errcode='P0001',message='Checkout payload conflict';end if;
   return s.receipt;
 end if;
 if s.revoked_at is not null or s.write_expires_at<=t then raise exception using errcode='P0001',message='Checkout session expired';end if;
 -- Never adopt a legacy/other session's order by guessing an existing submission key.
 if exists(select 1 from public.orders where restaurant_id=s.restaurant_id and location_id=s.location_id and submission_key=s.submission_key) then raise exception using errcode='P0001',message='Checkout key already used';end if;
 if kind='orders' then
   result:=private.submit_public_guest_pickup_order(rs,ls,(cmd->>'menuId')::uuid,(cmd->>'menuVersionId')::uuid,(cmd->>'requestedFor')::timestamptz,cmd->'lines',s.submission_key,cmd->'customer',cmd->>'privacyNoticeVersion',retention);
 elsif kind='delivery-orders' then
   result:=private.submit_public_guest_delivery_order(rs,ls,(cmd->>'menuId')::uuid,(cmd->>'menuVersionId')::uuid,(cmd->>'requestedFor')::timestamptz,cmd->'lines',s.submission_key,cmd->'customer',cmd->'delivery',cmd->'expectedQuote',cmd->>'privacyNoticeVersion',retention);
 elsif kind='online-orders' then
   result:=private.submit_public_guest_online_order(rs,ls,(cmd->>'menuId')::uuid,(cmd->>'menuVersionId')::uuid,(cmd->>'requestedFor')::timestamptz,cmd->'lines',s.submission_key,cmd->'customer',cmd->>'fulfillmentType',cmd->'delivery',cmd->'expectedQuote',cmd->>'privacyNoticeVersion',retention,account);
 else raise exception using errcode='22023',message='Invalid checkout mode';end if;
 result:=private.attach_order_number(result);
 update private.checkout_sessions set payload_hmac=fingerprint,order_id=(result->>'orderId')::uuid,mode=kind,receipt=result where id=s.id;
 return result;
end;
$$;
-- Bounded physical deletion; retained orders/snapshots/support/payment history are untouched.
create function private.checkout_cleanup(batch integer default 500) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t timestamptz:=clock_timestamp();n integer;total integer:=0;
begin
 if batch not between 1 and 1000 then raise exception using errcode='22023',message='Invalid checkout cleanup batch';end if;
 delete from private.checkout_issue_claims where challenge_hash in(select challenge_hash from private.checkout_issue_claims where purge_at<=t order by purge_at limit batch for update skip locked);get diagnostics n=row_count;total:=total+n;
 delete from private.checkout_gateway_nonces where nonce in(select nonce from private.checkout_gateway_nonces where purge_at<=t order by purge_at limit batch for update skip locked);get diagnostics n=row_count;total:=total+n;
 delete from private.checkout_rate_buckets where bucket_key in(select bucket_key from private.checkout_rate_buckets where purge_at<=t order by purge_at limit batch for update skip locked);get diagnostics n=row_count;total:=total+n;
 delete from private.checkout_sessions where id in(select id from private.checkout_sessions where purge_at<=t order by purge_at limit batch for update skip locked);get diagnostics n=row_count;total:=total+n;
 delete from private.checkout_browser_contexts where verifier_hash in(select verifier_hash from private.checkout_browser_contexts b where purge_at<=t and not exists(select 1 from private.checkout_sessions s where s.verifier_hash=b.verifier_hash) order by purge_at limit batch for update skip locked);get diagnostics n=row_count;total:=total+n;
 return jsonb_build_object('deleted',total);
end;
$$;
-- Default function EXECUTE on PUBLIC must never grant entry into a SECURITY DEFINER boundary.
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'checkout\_%' escape '\' loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
   if f.signature::text not like 'private.checkout_intent(%' then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
