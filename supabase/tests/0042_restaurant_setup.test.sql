begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select no_plan();
\ir fixtures/storefront.fixture.inc
insert into private.provide_admin_grants(user_id) values('f1000000-0000-0000-0000-000000000001');
insert into private.provide_admin_grants(user_id,restaurant_id) values('f1000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000001');
create function pg_temp.setup(q jsonb, actor uuid default 'f1000000-0000-0000-0000-000000000001',aal text default 'aal2') returns jsonb language sql as $$
 select private.command_provide_administration(actor,aal,
 jsonb_build_object('restaurantId','f2000000-0000-0000-0000-000000000003','locationId',null,'expectedRevision',coalesce((select revision from private.provide_admin_revisions where restaurant_id='f2000000-0000-0000-0000-000000000003'),0),'requestId',gen_random_uuid(),'reason','Synthetic setup evidence')||q,false);
$$;
select is(pg_temp.setup('{"action":"createRestaurant","displayName":"Zweite Pilotküche","slug":"second-pilot","timezone":"Europe/Berlin"}')->>'outcome','allowed','create another restaurant through the existing audited command');
select is(pg_temp.setup('{"action":"createLocation","locationId":"f3000000-0000-0000-0000-000000000003","displayName":"Zweiter Standort","slug":"second-location","timezone":"Europe/Berlin"}')->>'outcome','allowed','create location without changing shop code');
create temporary table setup_address(q jsonb);
insert into setup_address values('{"action":"locationAddress","locationId":"f3000000-0000-0000-0000-000000000003","address":{"addressLine1":"Testweg 2","addressLine2":null,"postalCode":"52062","city":"Aachen","countryCode":"DE"}}');
select is(pg_temp.setup((select q from setup_address))->>'outcome','allowed','store complete address through the audited setup command');
select is((select address_line_1 from public.locations where id='f3000000-0000-0000-0000-000000000003'),'Testweg 2','address is persisted');
select is((select address_line_1 from public.locations where id='f3000000-0000-0000-0000-000000000001'),'Testweg 1','first restaurant remains unchanged');
select is(pg_temp.setup((select q from setup_address),'f1000000-0000-0000-0000-000000000002')->>'outcome','forbidden','restaurant-scoped administrator cannot write another restaurant');
select is(pg_temp.setup((select q from setup_address),'f1000000-0000-0000-0000-000000000001','aal1')->>'outcome','forbidden','address write still requires MFA');
select is(pg_temp.setup(jsonb_set((select q from setup_address),'{address,city}','null'))->>'outcome','invalid','database rejects malformed address independently of TypeScript');
select is(private.read_provide_administration('f1000000-0000-0000-0000-000000000001','aal2','{"restaurantId":"f2000000-0000-0000-0000-000000000003","locationId":"f3000000-0000-0000-0000-000000000003"}')->'data'->'selected'->'address'->>'city','Aachen','saved address is readable for editing');
select is((select go_live_status from public.location_activation_states where location_id='f3000000-0000-0000-0000-000000000003'),'blocked','address alone never enables orders');
create temporary table setup_owner(q jsonb);
insert into setup_owner values('{"action":"firstOwner","ownerUserId":"f1000000-0000-0000-0000-000000000005","confirmation":"second-pilot"}');
select is(pg_temp.setup((select q from setup_owner),'f1000000-0000-0000-0000-000000000002')->>'outcome','forbidden','tenant grant cannot bootstrap ownership elsewhere');
select is(pg_temp.setup((select q from setup_owner))->>'outcome','conflict','unverified email blocks assignment');
update auth.users set email_confirmed_at=now() where id='f1000000-0000-0000-0000-000000000005';
update auth.mfa_factors set status='unverified' where user_id='f1000000-0000-0000-0000-000000000005';
select is(pg_temp.setup((select q from setup_owner))->>'outcome','conflict','missing verified MFA blocks assignment');
update auth.mfa_factors set status='verified' where user_id='f1000000-0000-0000-0000-000000000005';
select is(pg_temp.setup(jsonb_set((select q from setup_owner),'{confirmation}','"wrong-restaurant"'))->>'outcome','invalid','restaurant confirmation is mandatory');
update auth.users set banned_until=now()+interval '1 hour' where id='f1000000-0000-0000-0000-000000000005';
select is(pg_temp.setup((select q from setup_owner))->>'outcome','conflict','banned target cannot receive ownership');
update auth.users set banned_until=null where id='f1000000-0000-0000-0000-000000000005';
create temporary table owner_retry as select (select q from setup_owner)||jsonb_build_object('restaurantId','f2000000-0000-0000-0000-000000000003','locationId',null,'expectedRevision',(select revision from private.provide_admin_revisions where restaurant_id='f2000000-0000-0000-0000-000000000003'),'requestId',gen_random_uuid(),'reason','Synthetic initial owner assignment') as q;
select is(private.command_provide_administration('f1000000-0000-0000-0000-000000000001','aal2',(select q from owner_retry),false)->>'outcome','allowed','global administrator can explicitly assign the verified first owner');
select is(private.command_provide_administration('f1000000-0000-0000-0000-000000000001','aal2',(select q from owner_retry),false)->>'outcome','allowed','same request is safely replayable');
select is((select count(*)::integer from public.restaurant_memberships where restaurant_id='f2000000-0000-0000-0000-000000000003'),1,'replay creates no duplicate membership');
select is((select role from public.restaurant_memberships where restaurant_id='f2000000-0000-0000-0000-000000000003'),'owner','correct restaurant receives owner role');
select is((select count(*)::integer from private.personnel_audit where restaurant_id='f2000000-0000-0000-0000-000000000003' and action='bootstrap.owner'),1,'ownership is audited exactly once');
select is(pg_temp.setup((select q from setup_owner))->>'outcome','conflict','subsequent assignments use normal personnel administration');
select is((select count(*)::integer from private.provide_admin_grants where user_id='f1000000-0000-0000-0000-000000000005'),0,'owner receives no platform administration grant');
select is((select go_live_status from public.restaurant_activation_states where restaurant_id='f2000000-0000-0000-0000-000000000003'),'blocked','owner assignment does not enable live operation');
-- An address correction to an already active fixture must reopen its gate.
select is(pg_temp.setup((select q from setup_address)||'{"restaurantId":"f2000000-0000-0000-0000-000000000001","locationId":"f3000000-0000-0000-0000-000000000001","expectedRevision":0}'::jsonb||jsonb_build_object('expectedRevision',(select revision from private.provide_admin_revisions where restaurant_id='f2000000-0000-0000-0000-000000000001')))->>'outcome','allowed','address correction uses existing authenticated command');
select is((select go_live_status from public.location_activation_states where location_id='f3000000-0000-0000-0000-000000000001'),'blocked','address change reopens the live location gate');
select * from finish();
rollback;
