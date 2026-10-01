alter table public.menu_versions add column edit_revision integer not null default 0 check(edit_revision>=0);

create table private.menu_choice_stops(
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null,location_id uuid not null,menu_id uuid not null,menu_item_id uuid not null,
 choice_id uuid, blocked boolean not null, ends_at timestamptz,reason text not null,
 actor_user_id uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(restaurant_id,location_id) references public.locations(restaurant_id,id),
 foreign key(restaurant_id,menu_id,menu_item_id) references public.menu_items(restaurant_id,menu_id,id),
 check(length(btrim(reason)) between 1 and 200),check(ends_at is null or ends_at>created_at));
create index menu_choice_stops_lookup on private.menu_choice_stops(restaurant_id,location_id,menu_id,menu_item_id,created_at desc);
alter table private.menu_choice_stops enable row level security;
revoke all on private.menu_choice_stops from public,anon,authenticated,service_role;
create trigger menu_choice_stops_immutable before update or delete on private.menu_choice_stops for each row execute function private.prevent_menu_history_mutation();
create function private.menu_choice_blocked(r uuid,l uuid,m uuid,i uuid,c uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce((select s.blocked and (s.ends_at is null or s.ends_at>clock_timestamp()) from private.menu_choice_stops s
 where s.restaurant_id=r and s.location_id=l and s.menu_id=m and s.menu_item_id=i and s.choice_id is not distinct from c order by s.created_at desc,s.id desc limit 1),false);
$$;
revoke all on function private.menu_choice_blocked(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

alter function private.price_menu_lines(uuid,uuid,uuid,uuid,jsonb) rename to price_menu_lines_without_stops;
create function private.price_menu_lines(r uuid,l uuid,m uuid,v uuid,lines jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare x jsonb;c text;begin
 for x in select value from jsonb_array_elements(private.canonical_menu_lines(lines)) loop
  if private.menu_choice_blocked(r,l,m,(x->>'menu_item_id')::uuid,null) then raise exception 'order contains unavailable menu items';end if;
  if x ? 'variant_id' and private.menu_choice_blocked(r,l,m,(x->>'menu_item_id')::uuid,(x->>'variant_id')::uuid) then raise exception 'invalid menu selection';end if;
  for c in select jsonb_array_elements_text(coalesce(x->'option_ids','[]')) loop
   if private.menu_choice_blocked(r,l,m,(x->>'menu_item_id')::uuid,c::uuid) then raise exception 'invalid menu selection';end if;
  end loop;
 end loop;
 return private.price_menu_lines_without_stops(r,l,m,v,lines);
end;$$;
revoke all on function private.price_menu_lines(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

alter function private.read_storefront_catalog(text,text) rename to read_storefront_catalog_without_stops;
create function private.read_storefront_catalog(rs text,ls text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;r uuid;l uuid;menus jsonb:='[]';sections jsonb;items jsonb;menu jsonb;section jsonb;item jsonb;cfg jsonb;variants jsonb;groups jsonb;g jsonb;options jsonb;choice jsonb;
begin
 result:=private.read_storefront_catalog_without_stops(rs,ls);if result is null then return null;end if;
 select a.id,b.id into r,l from public.restaurants a join public.locations b on b.restaurant_id=a.id where a.slug=rs and b.slug=ls;
 for menu in select value from jsonb_array_elements(result->'menus') loop sections:='[]';
  for section in select value from jsonb_array_elements(menu->'sections') loop items:='[]';
   for item in select value from jsonb_array_elements(section->'items') loop
    if private.menu_choice_blocked(r,l,(menu->>'id')::uuid,(item->>'id')::uuid,null) then item:=jsonb_set(item,'{availability}','"sold_out"');end if;
    cfg:=item->'configuration';
    if cfg is not null and cfg<>'null'::jsonb then variants:='[]';groups:='[]';
     for choice in select value from jsonb_array_elements(cfg->'variants') loop
      if private.menu_choice_blocked(r,l,(menu->>'id')::uuid,(item->>'id')::uuid,(choice->>'id')::uuid) then choice:=jsonb_set(choice,'{isActive}','false');end if;variants:=variants||jsonb_build_array(choice);
     end loop;
     for g in select value from jsonb_array_elements(cfg->'optionGroups') loop options:='[]';
      for choice in select value from jsonb_array_elements(g->'options') loop
       if private.menu_choice_blocked(r,l,(menu->>'id')::uuid,(item->>'id')::uuid,(choice->>'id')::uuid) then choice:=jsonb_set(choice,'{isActive}','false');end if;options:=options||jsonb_build_array(choice);
      end loop;groups:=groups||jsonb_build_array(jsonb_set(g,'{options}',options));
     end loop;cfg:=jsonb_set(jsonb_set(cfg,'{variants}',variants),'{optionGroups}',groups);if private.valid_menu_configuration(cfg) then item:=jsonb_set(item,'{configuration}',cfg);else item:=jsonb_set(item,'{availability}','"sold_out"');end if;
    end if;items:=items||jsonb_build_array(item);
   end loop;sections:=sections||jsonb_build_array(jsonb_set(section,'{items}',items));
  end loop;menus:=menus||jsonb_build_array(jsonb_set(menu,'{sections}',sections));
 end loop;return jsonb_set(result,'{menus}',menus);
end;$$;
revoke all on function private.read_storefront_catalog_without_stops(text,text) from public,anon,authenticated,service_role;
revoke all on function private.read_storefront_catalog(text,text) from public,anon,authenticated;
grant execute on function private.read_storefront_catalog(text,text) to service_role;

create function private.menu_dashboard(actor uuid,aal text,r uuid,l uuid,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m uuid;v uuid;revision integer;state text;x jsonb;sections jsonb;items jsonb;result jsonb;action text;effective timestamptz;i uuid;c uuid;config_revisions jsonb;
begin
 if aal is distinct from 'aal2' or not exists(select 1 from public.locations where restaurant_id=r and id=l) then return jsonb_build_object('outcome','forbidden');end if;
 begin perform private.assert_menu_actor(r,l,actor,aal);exception when raise_exception then return jsonb_build_object('outcome','forbidden');end;
 if command is not null then
  action:=command->>'action';m:=(command->>'menuId')::uuid;v:=(command->>'versionId')::uuid;
  if action='create_menu' then
   if (select count(*) from public.menus where restaurant_id=r)>=20 then return jsonb_build_object('outcome','invalid');end if;
   m:=private.create_menu(r,command->>'slug',command->>'name',actor,aal);
   perform private.create_menu_draft(r,m,null,actor,aal);
  elsif not exists(select 1 from public.menus where restaurant_id=r and id=m and status='active') then return jsonb_build_object('outcome','forbidden');
  elsif action='create_draft' then perform private.create_menu_draft(r,m,(command->>'sourceVersionId')::uuid,actor,aal);
  else
   perform pg_advisory_xact_lock(hashtextextended('menu-publication:'||r::text||':'||l::text||':'||m::text,0));
   select edit_revision,status into revision,state from public.menu_versions where restaurant_id=r and menu_id=m and id=v for update;
   if not found then return jsonb_build_object('outcome','forbidden');end if;
   if action in ('save_draft','publish','rollback') and revision is distinct from (command->>'expectedRevision')::integer then return jsonb_build_object('outcome','conflict');end if;
   if action='save_draft' then
    if state<>'draft' then return jsonb_build_object('outcome','conflict');end if;
    sections:=command->'sections';items:=command->'items';
    if jsonb_typeof(sections)<>'array' or jsonb_typeof(items)<>'array' or jsonb_array_length(sections) not between 1 and 20 or jsonb_array_length(items) not between 1 and 200 then return jsonb_build_object('outcome','invalid');end if;
    for x in select value from jsonb_array_elements(items) loop
     if x->'configuration'<>'null'::jsonb and not private.valid_menu_configuration(x->'configuration') then return jsonb_build_object('outcome','invalid');end if;
    end loop;
    select coalesce(jsonb_object_agg(menu_item_id::text,configuration_revision),'{}') into config_revisions from public.menu_version_items where restaurant_id=r and menu_id=m and menu_version_id=v;
    delete from public.menu_version_items where restaurant_id=r and menu_id=m and menu_version_id=v;
    delete from public.menu_version_sections where restaurant_id=r and menu_id=m and menu_version_id=v;
    insert into public.menu_version_sections(restaurant_id,menu_id,menu_version_id,section_key,display_name,sort_order)
     select r,m,v,value->>'key',value->>'name',ordinality::integer-1 from jsonb_array_elements(sections) with ordinality;
    for x in select value from jsonb_array_elements(items) loop
     i:=(x->>'id')::uuid;
     insert into public.menu_items(id,restaurant_id,menu_id,slug) values(i,r,m,'item-'||i::text) on conflict(restaurant_id,menu_id,id) do nothing;
    end loop;
    insert into public.menu_version_items(restaurant_id,menu_id,menu_version_id,menu_item_id,section_key,display_name,description,price_amount_minor,is_active,sort_order,configuration,configuration_revision)
     select r,m,v,(value->>'id')::uuid,value->>'sectionKey',value->>'name',value->>'description',(value->>'priceAmountMinor')::bigint,(value->>'isActive')::boolean,ordinality::integer-1,nullif(value->'configuration','null'::jsonb),coalesce((config_revisions->>lower(value->>'id'))::integer,0)+1 from jsonb_array_elements(items) with ordinality;
    update public.menu_versions set edit_revision=edit_revision+1 where restaurant_id=r and menu_id=m and id=v;
   elsif action in ('publish','rollback') then
    if (action='publish' and state<>'draft') or (action='rollback' and state<>'published') then return jsonb_build_object('outcome','conflict');end if;
    effective:=(command->>'effectiveAt')::timestamptz;
    if effective is null or not isfinite(effective) then return jsonb_build_object('outcome','invalid');end if;
    if action='publish' then
     if not exists(select 1 from public.menu_version_items where restaurant_id=r and menu_id=m and menu_version_id=v and is_active) or exists(select 1 from public.menu_version_items where restaurant_id=r and menu_id=m and menu_version_id=v and is_active and configuration is null) then return jsonb_build_object('outcome','invalid');end if;
     perform private.publish_menu_version(r,l,m,v,effective,actor,aal);
    else perform private.rollback_menu_version(r,l,m,v,effective,actor,aal);end if;
   elsif action='stop' then
    i:=(command->>'itemId')::uuid;c:=(command->>'choiceId')::uuid;
    select configuration into x from public.menu_version_items where restaurant_id=r and menu_id=m and menu_version_id=v and menu_item_id=i;
    if not found then return jsonb_build_object('outcome','forbidden');end if;
    if c is not null and not exists(
     select 1 from jsonb_array_elements(coalesce(x->'variants','[]')) choice where lower(choice->>'id')=c::text
     union all select 1 from jsonb_array_elements(coalesce(x->'optionGroups','[]')) g cross join lateral jsonb_array_elements(g->'options') choice where lower(choice->>'id')=c::text
    ) then return jsonb_build_object('outcome','invalid');end if;
    if command->>'endsAt' is not null and (not isfinite((command->>'endsAt')::timestamptz) or (command->>'endsAt')::timestamptz<=clock_timestamp()) then return jsonb_build_object('outcome','invalid');end if;
    insert into private.menu_choice_stops(restaurant_id,location_id,menu_id,menu_item_id,choice_id,blocked,ends_at,reason,actor_user_id)
     values(r,l,m,i,c,(command->>'blocked')::boolean,(command->>'endsAt')::timestamptz,command->>'reason',actor);
   else return jsonb_build_object('outcome','invalid');end if;
  end if;
  insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
   values(r,'menu',m,'menu.admin.changed',jsonb_build_object('location_id',l,'menu_version_id',v,'action',action,'actor_user_id',actor,'note',coalesce(command->>'note',command->>'reason'),'revision',revision),'menu-admin:'||gen_random_uuid()::text);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',menu.id,'name',regexp_replace(menu.display_name,'[[:cntrl:]]',' ','g'),'versions',(
  select coalesce(jsonb_agg(jsonb_build_object('id',version.id,'number',version.version_number,'status',version.status,'revision',version.edit_revision,'sections',(
   select coalesce(jsonb_agg(jsonb_build_object('key',s.section_key,'name',regexp_replace(s.display_name,'[[:cntrl:]]',' ','g')) order by s.sort_order,s.section_key),'[]') from public.menu_version_sections s where s.restaurant_id=r and s.menu_id=menu.id and s.menu_version_id=version.id),'items',(
   select coalesce(jsonb_agg(jsonb_build_object('id',i.menu_item_id,'sectionKey',i.section_key,'name',regexp_replace(i.display_name,'[[:cntrl:]]',' ','g'),'description',i.description,'priceAmountMinor',i.price_amount_minor,'isActive',i.is_active,'configuration',i.configuration) order by i.sort_order,i.menu_item_id),'[]') from public.menu_version_items i where i.restaurant_id=r and i.menu_id=menu.id and i.menu_version_id=version.id)) order by version.version_number desc),'[]')
   from (select * from public.menu_versions where restaurant_id=r and menu_id=menu.id order by version_number desc limit 50) version),
 'publications',(select coalesce(jsonb_agg(jsonb_build_object('versionId',p.menu_version_id,'effectiveAt',p.effective_at) order by p.effective_at desc),'[]') from (select * from public.menu_publications where restaurant_id=r and location_id=l and menu_id=menu.id order by effective_at desc limit 100) p)
 ) order by menu.display_name),'[]') into result from public.menus menu where menu.restaurant_id=r and menu.status='active';
 return jsonb_build_object('outcome','allowed','data',jsonb_build_object('timezone',(select timezone from public.locations where restaurant_id=r and id=l),'menus',result,'stops',(
 select coalesce(jsonb_agg(jsonb_build_object('menuId',s.menu_id,'itemId',s.menu_item_id,'choiceId',s.choice_id,'blocked',s.blocked,'endsAt',s.ends_at,'reason',s.reason)),'[]')
 from (select * from (select distinct on(menu_id,menu_item_id,choice_id) * from private.menu_choice_stops where restaurant_id=r and location_id=l order by menu_id,menu_item_id,choice_id,created_at desc,id desc) recent order by created_at desc limit 500) s)));
end;$$;
revoke all on function private.menu_dashboard(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.menu_dashboard(uuid,text,uuid,uuid,jsonb) to service_role;

-- Decorate the authorized minimal order projection using immutable historical snapshots.
alter function private.read_dashboard_order(uuid,text,uuid,uuid,uuid) rename to read_dashboard_order_without_selection;
create function private.read_dashboard_order(actor uuid,aal text,r uuid,l uuid,o uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;lines jsonb;line jsonb;snapshot jsonb;
begin
 result:=private.read_dashboard_order_without_selection(actor,aal,r,l,o);
 if result->>'outcome'<>'allowed' then return result;end if;
 lines:='[]';
 for line in select value from jsonb_array_elements(result->'data'->'lines') loop
  select i.selection_snapshot into snapshot from public.order_lines i where i.restaurant_id=r and i.order_id=o and i.line_number=(line->>'lineNumber')::integer;
  lines:=lines||jsonb_build_array(line||jsonb_build_object('selectionSnapshot',snapshot));
 end loop;
 return jsonb_set(result,'{data,lines}',lines);
end;$$;
revoke all on function private.read_dashboard_order_without_selection(uuid,text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.read_dashboard_order(uuid,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.read_dashboard_order(uuid,text,uuid,uuid,uuid) to service_role;
