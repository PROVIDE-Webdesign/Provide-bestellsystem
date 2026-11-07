# Block 4 - complete guest flow acceptance

Scope: both preview restaurants, desktop and mobile responsive coverage, website cart handoff, a
fresh order, restaurant processing and retrievable final guest status after closing the tab. BS24
requires its own correctly bound guest observation. The E168 common candidate and the E171 optional
retry-header fix are combined here. Preserve all payment guards and keep live payments and external
mail disabled. Device push delivery remains block 5.

Pending hosted migrations extend the existing sandbox-compatible schema; they do not enable live
payments or push. The already hosted rejection migration keeps its actual timestamp and compatible
body. Public browser and hosted provider evidence are recorded separately from local doubles and
mobile emulation.

The three payment/acceptance schema extensions were applied to the hosted preview as versions
20261107001718, 20261107001720 and 20261107001721. Migration files retain their exact SQL and are
renamed to these actual hosted versions. The push-subscription migration was not applied
(confirmation expired) and remains reserved for block 5 with dispatch disabled; it is not required
for guest flow acceptance. Existing orders and captured/refunded totals were unchanged; all jobs
retain test mode and no live merchant is enabled. A fresh encrypted preview backup completed
immediately before the schema alignment.
