-- Send only a health signal outside the system, without identifiers or job data.
create function private.support_jobs_need_attention(target_restaurant uuid, webhook_activation timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.restaurants where id=target_restaurant) or
    exists(select 1 from private.support_sources where restaurant_id=target_restaurant and is_problem) or
    exists(select 1 from private.support_partial_refunds f join public.online_payment_jobs j on j.id=f.job_id
      where j.restaurant_id=target_restaurant and (f.state='review' or
        (f.state in ('queued','pending') and f.next_at<statement_timestamp()-interval '10 minutes'))) or
    (webhook_activation is not null and exists(select 1 from public.outbox_events e
      where e.restaurant_id=target_restaurant and e.created_at>=webhook_activation and e.event_version=1
        and e.event_type in ('order.submitted','order.status_changed','payment.status_changed','menu.version.published')
        and (e.status='dead_letter' or (e.status in ('pending','processing','retry')
          and e.available_at<statement_timestamp()-interval '10 minutes'))))
$$;
revoke all on function private.support_jobs_need_attention(uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.support_jobs_need_attention(uuid,timestamptz) to service_role;
