# Block 5 - scoped background order push

Enable the existing common product push modules in preview, without enabling live payments or mail
dispatch. Hosted order_web_push migration was applied as 20261107013139; SQL body is unchanged.
Bindings preserve all existing configuration; the public/private VAPID pair stays outside the
repository. API and dashboard both need DASHBOARD_ORDER_PUSH_ENABLED=true. A device subscribes
through the normal authenticated dashboard for one selected location.

Acceptance requires a real device notification with the dashboard closed, for a normal order and a
manual card authorization before acceptance. Push-provider acceptance is not a displayed-device
receipt. The event window is two minutes, encrypted payload contains only the event key. Existing
owner, MFA, location, lease, retry and logout guards remain mandatory. Phone guest acceptance for
Block 4 was explicitly deferred by the user.
