-- Preserve confirmed provider captures if acceptance loses its authorized actor.
-- Existing test/live mode separation, leases, status history and refund retries remain intact.
do $patch$
declare
  body text;
  original text := $old$      perform private.transition_order_status(j.restaurant_id,j.location_id,j.order_id,'accepted',
        j.capture_actor,j.capture_assurance);$old$;
  replacement text := $new$      -- The original request was authorized, but access may have changed while
      -- Stripe was settling. Never roll back the independently confirmed capture.
      if private.dashboard_order_actor_role(j.restaurant_id,j.location_id,
          j.capture_actor,j.capture_assurance) is null then
        update public.online_payment_jobs
          set close_requested='cancelled',refund_state='requested' where id=j.id;
        perform private.close_online_order(j.order_id,'cancelled');
      else
        perform private.transition_order_status(j.restaurant_id,j.location_id,j.order_id,'accepted',
          j.capture_actor,j.capture_assurance);
      end if;$new$;
begin
  select pg_get_functiondef('private.sync_online_payment(uuid,uuid,text,text,text,text)'::regprocedure)
    into body;
  if (length(body)-length(replace(body,original,'')))/length(original) <> 1 then
    raise exception 'Unexpected manual capture acceptance definition';
  end if;
  execute replace(body,original,replacement);
end;
$patch$;
