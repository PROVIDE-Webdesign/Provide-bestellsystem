# Block 6: selected views and responsive boundaries

Owner: Bestellsystem 19. This package implements E175 Block 6 only. A2-3-6, A2-4-7/8, A2-6-1/7,
A2-8-1/2 and A2-10-1/4 retain their existing overall acceptance boundaries.

## Exact base and ownership

Base commit: `04e07cf7e0569be84dcbbe952568f6b2a634b896`, tree
`ee4db463a7bb77e7130ad1c78d40d64b9f1df74e`. It includes the E174 common product and Chat 18's
labelled `Bestelleingang & Alarm` control. `OrderInbox.tsx` and `order-inbox-control.css` remain
byte-identical to that base. Use the server branch `work/block6-design-completion-20261107`; the
separate local reconstruction is a comparison workspace, not an alternative integration parent.

Chat 18 exclusively integrates and publishes this package, runs hosted migrations, changes provider
configuration and updates the central project protocol. No deployment, hosted database mutation,
payment, external order message or resumption of deferred device tests is part of this
implementation.

## Corrected findings

- B6-UI-01: The order header's alarm `:has()` rules also matched hidden controls in S1/E1. They gave
  horizontal navigation almost a viewport of empty height and collapsed the restaurant selector.
  Management-specific header/action/navigation bounds now preserve the selected compact layouts.
- B6-UI-02: The framed management view exposed the dark document canvas at collapsed outer margins.
  The document and body share the light operator canvas. The order workspace also accounts for the
  new two-row desktop header instead of extending it below the viewport.
- B6-UI-03: Tablet management headers reflow without losing the restaurant selector or operation
  state. The order sidebar retains History; S1/E1 use the selected three-destination navigation.
  Preview fixtures now leave History enabled to exercise this real distinction.
- B6-UI-04: The 320px shop cut off the last short category, and favorite hit targets were narrow.
  Narrow-container typography and 44px favorite controls address both while preserving cart and
  favorite handlers. Account, delivery, calendar and chevron outlines follow the selected
  references.
- B6-DOC-01: The management comparison server used its fixture directory as the public asset root,
  leaving real product photos blank. It now serves the application's existing public assets.
- B6-TEST-01: Native browser cases still addressed the replaced info-symbol label. They now operate
  the visible alarm label; permissions, payment gates and push dispatch code are unchanged.

## Reproducible validation

Use Node 24, pnpm 11.19 and the frozen lockfile. `pnpm check` remains the normal project check. From
the repository root run `node scripts/test-selected-views.mjs`, optionally setting
`BROWSER_ENGINE=firefox` or `BROWSER_ENGINE=webkit`. The driver starts private loopback Vite servers
on automatically allocated ports and closes only those servers and its own browser.

The 26 cases per engine use production React components, CSS and local assets. Authentication and
API responses are explicit synthetic fixtures. Widths are 320, 390, 640, 768, 1024, 1280 and 1600px;
the 640x450 case represents the CSS reflow of a 1280x900 viewport at 200 percent. This is a reflow
simulation, not a physical phone or assistive-device acceptance. Checks cover compact management
navigation, visible restaurant/state controls, menu search/category/empty results, local product
assets, account navigation, native keyboard alarm operation, bounded dialogs, basket totals and
favorite persistence. External network requests are blocked in these browser contexts.

Results and screenshots are written under `output/selected-views/<engine>/`. Existing full browser
regressions remain in `apps/storefront/tests/browser/run.ts`; run engines serially because that
older harness uses port 4321. Dated actual results, source commit/tree and limits are recorded
separately in the package completion evidence. This runbook does not predeclare successful results.

## Original comparisons and remaining gates

Compare Shop B, operator layout 3 (list left/details right), S1 compact list and E1 topic overview
with their retained original artwork. The old operator artwork's label 02 is not a new selection.
Keep the previously accepted website cart 2 unchanged. Compare real HTML with equal viewport and
fixture data; never paste an original screenshot over the application.

Some text is deliberately data-dependent: the four-item fixture must not claim twelve real dishes,
and unknown opening/lead-time data must not become invented `Geöffnet`/`20-30 Min.` values. The
newly requested visible alarm control is an intentional later change to the older operator artwork.
Raster-generated references do not supply a reproducible font file; residual text/outline rendering
differences must be visible in the delivered comparisons, not labelled as pixel identity.

No overall A2 score, production readiness or device/pilot acceptance follows from this UI package.
Published acceptance requires Chat 18 to integrate the exact finished commit, publish it in the
coordinated environment and check the delivered version. Existing mobile guest and order-email
pauses remain effective.
