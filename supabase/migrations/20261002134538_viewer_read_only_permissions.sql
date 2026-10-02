-- A3: explicit read-only projections. Existing write actors and raw-table RLS stay unchanged.
alter table public.restaurant_memberships drop constraint restaurant_memberships_role_allowed;
alter table public.restaurant_memberships add constraint restaurant_memberships_role_allowed
 check(role in ('owner','manager','kitchen','driver','viewer'));
alter table public.restaurant_invitations drop constraint restaurant_invitations_role_allowed;
alter table public.restaurant_invitations add constraint restaurant_invitations_role_allowed
 check(role in ('owner','manager','kitchen','driver','viewer'));
alter table private.personnel_dispatches drop constraint personnel_dispatches_role_check;
alter table private.personnel_dispatches add constraint personnel_dispatches_role_check
 check(role in ('owner','manager','kitchen','driver','viewer'));

-- Deliberately separate from dashboard_order_actor_role: readers never become write actors.
create function private.dashboard_order_reader_role(r uuid,l uuid,actor uuid,aal text)
returns text language sql stable security definer set search_path='' as $$
 select m.role from public.restaurant_memberships m
 join auth.users u on u.id=m.user_id
 join public.locations site on site.restaurant_id=m.restaurant_id and site.id=l
 where m.restaurant_id=r and m.user_id=actor and m.status='active'
 and (u.banned_until is null or u.banned_until<=statement_timestamp())
 and (
  (m.role='viewer' and aal in ('aal1','aal2') and exists(
   select 1 from public.restaurant_membership_locations a
   where a.restaurant_id=r and a.user_id=actor and a.location_id=l))
  or (m.role in ('owner','manager','kitchen') and
   private.dashboard_order_actor_role(r,l,actor,aal)=m.role)
 )
$$;
revoke all on function private.dashboard_order_reader_role(uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;
comment on function private.dashboard_order_reader_role(uuid,uuid,uuid,text) is
 'Internal explicit read capability; current tenant/site assignment, active membership and verified AAL. Not a write actor.';

create or replace function private.dashboard_order_allowed_transitions(current_status text, actor_role text)
returns jsonb language sql immutable set search_path='' as $$
 select case
 when actor_role is null or actor_role not in ('owner','manager','kitchen') then '[]'::jsonb
 when current_status='submitted' and actor_role='kitchen' then '["accepted"]'::jsonb
 when current_status='submitted' then '["accepted","rejected","cancelled"]'::jsonb
 when current_status='accepted' and actor_role='kitchen' then '["preparing"]'::jsonb
 when current_status='accepted' then '["preparing","cancelled"]'::jsonb
 when current_status='preparing' and actor_role='kitchen' then '["ready"]'::jsonb
 when current_status='preparing' then '["ready","cancelled"]'::jsonb
 when current_status='ready' and actor_role in ('owner','manager') then '["completed"]'::jsonb
 else '[]'::jsonb end
$$;

create or replace function private.personnel_scope_allowed(r uuid,actor uuid,target_role text,locs uuid[]) returns boolean language sql stable security definer set search_path='' as $$
 select target_role in ('owner','manager','kitchen','driver','viewer') and locs is not null
 and cardinality(locs)<=50 and not exists(select 1 from unnest(locs) x where x is null)
 and cardinality(locs)=(select count(distinct x) from unnest(locs) x)
 and not exists(select 1 from unnest(locs) x where not exists(select 1 from public.locations l where l.restaurant_id=r and l.id=x))
 and ((select role from public.restaurant_memberships where restaurant_id=r and user_id=actor and status='active')='owner'
 or (target_role in ('kitchen','driver') and not exists(select 1 from unnest(locs) x where not exists(
 select 1 from public.restaurant_membership_locations a where a.restaurant_id=r and a.user_id=actor and a.location_id=x))))
$$;

create or replace function private.read_dashboard_access_context(
  target_actor_user_id uuid,
  target_authentication_assurance text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  memberships jsonb;
begin
  if target_actor_user_id is null
    or target_authentication_assurance not in ('aal1', 'aal2')
  then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'restaurantId', membership.restaurant_id,
        'role', membership.role,
        'status', membership.status,
        'access', case
          when membership.status = 'suspended' then 'suspended'
          when membership.role in ('owner', 'manager')
            and target_authentication_assurance <> 'aal2' then 'mfa_required'
          else 'allowed'
        end,
        'restaurant', case
          when membership.status = 'active'
            and (
              membership.role in ('kitchen', 'driver', 'viewer')
              or target_authentication_assurance = 'aal2'
            )
          then jsonb_build_object(
            'slug', restaurant.slug,
            'displayName', left(btrim(restaurant.display_name), 160)
          )
          else 'null'::jsonb
        end,
        'locations', case
          when membership.status = 'active'
            and (
              membership.role in ('kitchen', 'driver', 'viewer')
              or target_authentication_assurance = 'aal2'
            )
          then coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id', location.id,
                  'slug', location.slug,
                  'displayName', left(btrim(location.display_name), 160)
                )
                order by location.display_name, location.id
              )
              from public.locations as location
              where location.restaurant_id = membership.restaurant_id
                and (
                  membership.role = 'owner'
                  or exists (
                    select 1
                    from public.restaurant_membership_locations as assignment
                    where assignment.restaurant_id = membership.restaurant_id
                      and assignment.user_id = membership.user_id
                      and assignment.location_id = location.id
                  )
                )
            ),
            '[]'::jsonb
          )
          else '[]'::jsonb
        end
      )
      order by membership.restaurant_id
    ),
    '[]'::jsonb
  )
  into memberships
  from public.restaurant_memberships as membership
  join public.restaurants as restaurant on restaurant.id = membership.restaurant_id
  where membership.user_id = target_actor_user_id;

  return jsonb_build_object(
    'aal', target_authentication_assurance,
    'memberships', memberships
  );
end;
$$;

create or replace function private.read_dashboard_orders(
  target_actor_user_id uuid,
  target_authentication_assurance text,
  target_restaurant_id uuid,
  target_location_id uuid,
  target_status text default null,
  cursor_requested_for timestamptz default null,
  cursor_order_id uuid default null,
  page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text;
  order_rows jsonb;
  next_cursor text;
begin
  if page_size not between 1 and 50
    or (target_status is not null and target_status not in (
      'submitted', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled'
    ))
    or ((cursor_requested_for is null) <> (cursor_order_id is null))
  then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  actor_role := private.dashboard_order_reader_role(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );
  if actor_role is null then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  with selected as (
    select
      order_record.*,
      payment.collection_mode,
      row_number() over (order by order_record.requested_for, order_record.id) as row_number
    from public.orders as order_record
    join public.order_payments as payment
      on payment.restaurant_id = order_record.restaurant_id
      and payment.location_id = order_record.location_id
      and payment.order_id = order_record.id
    where order_record.restaurant_id = target_restaurant_id
      and order_record.location_id = target_location_id
      and order_record.fulfillment_type in ('pickup','delivery')
      and payment.collection_mode in ('on_fulfillment','online')
      and (target_status is null or order_record.status = target_status)
      and (
        cursor_requested_for is null
        or (order_record.requested_for, order_record.id) > (cursor_requested_for, cursor_order_id)
      )
    order by order_record.requested_for, order_record.id
    limit page_size + 1
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'orderId', selected.id,
          'status', selected.status,
          'fulfillmentType', selected.fulfillment_type,
          'paymentCollectionMode', selected.collection_mode,
          'paymentState', case when actor_role in ('owner','manager') then private.online_payment_view(selected.id) else null end,
          'requestedFor', to_char(
            selected.requested_for at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'currency', selected.currency_code,
          'totalAmountMinor', selected.total_amount_minor,
          'itemCount', selected.item_count,
          'updatedAt', to_char(
            selected.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'allowedTransitions', case when exists(select 1 from public.online_payment_jobs j join public.order_payments p on p.order_id=j.order_id where j.order_id=selected.id and (j.close_requested is not null or p.status<>'captured')) then case when actor_role in ('owner','manager') and selected.status='submitted' then '["rejected","cancelled"]'::jsonb else '[]'::jsonb end else private.dashboard_order_allowed_transitions(selected.status, actor_role) end
        )
        order by selected.requested_for, selected.id
      ) filter (where selected.row_number <= page_size),
      '[]'::jsonb
    ),
    case when count(*) > page_size then (
      select to_char(
        cursor_row.requested_for at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) || '|' || cursor_row.id::text
      from selected as cursor_row
      where cursor_row.row_number = page_size
    ) end
  into order_rows, next_cursor
  from selected;

  return jsonb_build_object(
    'outcome', 'allowed',
    'data', jsonb_build_object(
      'restaurantId', target_restaurant_id,
      'locationId', target_location_id,
      'orders', order_rows,
      'nextCursor', next_cursor
    )
  );
end;
$$;

create or replace function private.read_dashboard_fulfillment_orders(
  target_actor_user_id uuid,
  target_authentication_assurance text,
  target_restaurant_id uuid,
  target_location_id uuid,
  target_status text default null,
  cursor_requested_for timestamptz default null,
  cursor_order_id uuid default null,
  page_size integer default 25,
  target_fulfillment text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text;
  order_rows jsonb;
  next_cursor text;
begin
  if (target_fulfillment is not null and target_fulfillment not in ('pickup','delivery')) or page_size not between 1 and 50
    or (target_status is not null and target_status not in (
      'submitted', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled'
    ))
    or ((cursor_requested_for is null) <> (cursor_order_id is null))
  then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  actor_role := private.dashboard_order_reader_role(
    target_restaurant_id,
    target_location_id,
    target_actor_user_id,
    target_authentication_assurance
  );
  if actor_role is null then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  with selected as (
    select
      order_record.*,
      payment.collection_mode,
      row_number() over (order by order_record.requested_for, order_record.id) as row_number
    from public.orders as order_record
    join public.order_payments as payment
      on payment.restaurant_id = order_record.restaurant_id
      and payment.location_id = order_record.location_id
      and payment.order_id = order_record.id
    where order_record.restaurant_id = target_restaurant_id
      and order_record.location_id = target_location_id
      and order_record.fulfillment_type in ('pickup','delivery')
      and payment.collection_mode in ('on_fulfillment','online')
      and (target_fulfillment is null or order_record.fulfillment_type=target_fulfillment)
      and (target_status is null or order_record.status = target_status)
      and (
        cursor_requested_for is null
        or (order_record.requested_for, order_record.id) > (cursor_requested_for, cursor_order_id)
      )
    order by order_record.requested_for, order_record.id
    limit page_size + 1
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'orderId', selected.id,
          'status', selected.status,
          'fulfillmentType', selected.fulfillment_type,
          'paymentCollectionMode', selected.collection_mode,
          'paymentState', case when actor_role in ('owner','manager') then private.online_payment_view(selected.id) else null end,
          'requestedFor', to_char(
            selected.requested_for at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'currency', selected.currency_code,
          'totalAmountMinor', selected.total_amount_minor,
          'itemCount', selected.item_count,
          'updatedAt', to_char(
            selected.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'allowedTransitions', case when exists(select 1 from public.online_payment_jobs j join public.order_payments p on p.order_id=j.order_id where j.order_id=selected.id and (j.close_requested is not null or p.status<>'captured')) then case when actor_role in ('owner','manager') and selected.status='submitted' then '["rejected","cancelled"]'::jsonb else '[]'::jsonb end else private.dashboard_order_allowed_transitions(selected.status, actor_role) end
        )
        order by selected.requested_for, selected.id
      ) filter (where selected.row_number <= page_size),
      '[]'::jsonb
    ),
    case when count(*) > page_size then (
      select to_char(
        cursor_row.requested_for at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) || '|' || cursor_row.id::text
      from selected as cursor_row
      where cursor_row.row_number = page_size
    ) end
  into order_rows, next_cursor
  from selected;

  return jsonb_build_object(
    'outcome', 'allowed',
    'data', jsonb_build_object(
      'restaurantId', target_restaurant_id,
      'locationId', target_location_id,
      'orders', order_rows,
      'nextCursor', next_cursor
    )
  );
end;
$$;

create or replace function private.read_dashboard_orders_by_number(
  actor uuid, aal text, restaurant uuid, location uuid, status_filter text,
  cursor_time timestamptz, cursor_id uuid, page_size integer, fulfillment text, target_number bigint
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare target uuid; detail jsonb; summary jsonb; rows jsonb := '[]'::jsonb;
begin
  if target_number is null then
    return private.read_dashboard_fulfillment_orders(actor,aal,restaurant,location,status_filter,cursor_time,cursor_id,page_size,fulfillment);
  end if;
  if target_number < 1 or page_size is null or page_size not between 1 and 50
    or (fulfillment is not null and fulfillment not in ('pickup','delivery'))
    or (status_filter is not null and status_filter not in ('submitted','accepted','preparing','ready','completed','rejected','cancelled'))
    or ((cursor_time is null) <> (cursor_id is null)) then
    return jsonb_build_object('outcome','invalid');
  end if;
  if private.dashboard_order_reader_role(restaurant,location,actor,aal) is null then
    return jsonb_build_object('outcome','forbidden');
  end if;
  select o.id into target from public.orders o
    where o.restaurant_id=restaurant and o.location_id=location and o.order_number=target_number
      and (fulfillment is null or o.fulfillment_type=fulfillment)
      and (status_filter is null or o.status=status_filter)
      and (cursor_time is null or (o.requested_for,o.id)>(cursor_time,cursor_id));
  if target is not null then
    detail := private.read_dashboard_order(actor,aal,restaurant,location,target);
    if detail->>'outcome'='allowed' then
      select jsonb_object_agg(field.key,field.value) into summary from jsonb_each(detail->'data') as field(key,value)
        where field.key in ('orderId','status','fulfillmentType','paymentCollectionMode','paymentState',
          'requestedFor','currency','totalAmountMinor','itemCount','updatedAt','allowedTransitions');
      rows := jsonb_build_array(summary);
    end if;
  end if;
  return jsonb_build_object('outcome','allowed','data',jsonb_build_object(
    'restaurantId',restaurant,'locationId',location,'orders',rows,'nextCursor',null));
end;
$$;

create or replace function private.dashboard_order_topic_allowed(target_topic text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare parts text[];
begin
  if auth.uid() is null then return false; end if;
  parts := regexp_match(target_topic,
    '^orders:v1:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$');
  if parts is null then return false; end if;
  return exists(select 1 from public.locations l where l.restaurant_id=parts[1]::uuid and l.id=parts[2]::uuid)
    and private.dashboard_order_reader_role(parts[1]::uuid,parts[2]::uuid,auth.uid(),auth.jwt()->>'aal') is not null;
end;
$$;

create or replace function private.read_dashboard_acceptance(target_actor uuid,target_aal text,target_restaurant uuid,target_location uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pending jsonb; total integer;
begin
  if private.dashboard_order_reader_role(target_restaurant,target_location,target_actor,target_aal) is null
    or not exists(select 1 from public.locations where id=target_location and restaurant_id=target_restaurant)
    then return jsonb_build_object('outcome','forbidden'); end if;
  select count(*) into total from private.order_acceptance_alerts a
    where a.restaurant_id=target_restaurant and a.location_id=target_location and a.resolved_at is null
    and private.order_acceptance_eligible(a.order_id);
  select coalesce(jsonb_agg(row_data order by deadline,order_id),'[]'::jsonb) into pending from (
    select a.deadline,a.order_id,jsonb_build_object('orderId',a.order_id,'orderNumber',private.format_order_number(o.order_number),
      'fulfillmentType',o.fulfillment_type,'deadline',to_char(a.deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'escalatedAt',to_char(a.escalated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as row_data
    from private.order_acceptance_alerts a join public.orders o on o.id=a.order_id
    where a.restaurant_id=target_restaurant and a.location_id=target_location and a.resolved_at is null
      and private.order_acceptance_eligible(a.order_id)
    order by a.deadline,a.order_id limit 100
  ) selected;
  return jsonb_build_object('outcome','allowed','data',jsonb_build_object('restaurantId',target_restaurant,'locationId',target_location,
    'serverNow',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'timeoutRule','manual_review','totalPending',total,'orders',pending));
end;
$$;

-- Preserve every existing enrichment and management/kitchen projection unchanged.
alter function private.read_dashboard_order(uuid,text,uuid,uuid,uuid) rename to read_dashboard_order_before_viewer;
create function private.read_dashboard_order(actor uuid,aal text,r uuid,l uuid,o uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare reader text; data jsonb;
begin
 reader:=private.dashboard_order_reader_role(r,l,actor,aal);
 if reader is null then return jsonb_build_object('outcome','forbidden');end if;
 if reader<>'viewer' then return private.read_dashboard_order_before_viewer(actor,aal,r,l,o);end if;
 -- Allowlist, not a full row minus a denylist. No joins to customer/delivery/communication data.
 select jsonb_build_object(
 'orderId',ord.id,'restaurantId',r,'locationId',l,'status',ord.status,
 'fulfillmentType',ord.fulfillment_type,'paymentCollectionMode',p.collection_mode,'paymentState',null,
 'requestedFor',to_char(ord.requested_for at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'updatedAt',to_char(ord.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'currency',ord.currency_code,'totalAmountMinor',ord.total_amount_minor,'itemCount',ord.item_count,
 'allowedTransitions','[]'::jsonb,'contactName',null,'delivery',null,
 'deliveryFeeAmountMinor',ord.delivery_fee_amount_minor,'taxSummary',ord.tax_summary,
 'lines',coalesce((select jsonb_agg(jsonb_build_object(
  'lineNumber',line.line_number,'displayName',btrim(line.display_name),'quantity',line.quantity,
  'unitPriceAmountMinor',line.unit_price_amount_minor,'lineAmountMinor',line.line_amount_minor,
  'selectionSnapshot',line.selection_snapshot) order by line.line_number)
  from public.order_lines line where line.restaurant_id=r and line.location_id=l and line.order_id=ord.id),'[]'::jsonb))
 into data from public.orders ord join public.order_payments p
 on p.restaurant_id=ord.restaurant_id and p.location_id=ord.location_id and p.order_id=ord.id
 where ord.restaurant_id=r and ord.location_id=l and ord.id=o
 and ord.fulfillment_type in ('pickup','delivery') and p.collection_mode in ('on_fulfillment','online');
 if data is null then return jsonb_build_object('outcome','not_found');end if;
 return jsonb_build_object('outcome','allowed','data',data);
end;$$;
revoke all on function private.read_dashboard_order_before_viewer(uuid,text,uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
revoke all on function private.read_dashboard_order(uuid,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.read_dashboard_order(uuid,text,uuid,uuid,uuid) to service_role;
