# Restaurant website cart handoff

Public integration IDs identify a server-managed restaurant/location mapping. They convey no order,
payment or account authority. A registered origin can read its current public catalog and explicitly
create a selection-only draft. The central gateway validates trusted network metadata and signs each
upstream request. The API checks registration, current menu membership, variants/options, quantity
limits, rate budgets, nonce and expiry. Arbitrary contacts, prices, scope overrides and redirects
are rejected.

Drafts expire after ten minutes. Only SHA-256 import-token hashes are stored server-side; drafts
contain no guest details. A fragment carries the import-only token. The shared shop removes it from
the address, retains it for up to ten minutes in session storage, and asks whether to keep or
replace the current cart. Carts in other restaurant scopes are not touched. A prepare request first
establishes an HttpOnly browser cookie. Atomic redemption binds the draft to its hash, allowing the
same browser to retry after response loss and denying different browsers.

Imported selections are rebuilt against the shop catalog and still require a fresh server cart
quote, pickup time, price confirmation, contact, privacy acknowledgement and normal
CAPTCHA/checkout. Import does not create orders, issue checkout intents, start payments or modify
existing order recovery. An outstanding/recoverable checkout blocks replacement.

Expiry cleanup runs in bounded batches during use and every existing API cron tick. Integration
configuration is private and must be provisioned by an operator; there is no new public
administration write endpoint. Preview registrations expire with the existing synthetic test window.

The supplied pair of standalone source website workers use the same configurable adapter and
different hostnames and restaurant mappings. They are internal test pages. No live payment approval
is implied.
