-- A schedule announcement is not a publication. Only emit when the scheduled
-- publication is the effective menu selected by the storefront resolver.
create function private.claim_domain_webhooks_with_activations(
  target_restaurant uuid, activation timestamptz, token uuid
) returns setof public.outbox_events
language plpgsql security definer set search_path='' as $$
declare checked_at timestamptz:=statement_timestamp();
begin
  if target_restaurant is null or activation is null or not isfinite(activation) or token is null
  then raise exception 'invalid domain webhook claim'; end if;

  insert into public.outbox_events(restaurant_id,aggregate_type,aggregate_id,event_type,payload,
    idempotency_key,created_at,available_at)
  select p.restaurant_id,'menu',p.menu_id,'menu.version.published',
    jsonb_build_object('publication_id',p.id,'location_id',p.location_id,
      'menu_version_id',p.menu_version_id,'effective_at',p.effective_at),
    'menu-activation:'||p.id::text,p.effective_at,checked_at
  from public.menu_publications p
  join public.outbox_events schedule on schedule.restaurant_id=p.restaurant_id
    and schedule.idempotency_key='menu-publication:'||p.id::text
    and schedule.event_type='menu.version.scheduled' and schedule.event_version=1
  where p.restaurant_id=target_restaurant and p.effective_at between activation and checked_at
    and private.resolve_public_menu_version(p.restaurant_id,p.location_id,p.menu_id,checked_at)=p.menu_version_id
    and not exists(select 1 from public.menu_publications newer
      where newer.restaurant_id=p.restaurant_id and newer.location_id=p.location_id
        and newer.menu_id=p.menu_id and newer.effective_at>p.effective_at and newer.effective_at<=checked_at)
    and not exists(select 1 from public.outbox_events emitted where emitted.restaurant_id=p.restaurant_id
      and emitted.idempotency_key='menu-activation:'||p.id::text)
  order by p.effective_at,p.id limit 25
  on conflict(restaurant_id,idempotency_key) do nothing;

  return query select * from private.domain_webhook_claim(target_restaurant,activation,token);
end $$;
revoke all on function private.claim_domain_webhooks_with_activations(uuid,timestamptz,uuid)
  from public,anon,authenticated;
grant execute on function private.claim_domain_webhooks_with_activations(uuid,timestamptz,uuid) to service_role;
