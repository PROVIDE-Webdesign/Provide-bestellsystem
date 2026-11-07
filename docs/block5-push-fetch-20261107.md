# Block 5 - Cloudflare push fetch compatibility

Chat 18 owns this API-only follow-up. Base 04e07cf7e0569be84dcbbe952568f6b2a634b896 / tree
ee4db463a7bb77e7130ad1c78d40d64b9f1df74e. Preserve Chat 19 UI scope and the visible alarm control.

Normal hosted order BS34 / 2a8d8e0f-e686-4a84-b12e-d8e0f4c86320 was submitted at
2026-11-07T02:58:29Z through a user-completed real CAPTCHA, cash pickup, 690 cents. Push delivery
stayed false after retry. A separately labelled single manual provider diagnostic at 03:05:53Z was
accepted by Apple HTTP201; this does not prove normal hosted dispatch or actual iPhone receipt. No
outbox, event timestamp, lease or acceptance window was rewritten.

Root cause: workerd does not support redirect error; native Request construction throws before
transport. Use manual and treat 3xx as failure without following Location, preserving
origin/credential protection. Source:
https://developers.cloudflare.com/workers/runtime-apis/request/ . Existing earlier runtime probe
intercepted fetch before native Request validation, so it could not catch this bug.

Acceptance: existing cryptographic/expiry tests plus redirect non-follow regression, API
quality/build checks, native workerd proof of the old failure and fixed native Request
compatibility. Hosted closure additionally requires a fresh normal order, provider acceptance and
visible receipt while iPhone dashboard is closed, then reserved-card-before-acceptance receipt.
Block 4 real guest-phone tests and real mail delivery remain deferred. A2 6-7, 7-1/3, 11-1. No
public debug route, schema, credentials or configuration changes.
