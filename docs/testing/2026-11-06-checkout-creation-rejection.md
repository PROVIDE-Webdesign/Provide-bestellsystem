# Conclusive Checkout creation rejection

A failed Stripe parameter validation must not leave an unbound order in New. Checkout creation
already omits payment_method_types. This change additionally classifies only known, non-retryable
HTTP 400 parameter errors on session POSTs, with a valid provider request ID. Unknown replies,
timeouts, 5xx, idempotency, rate-limit and lock errors preserve the existing uncertain/retry flow.

A private service-only database routine validates the active lease, mode, unbound job, unattempted
online payment, zero captured/refunded amounts, and current submitted order. It records the observed
failed HTTP request using the existing payment event routines, closes the order through the existing
domain routine, releases capacity, and stops scheduling. An existing requested reject is preserved.
No raw error message or provider secret is stored or exposed. This event is not represented as an
incoming Stripe webhook.

Apply the new additive migration before releasing the matching API. Existing Checkout sessions,
authorizations, captures, refunds and manual-review jobs must remain reconcilable; no
missing-session timeout may auto-close them.

Checks: API unit suite, typecheck, lint, format, dry-run build, SQL suite, native creation-rejection
matrix and existing storefront/payment integration. Native provider replies are doubles; PostgreSQL
and authorization grants are real. No live funds or external provider writes are used.

The currently deployed API version has not been retrieved: Cloudflare CLI is unauthenticated and the
browser remains at sign-in. This branch is a tested release candidate, not evidence of an online
fix. Do not deploy the whole integrated branch over an older schema without verifying its migration
level, current worker bindings and source. No GitHub Actions, push or deployment.
