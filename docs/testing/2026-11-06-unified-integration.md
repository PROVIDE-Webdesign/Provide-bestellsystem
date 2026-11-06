# Unified product candidate - 6 November 2026

This combines the approved shop, website cart, operator layout 3, menu S1 and settings E1 from
`6514e10ecba67e580cbbf03d0664be92a9e95dac` with payment, refund polling, manual acceptance and
background-push changes from `8a7556db3f54fdc4a96f57d8b4a500407ce3febd`. The latter contains release
`b35ec509b2486ad63abe4a3979140b4112b71473` and live-payment adapter
`af416d52864ef208d62660c7c7d508a215ce4f74`; management `704d01b` is in the shop parent.

## Integration decisions

- Keep the selected dark shop, local favorites, current/previous guest orders, website-cart import
  and the new management navigation. Pass the push flag through the actual new shell.
- Keep the backend, contracts and all 57 migrations byte-identical to the alerts parent. No hosted
  database or provider configuration is changed by this integration.
- Preserve server-price validation, production readiness/privacy gates, manual capture and
  refund-pending polling. Hide the preview-only test footer in production mode.
- Validate restored website-cart JSON as an unknown value before inspecting its fields.
- Release the menu request lock on cleanup so the automatic load survives StrictMode remounts.
- Close menu tools after a command, keeping mobile editor controls reachable.
- Preserve typed linting for deployed code. Standalone design fixtures keep recommended syntax rules
  without pretending to belong to the application's TypeScript project.

Restored pending checkout attempts now open the cart before receipt recovery, so feedback and its
focus target remain visible. A committed receipt still opens the order status. The refund poller
checks settled terminal state before issuing another read, and binds that check to the current order
identity.

## Reproducible checks

Use the pinned Node 24 / pnpm 11 and frozen lockfile. Build contracts before standalone native
tests. Run format, typed lint, typecheck, unit tests and all application builds. Run the 47 SQL test
files, security advisors and 19 real local PostgreSQL/Auth/Realtime integration tests. Use a fresh
isolated local database for each HTTP checkout and website-handoff fixture family. Native component
tests run in Chromium, Firefox and WebKit at 1440/390 px. They operate the actual category
navigation, configuration dialogs, cart/order tabs and management panels. Each Vite harness has its
own cache directory; production CSS and frame context are included. The new shell/push regression
additionally covers owner, disabled flag, viewer and denied notification permission. Its permission
and API transport are synthetic; it sends no notification.

The version-bound result, exact final commit/tree, timestamps, raw checks and visual comparison are
recorded separately under `/srv/provide-bs-integration-evidence-20261106` and in the dated project
protocol. Earlier failed attempts remain historical, rather than being reported as passes.

## Scope and remaining gates

This is a local integration candidate, not a deployment or live-money acceptance. A2-3-6,
A2-4-1/7/8/9, A2-5-1/3, A2-6-1/2/3/4, A2-7-3/4/5/6 and A2-8-1/2 are affected; their overall
completion scores are not changed by integration alone. Production, actual closed-app device
notifications, order #19, the missing BS24 guest proof and deferred order-email proof retain their
separate status. The protected Asian Kitchen source remains byte-identical.
