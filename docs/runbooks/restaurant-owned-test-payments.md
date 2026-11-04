# Restaurant-owned payment acceptance

This supplements the historical single-account sandbox runbook and decision 0026. Current account
routing follows `docs/decisions/restaurant-owned-test-payments.md`.

## Current checkpoint

E148 configured the user-approved PROVIDE-Webdesign Sandbox, two synthetic merchant accounts, a
restricted test key and the Connect webhook. E149 adds a tested, explicit synthetic-location payment
opt-in and checks Accounts v2 card capability before creating a Checkout session. All 3,177 SQL
assertions, 265 API unit tests and ten local HTTP integration tests pass; 19 environment-dependent
unit entries are skipped. The Accounts v2 read permission is prepared but Stripe requires email
verification to save it. The database tool confirmation expired twice: neither pending migration has
been applied, and no application deployment or test payment activation has occurred. Online payment
flags remain false. These local tests are not actual Stripe payment, refund, or webhook-delivery
acceptance.

## Complete configuration as one bundle

1. Confirm/activate Connect for the selected test context. Use a separate sandbox when supported
   without breaking existing dependencies. Create two fictional restaurant merchant accounts using
   Accounts v2, not legacy account `type` values. Use only Stripe's test identities. Do not accept
   real merchant agreements or invent actual business details.
2. Verify each account's merchant capability and current payment readiness. Confirm the proposed
   full Dashboard / Stripe fees / Stripe negative-balance configuration supports direct charges for
   the chosen country. Record test account IDs and capability status, never private keys.
3. Provision a restricted test key with the permissions required for account reads, connected
   Checkout Sessions creation/read/expiry, PaymentIntent reads and full refunds. Store it directly
   in the server or worker secret store. It must never enter chat, source control, browser-public
   configuration, reports or screenshots.
4. Configure a Connect event destination for
   `https://provide-bs-api-preview.alpaysey.workers.dev/v1/payments/stripe/webhook`. Subscribe to
   the nine supported events listed below. Store its signing secret securely, independently from the
   payment-access capability secret. Pin and verify the payload/API version.
5. Before release, inspect the actual database schema and pending jobs, apply the tested migration,
   then provision the restaurant mappings. Keep existing platform origins for historical jobs. An
   unknown historical Checkout payment status requires review; it must not be silently backfilled as
   paid.
6. Mapping configuration is privileged database maintenance. Insert the exact restaurant UUID,
   platform ID, merchant ID, `enabled=true`, a reason and an expiry within seven days into
   `private.restaurant_test_payment_accounts`. Verify the merchant belongs to that restaurant. The
   audit trigger records the change. Disablement or expiry must not strand existing refunds.
7. Prepare a narrow, explicit test-only online-payment opt-in for synthetic preview locations. The
   E144 gate intentionally still blocks online payment. Do not fake production go-live, remove the
   gate globally or activate delivery to work around it.
8. Deploy the API and shop together using a fresh runtime snapshot that preserves unrelated
   bindings, flags and secrets. First verify the secrets, test mode, return origin, uncached
   Hyperdrive and periodic processing. Then enable only the required test flags. Keep live payment
   and production flags closed. Disable new orders first during a rollback, preserving
   reconciliation for outstanding jobs.

Supported events: `checkout.session.completed`, `checkout.session.expired`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`payment_intent.succeeded`, `payment_intent.payment_failed`, `refund.created`, `refund.updated`,
`refund.failed`.

## Provider acceptance matrix

| Case                                        | Required result                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Restaurant A and B                          | Each Checkout Session, payment and refund belongs to its own merchant account; no platform transfer or application fee is introduced. |
| Successful pickup payment                   | Exact server total; restaurant cannot accept before verified capture; guest and dashboard show the same paid order.                   |
| Declined payment, then retry                | No paid order on decline; retry retains one order and one logical payment.                                                            |
| Authentication required                     | Stripe test authentication succeeds or fails as selected; a return URL alone never marks an order paid.                               |
| Browser cancellation                        | Returning to the shop does not falsely cancel a payment or mark it paid; reservation closes through verified provider state/deadline. |
| Lost creation/response and duplicate submit | Stable provider idempotency key, one job and one order; recovery retains its original merchant.                                       |
| Duplicate and out-of-order signed events    | Durable idempotent receipt; changed duplicate rejected; current verified provider state wins.                                         |
| Unpaid completed session                    | Never treated as payment success; local capacity released at its deadline.                                                            |
| Timely success, delayed reconciliation      | Order remains payable when signed success evidence proves payment before expiry.                                                      |
| Late asynchronous success                   | Cancelled order stays cancelled and full refund is requested on its original merchant.                                                |
| Provider timeout / missing event            | No guessed success, expiry or refund; periodic reconciliation recovers or holds for manual review.                                    |
| Restaurant rejects paid order               | Exactly one full refund; guest remains pending until the provider confirms its result.                                                |
| Failed or uncertain refund                  | No duplicate speculative refund; an explicit audited retry is allowed only after confirmed failure.                                   |
| Changed/disabled/expired mapping            | New orders close; previous job continues on its original account, including refund.                                                   |
| Cross-restaurant attempt                    | No foreign status, receipt, payment session, event wake-up or refund access.                                                          |

Record order ID, job ID, merchant ID, Stripe object IDs, timestamps, exact amount, browser
observation and provider outcome for each case. Do not include customer contacts or secrets.
Distinguish real Stripe evidence from local adapters. Complete security, runtime, browser and
operational checks before calling P3 finished.
