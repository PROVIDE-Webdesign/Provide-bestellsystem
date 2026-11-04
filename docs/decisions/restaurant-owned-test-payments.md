# Restaurant-owned test payments

Date: 2026-11-02. Status: implemented locally; provider acceptance and preview release pending.

The user confirmed that each restaurant receives its own payments and PROVIDE supplies the reusable
shop. The selected PROVIDE Stripe test account is `acct_1UVcoLF2o0zlG99u` (display name
`New business`). This is a test context, not permission to process live money or accept financial
agreements.

Use hosted Stripe Checkout Sessions and restaurant-owned direct charges through Connect. Create new
merchant accounts with Accounts v2. The proposed simple account configuration is a full Stripe
Dashboard with Stripe collecting processing fees and assuming negative-balance responsibility;
validate and confirm the actual configuration during Connect setup. No application fee or commission
is introduced by this change. Commercial pricing remains undecided.

## Routing and immutable history

The backend supplies the configured platform account. Guest requests cannot select the payee. A
private, operator-managed mapping selects one test merchant per restaurant. A merchant cannot be
assigned concurrently to two restaurants or reassigned to another restaurant after it has payment
history. Mappings are audited and expire within seven days. Browser and service roles cannot edit
them.

New orders require an enabled, unexpired mapping. Each job stores the platform and merchant
accounts. Job identity is immutable. Mapping changes, disablement and expiry affect new orders;
existing receipts, reconciliation and refunds retain the original job accounts. Existing
single-account jobs are backfilled with their existing account as their platform origin, preserving
their original meaning.

Every provider operation uses the job's merchant account via `Stripe-Account`. Account checks
independently verify the key's platform identity and the merchant identity. Legacy platform-owned
jobs retain requests without a connected-account header. Provider requests pin Stripe API version
`2026-09-30.endive`. The existing raw HTTP adapter is retained, avoiding an unrelated SDK rewrite.

## Payment evidence and deadlines

Signed events are stored by merchant account plus event ID, with object ID, payload hash, provider
time and an explicit success-evidence flag. Completed Checkout with `payment_status=unpaid` is not
payment evidence. `checkout.session.async_payment_succeeded` and
`checkout.session.async_payment_failed` wake reconciliation. The provider's current session and
PaymentIntent remain the payment source of truth.

An unpaid completed session cannot extend the local ten-minute reservation indefinitely. At expiry,
close the local reservation; a subsequent capture triggers compensation and never revives the
cancelled order. Confirmed timely success can still be reconciled after its deadline. Historical
`payment_intent.succeeded` receipts are unambiguous and backfilled; historical Checkout receipts
without a known payment status remain unknown rather than being guessed as paid.

## Deliberate boundaries

Production and live keys remain rejected. Runtime payment flags remain off. The existing
synthetic-location gate still rejects online payment; a separately reviewed, explicit test-only
opt-in is required before the second preview restaurant can exercise Stripe. No production
onboarding approval is fabricated.

Local HTTP tests use payment adapters. They do not prove real Stripe onboarding, event delivery,
card authentication, payee balances or refunds. Those require the provider acceptance matrix in the
runbook.

References: https://docs.stripe.com/connect/direct-charges and
https://docs.stripe.com/api/v2/core/accounts/create.
