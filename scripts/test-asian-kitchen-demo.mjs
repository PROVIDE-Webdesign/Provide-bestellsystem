import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AsianKitchenCheckout } from "../apps/storefront/public/asian-kitchen/checkout.mjs";
import { mapDraft, wallDate } from "../apps/storefront/public/asian-kitchen/model.mjs";
import { parseGuestPickupOrderRequest } from "../apps/storefront/public/asian-kitchen/contracts/checkout.js";
import { taxAmount } from "../apps/storefront/public/asian-kitchen/contracts/tax.js";

const manifest = JSON.parse(
  await readFile(new URL("../apps/storefront/demo/manifest.json", import.meta.url)),
);
const originalFixture = JSON.parse(
  await readFile(new URL("../docs/pilot/asian-kitchen-staging-synthetic.json", import.meta.url)),
);
const published = JSON.parse(
  await readFile(
    new URL("../docs/pilot/asian-kitchen-published-catalog-20261028.json", import.meta.url),
  ),
).data;
const fixture = { items: published.menus.flatMap((m) => m.sections.flatMap((s) => s.items)) };
const expectedNames = {
  "dish-1": "TEST Frühlingsrollen",
  "dish-2": "TEST Gyoza",
  "dish-3": "TEST Edamame Meersalz",
  "dish-4": "TEST Tempura Garnelen",
  "dish-5": "TEST Crispy Duck",
  "dish-6": "TEST Beef Teriyaki",
  "dish-7": "TEST Miso Lachs",
  "dish-8": "TEST Thai Green Curry",
  "dish-17": "TEST Mochi Trio",
  "dish-18": "TEST Matcha Cheesecake",
  "dish-19": "TEST Mango Sticky Rice",
  "dish-20": "TEST Yuzu Crème Brûlée",
};
const clock = () => new Date("2026-10-27T18:00:00Z");
const config = { privacyNoticeVersion: "preview-v1" };
const customer = {
  contactName: "Synthetic Pilot",
  phoneE164: "+4915112345678",
  email: "synthetic@example.invalid",
};
const menuId = published.menus[0].id;
const versionId = published.menus[0].versionId;
function catalog() {
  return structuredClone(published);
}
function draft() {
  return {
    fulfilment: "pickup",
    requestedPickupTime: "22:00",
    items: [
      {
        id: "dish-2",
        name: "Gyoza",
        variant: "Hähnchen",
        quantity: 2,
        unitPriceCents: 790,
        specialRequest: "",
      },
      {
        id: "dish-1",
        name: "Frühlingsrollen",
        variant: "",
        quantity: 1,
        unitPriceCents: 690,
        specialRequest: "",
      },
    ],
  };
}
const storage = () => {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) || null,
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
};
function backend({ uncertain = false, quoteMismatch = false, issueFailure = false } = {}) {
  const calls = [];
  let confirmation = null,
    issue = null,
    issueFailed = false;
  const reply = (data, status = 200) => Response.json({ data }, { status });
  const fetcher = async (url, init = {}) => {
    const resource = String(url).split("/").pop();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ resource, body, headers: new Headers(init.headers) });
    if (resource === "catalog") return reply(catalog());
    if (resource === "checkout-context")
      return reply({ ready: true, csrf: "a".repeat(43), hasExistingIntents: false });
    assert.equal(new Headers(init.headers).get("x-provide-checkout-csrf"), "a".repeat(43));
    if (resource === "checkout-session") {
      if (!issue) {
        const issuedAt = Date.now();
        issue = {
          sessionId: crypto.randomUUID(),
          submissionKey: body.submissionKey,
          writeExpiresAt: new Date(issuedAt + 1800000).toISOString(),
          receiptExpiresAt: new Date(issuedAt + 5400000).toISOString(),
        };
      }
      if (issueFailure && !issueFailed) {
        issueFailed = true;
        return Response.json({ error: { code: "service_unavailable" } }, { status: 503 });
      }
      return reply(issue);
    }
    if (resource === "cart-quote") {
      const lines = body.lines.map((l) => {
        const p = fixture.items.find((i) => i.id === l.menuItemId),
          v = p.configuration.variants.find((v) => v.id === l.variantId) || null;
        const unit = p.priceAmountMinor + (v?.priceDeltaAmountMinor || 0),
          gross = unit * l.quantity;
        return {
          ...l,
          variantId: v?.id || null,
          optionIds: [],
          name: p.name,
          unitPriceAmountMinor: unit,
          lineAmountMinor: gross,
          selectionSnapshot: {
            schemaVersion: 1,
            variant: v
              ? { id: v.id, name: v.name, priceDeltaAmountMinor: v.priceDeltaAmountMinor }
              : null,
            options: [],
            allergens: p.configuration.allergens,
            additives: p.configuration.additives,
            taxRateBasisPoints: p.configuration.taxRateBasisPoints,
            taxAmountMinor: taxAmount(gross, p.configuration.taxRateBasisPoints),
          },
        };
      });
      if (quoteMismatch) lines[0].quantity++;
      return reply({
        status: "current",
        currentMenuVersionId: versionId,
        currency: "EUR",
        itemCount: lines.reduce((n, l) => n + l.quantity, 0),
        subtotalAmountMinor: lines.reduce((n, l) => n + l.lineAmountMinor, 0),
        deliveryQuote: null,
        lines,
      });
    }
    if (resource === "orders") {
      assert.ok(parseGuestPickupOrderRequest(body.command));
      assert.equal(body.sessionId, issue.sessionId);
      assert.equal(body.command.submissionKey, issue.submissionKey);
      assert.deepEqual(body.command.customer, customer);
      assert.equal("unitPriceCents" in body.command.lines[0], false);
      confirmation = {
        orderId: "f6000000-0000-0000-0000-000000000001",
        orderNumber: "BS-00000099",
        statusAccessToken: "b".repeat(43),
        statusAvailableUntil: new Date(
          Date.parse(body.command.requestedFor) + 172800000,
        ).toISOString(),
        status: "submitted",
        fulfillmentType: "pickup",
        paymentCollectionMode: "on_fulfillment",
        requestedFor: body.command.requestedFor,
        currency: "EUR",
        totalAmountMinor: 2270,
        itemCount: 3,
      };
      if (uncertain) throw new TypeError("simulated lost response");
      return reply(confirmation, 201);
    }
    if (resource === "checkout-receipt")
      return reply(
        confirmation
          ? { state: "committed", mode: "orders", confirmation }
          : { state: "unsubmitted", writeExpired: false },
      );
    if (resource === "order-status") {
      assert.equal(body.orderId, confirmation.orderId);
      assert.equal(body.statusAccessToken, confirmation.statusAccessToken);
      return reply({ ...confirmation, status: "ready", updatedAt: new Date().toISOString() });
    }
    throw Error("Unexpected resource " + resource);
  };
  return { fetcher, calls };
}
const controller = (b) =>
  new AsianKitchenCheckout(config, manifest, {
    fetcher: b.fetcher,
    storage: storage(),
    now: clock,
  });

test("native-style fetch keeps the global receiver for default and injected transports", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const useDefault of [true, false]) {
      const b = backend();
      const receiverSensitiveFetch = function (...args) {
        assert.equal(this, globalThis, "browser fetch requires its global receiver");
        return b.fetcher(...args);
      };
      globalThis.fetch = receiverSensitiveFetch;
      const options = {
        storage: storage(),
        now: clock,
        ...(useDefault ? {} : { fetcher: receiverSensitiveFetch }),
      };
      const c = new AsianKitchenCheckout(config, manifest, options);
      assert.equal((await c.quote(draft())).subtotalAmountMinor, 2270);
      const result = await c.submit(draft(), customer, "token", crypto.randomUUID());
      assert.equal((await c.status(result)).status, "ready");
      assert.equal(b.calls.filter((x) => x.resource === "orders").length, 1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("all twelve dishes and eight variants map to explicit catalog IDs", () => {
  assert.equal(Object.keys(manifest.items).length, 12);
  assert.equal(
    Object.values(manifest.items).reduce((n, i) => n + i.variants.length, 0),
    8,
  );
  for (const [id, m] of Object.entries(manifest.items))
    for (const variant of m.variants.length ? m.variants : [{ label: "" }]) {
      const d = {
        fulfilment: "pickup",
        requestedPickupTime: "22:00",
        items: [
          {
            id,
            name: "UI name is not identity",
            variant: variant.label,
            quantity: 1,
            unitPriceCents: 1,
            specialRequest: "",
          },
        ],
      };
      const out = mapDraft(d, catalog(), manifest, clock());
      assert.equal(out.lines[0].menuItemId, m.menuItemId);
      assert.equal(out.requestedFor, "2026-10-27T21:00:00.000Z");
    }
});
test("reject wrong scope, missing catalog, sold-out items, unknown variants and unsupported wishes", () => {
  let c = catalog();
  c.location.slug = "another";
  assert.throws(() => mapDraft(draft(), c, manifest, clock()));
  c = catalog();
  c.menus = [];
  assert.throws(() => mapDraft(draft(), c, manifest, clock()));
  c = catalog();
  c.menus[0].sections[0].items[1].availability = "sold_out";
  assert.throws(() => mapDraft(draft(), c, manifest, clock()));
  const d = draft();
  d.items[0].variant = "Unknown";
  assert.throws(() => mapDraft(d, catalog(), manifest, clock()));
  d.items[0].variant = "Hähnchen";
  d.items[0].specialRequest = "Do not lose this";
  assert.throws(() => mapDraft(d, catalog(), manifest, clock()), /Sonderwünsche/);
});
test("timezone comes from restaurant; DST gaps and duplicate times are rejected", () => {
  assert.equal(wallDate(new Date("2026-10-27T23:30:00Z")), "2026-10-28");
  for (const instant of ["2026-03-29T00:00:00Z", "2026-10-25T00:00:00Z"]) {
    const d = draft();
    d.requestedPickupTime = "02:30";
    assert.throws(() => mapDraft(d, catalog(), manifest, new Date(instant)));
  }
});
test("server quote controls price, existing client preserves CSRF/intent and double click sends once", async () => {
  const b = backend(),
    c = controller(b),
    d = draft();
  d.items[0].unitPriceCents = 1;
  const q = await c.quote(d);
  assert.equal(q.subtotalAmountMinor, 2270);
  const results = await Promise.allSettled([
    c.submit(d, customer, "managed-test-token", crypto.randomUUID()),
    c.submit(d, customer, "managed-test-token", crypto.randomUUID()),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(b.calls.filter((x) => x.resource === "orders").length, 1);
  assert.equal(
    (await c.status(results.find((x) => x.status === "fulfilled").value)).status,
    "ready",
  );
});
test("a changed cart invalidates the reviewed quote before issuing a session", async () => {
  const b = backend(),
    c = controller(b),
    d = draft();
  await c.quote(d);
  d.items[0].quantity++;
  await assert.rejects(
    c.submit(d, customer, "token", crypto.randomUUID()),
    /Warenkorb wurde geändert/,
  );
  assert.equal(b.calls.filter((x) => x.resource === "checkout-session").length, 0);
});
test("uncertain transport blocks resubmission and recovers the same committed order", async () => {
  const b = backend({ uncertain: true }),
    c = controller(b),
    d = draft();
  await c.quote(d);
  await assert.rejects(c.submit(d, customer, "token", crypto.randomUUID()));
  assert.equal(c.client.needsReceipt, true);
  await assert.rejects(c.submit(d, customer, "token", crypto.randomUUID()));
  const receipt = await c.receipt();
  assert.equal(receipt.confirmation.orderNumber, "BS-00000099");
  assert.equal(b.calls.filter((x) => x.resource === "orders").length, 1);
});
test("page reload restores pending intent and permits receipt recovery before any new quote", async () => {
  const b = backend({ uncertain: true }),
    s = storage(),
    opts = { fetcher: b.fetcher, storage: s, now: clock },
    c = new AsianKitchenCheckout(config, manifest, opts),
    d = draft();
  await c.quote(d);
  await assert.rejects(c.submit(d, customer, "token", crypto.randomUUID()));
  const reopened = new AsianKitchenCheckout(config, manifest, opts);
  assert.equal(reopened.client.needsReceipt, true);
  await assert.rejects(reopened.quote(d));
  assert.equal((await reopened.receipt()).state, "committed");
  assert.equal(b.calls.filter((x) => x.resource === "orders").length, 1);
});
test("uncertain challenge issuance is retried with identical payload and submission key", async () => {
  const b = backend({ issueFailure: true }),
    c = controller(b),
    d = draft();
  await c.quote(d);
  await assert.rejects(c.submit(d, customer, "token", crypto.randomUUID()));
  assert.equal(c.client.hasPendingIssue, true);
  await c.submit(d, customer, "unused-new-token", crypto.randomUUID());
  const issues = b.calls.filter((x) => x.resource === "checkout-session");
  assert.deepEqual(issues[0].body, issues[1].body);
  assert.equal(b.calls.filter((x) => x.resource === "orders").length, 1);
});
test("an inconsistent server quote is rejected", async () => {
  const b = backend({ quoteMismatch: true }),
    c = controller(b);
  await assert.rejects(c.quote(draft()));
  assert.equal(c.preview, null);
});
test("missing local intent metadata blocks a new order when the server reports an older attempt", async () => {
  const b = backend(),
    original = b.fetcher;
  b.fetcher = async (url, init) =>
    String(url).endsWith("/checkout-context")
      ? Response.json({ data: { ready: true, csrf: "a".repeat(43), hasExistingIntents: true } })
      : original(url, init);
  const c = controller(b);
  await assert.rejects(c.quote(draft()), /Belegdaten/);
  await assert.rejects(c.submit(draft(), customer, "token", crypto.randomUUID()));
  assert.equal(
    b.calls.filter((x) => x.resource === "orders" || x.resource === "checkout-session").length,
    0,
  );
});
test("completed order metadata remains recoverable after reload until an explicit new order", async () => {
  const b = backend(),
    s = storage(),
    opts = { fetcher: b.fetcher, storage: s, now: clock },
    c = new AsianKitchenCheckout(config, manifest, opts),
    d = draft();
  await c.quote(d);
  await c.submit(d, customer, "token", crypto.randomUUID());
  const reopened = new AsianKitchenCheckout(config, manifest, opts);
  assert.equal(reopened.client.needsReceipt, true);
  const receipt = await reopened.receipt();
  assert.equal(receipt.confirmation.orderNumber, "BS-00000099");
  await assert.rejects(reopened.submit(d, customer, "token", crypto.randomUUID()));
  assert.equal(b.calls.filter((x) => x.resource === "orders").length, 1);
});

test("published import keeps twelve source products and eight variants with new item IDs", () => {
  assert.equal(published.restaurant.slug, "storefront-restaurant-a");
  assert.equal(published.location.slug, "storefront-a-mitte");
  assert.equal(published.location.timezone, "Europe/Berlin");
  assert.equal(published.menus.length, 1);
  assert.equal(fixture.items.length, 12);
  assert.equal(
    fixture.items.reduce((n, i) => n + i.configuration.variants.length, 0),
    8,
  );
  const ids = new Set();
  for (const [dish, name] of Object.entries(expectedNames)) {
    const mapped = manifest.items[dish],
      product = fixture.items.find((i) => i.id === mapped.menuItemId);
    assert.ok(product, dish + " has a published product");
    assert.equal(product.name, name);
    const source = originalFixture.items.find((i) => i.name === name);
    assert.notEqual(product.id, source.id);
    assert.equal(product.description, source.description);
    assert.equal(product.priceAmountMinor, source.priceAmountMinor);
    assert.deepEqual(product.configuration, source.configuration);
    assert.ok(!ids.has(product.id));
    ids.add(product.id);
    for (const variant of mapped.variants) {
      assert.equal(
        product.configuration.variants.find((v) => v.id === variant.id)?.name,
        "TEST " + variant.label,
      );
    }
  }
});
test("obsolete import IDs cannot select items from the published version", () => {
  const stale = structuredClone(manifest);
  for (const [dish, name] of Object.entries(expectedNames))
    stale.items[dish].menuItemId = originalFixture.items.find((i) => i.name === name).id;
  assert.throws(() => mapDraft(draft(), catalog(), stale, clock()), /veröffentlicht/);
});
