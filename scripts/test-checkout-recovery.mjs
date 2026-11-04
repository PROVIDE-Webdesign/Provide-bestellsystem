// Run after build-asian-kitchen-demo.mjs: this is the shared client compiled from
// the same source used by the native checkout. HTTP is simulated; no real orders.
import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutClient } from "../apps/storefront/public/asian-kitchen/checkout-client.js";

const base = "/api/storefront/recovery-test/recovery-location";
const customer = { contactName: "Synthetic Guest", email: "guest@example.invalid" };
const command = {
  menuId: "f4000000-0000-0000-0000-000000000001",
  menuVersionId: "f5000000-0000-0000-0000-000000000001",
  requestedFor: new Date(Date.now() + 3600000).toISOString(),
  lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 1 }],
  customer,
  privacyNoticeVersion: "preview-v1",
};

function setup(outcome) {
  const saved = new Map();
  const storage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  };
  const calls = [];
  let issued,
    committed = false,
    receiptFailure = null;
  const fetcher = async (url, init = {}) => {
    const resource = String(url).split("/").pop();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ resource, body });
    if (resource === "checkout-context")
      return Response.json({ data: { ready: true, csrf: "a".repeat(43) } });
    if (resource === "checkout-session") {
      const issuedAt = Date.now();
      issued = {
        sessionId: crypto.randomUUID(),
        submissionKey: body.submissionKey,
        writeExpiresAt: new Date(issuedAt + 1800000).toISOString(),
        receiptExpiresAt: new Date(issuedAt + 5400000).toISOString(),
      };
      return Response.json({ data: issued });
    }
    if (resource === "orders") {
      assert.equal(body.sessionId, issued.sessionId);
      assert.equal(body.command.submissionKey, issued.submissionKey);
      if (outcome === "before-send") throw new TypeError("simulated offline before send");
      committed = true;
      if (outcome === "lost-response") throw new TypeError("simulated response lost after commit");
      if (outcome === "truncated-body") return new Response('{"data":', { status: 201 });
      if (outcome === "abort-after-send")
        return new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        });
      return Response.json({ data: { orderId: "synthetic-order" } }, { status: 201 });
    }
    if (resource === "checkout-receipt") {
      if (receiptFailure === "offline") throw new TypeError("simulated receipt offline");
      if (receiptFailure === "503") return new Response(null, { status: 503 });
      if (receiptFailure === "invalid-json") return new Response('{"data":');
      if (receiptFailure === "invalid-state") return Response.json({ data: { state: "unknown" } });
      return Response.json({
        data: committed
          ? { state: "committed", mode: "orders", confirmation: { orderId: "synthetic-order" } }
          : { state: "unsubmitted", writeExpired: false },
      });
    }
    throw new Error(`Unexpected resource: ${resource}`);
  };
  return {
    client: new CheckoutClient(base, fetcher, storage),
    calls,
    saved,
    reopen: () => new CheckoutClient(base, fetcher, storage),
    failReceipt: (failure) => {
      receiptFailure = failure;
    },
  };
}

for (const outcome of ["before-send", "lost-response", "truncated-body"]) {
  test(`${outcome}: uncertain submission blocks a second write and recovers by read only`, async () => {
    const x = setup(outcome);
    await x.client.issue("test-challenge", crypto.randomUUID());
    await assert.rejects(async () => (await x.client.submit("orders", command)).json());
    assert.equal(x.client.needsReceipt, true);
    await assert.rejects(x.client.submit("orders", command), { code: "checkout_result_unknown" });
    const receipt = await x.client.receipt();
    assert.equal(receipt.state, outcome === "before-send" ? "unsubmitted" : "committed");
    assert.equal(x.calls.filter((c) => c.resource === "orders").length, 1);
    assert.equal(x.calls.filter((c) => c.resource === "checkout-session").length, 1);
    assert.equal(x.client.needsReceipt, receipt.state === "committed");
    assert.equal(JSON.stringify([...x.saved.values()]).includes(customer.contactName), false);
    assert.equal(JSON.stringify([...x.saved.values()]).includes(customer.email), false);
  });
}

for (const failure of ["offline", "503", "invalid-json", "invalid-state"]) {
  test(`${failure}: failed receipt preserves the lock and original intent`, async () => {
    const x = setup("lost-response");
    await x.client.issue("test-challenge", crypto.randomUUID());
    const original = structuredClone(x.client.currentIntent);
    await assert.rejects(x.client.submit("orders", command));
    x.failReceipt(failure);
    await assert.rejects(x.client.receipt());
    assert.equal(x.client.needsReceipt, true);
    assert.deepEqual(x.client.currentIntent, original);
    await assert.rejects(x.client.submit("orders", command), { code: "checkout_result_unknown" });
    await assert.rejects(x.client.issue("new-challenge", crypto.randomUUID(), true));
    assert.equal(x.calls.filter((c) => c.resource === "orders").length, 1);
    x.failReceipt(null);
    assert.equal((await x.client.receipt()).state, "committed");
  });
}

test("reload after lost response restores only metadata and reads the existing order", async () => {
  const x = setup("lost-response");
  await x.client.issue("test-challenge", crypto.randomUUID());
  await assert.rejects(x.client.submit("orders", command));
  const reopened = x.reopen();
  const before = x.calls.length;
  await assert.rejects(reopened.submit("orders", command), { code: "checkout_result_unknown" });
  assert.equal(x.calls.length, before);
  const receipt = await reopened.receipt();
  assert.equal(receipt.confirmation.orderId, "synthetic-order");
  assert.equal(x.calls.filter((c) => c.resource === "orders").length, 1);
  assert.equal(reopened.needsReceipt, true);
  reopened.complete();
  assert.equal(x.saved.size, 0);
});

test("confirmed unsubmitted attempt permits only an explicit retry with the same identity", async () => {
  const x = setup("before-send");
  await x.client.issue("test-challenge", crypto.randomUUID());
  await assert.rejects(x.client.submit("orders", command));
  const receipt = await x.client.receipt();
  assert.equal(receipt.state, "unsubmitted");
  assert.equal(x.client.needsReceipt, false);
  assert.equal(x.calls.filter((c) => c.resource === "orders").length, 1);
  await assert.rejects(x.client.submit("orders", command));
  const writes = x.calls.filter((c) => c.resource === "orders");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].body, writes[1].body);
});

test("double click and transport abort keep exactly one write and require recovery", async () => {
  const x = setup("abort-after-send");
  await x.client.issue("test-challenge", crypto.randomUUID());
  const abort = new AbortController();
  const pending = x.client.submit("orders", command, abort.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(x.client.submit("orders", command), { code: "checkout_result_unknown" });
  // Advance microtasks until the simulated transport has received the write.
  for (let step = 0; step < 10 && !x.calls.some((c) => c.resource === "orders"); step++)
    await Promise.resolve();
  assert.equal(x.calls.filter((c) => c.resource === "orders").length, 1);
  abort.abort();
  await rejected;
  assert.equal(x.client.needsReceipt, true);
  assert.equal(x.calls.filter((c) => c.resource === "orders").length, 1);
  assert.equal((await x.client.receipt()).state, "committed");
});
