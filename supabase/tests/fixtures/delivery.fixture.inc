/* Apply after storefront.fixture.inc in an isolated database only. */ insert into
public.restaurant_feature_flags(restaurant_id,feature_key,enabled)
values('f2000000-0000-0000-0000-000000000001','fulfillment.delivery',true); insert into
public.availability_schedule_versions
(id,restaurant_id,location_id,version_number,minimum_lead_minutes,maximum_advance_days,
slot_interval_minutes,default_order_capacity,default_item_capacity,created_by_user_id)
values('fb800000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',
'f3000000-0000-0000-0000-000000000001',2,15,14,15,1,100,'f1000000-0000-0000-0000-000000000001');
insert into
public.availability_windows(restaurant_id,location_id,schedule_version_id,fulfillment_type,weekday,opens_at,closes_at)
select 'f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
'fb800000-0000-0000-0000-000000000001',kind,weekday,'00:00:00'::time,'23:59:59'::time from
generate_series(0,6) weekday cross join (values('pickup'),('delivery')) kinds(kind); update
public.availability_schedule_versions set status='published',published_at=now(),
published_by_user_id='f1000000-0000-0000-0000-000000000001' where
id='fb800000-0000-0000-0000-000000000001'; insert into
public.availability_publications(restaurant_id,location_id,schedule_version_id,effective_at,actor_user_id,authentication_assurance)
values('f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
'fb800000-0000-0000-0000-000000000001',now()+interval '1
millisecond','f1000000-0000-0000-0000-000000000001','aal2');
