import { describe, expect, it, vi } from "vitest";
import { checkoutDigest, signCheckoutRequest, type CheckoutAttestation } from "@provide/contracts";
import { createApiWorker } from "./index.js";
import {
  handleProtectedStorefront,
  type CheckoutProtectionEnvironment,
  type ProtectedWriters,
} from "./checkout-protection.js";
import type { CheckoutProtectionRepository } from "./checkout-protection-database.js";
import type { StorefrontRoute } from "./storefront.js";
import { postgresOnlineRepository } from "./online-payments-database.js";
import { handleGuestPickupOrder } from "./checkout.js";
import { createStatusAccessToken } from "./status-token.js";
const scope = { restaurantSlug: "storefront-restaurant-a", locationSlug: "storefront-a-mitte" };
const env: CheckoutProtectionEnvironment = {
  APP_ENV: "test",
  HYPERDRIVE: { connectionString: "postgresql://synthetic.invalid/db" },
  HYPERDRIVE_CACHE_DISABLED: "true",
  CHECKOUT_PROTECTION_ENABLED: "true",
  CHECKOUT_GATEWAY_SECRET: "synthetic-o3-gateway-secret-at-least-32-bytes",
  CHECKOUT_FINGERPRINT_SECRET: "synthetic-o3-fingerprint-secret-at-least-32-bytes",
  CHECKOUT_TURNSTILE_SECRET: "synthetic-o3-challenge-secret-at-least-32-bytes",
  CHECKOUT_STOREFRONT_ORIGIN: "https://storefront.test",
  CHECKOUT_WRITE_ENABLED: "true",
  CHECKOUT_PRIVACY_NOTICE_VERSION: "preview-v1",
  CHECKOUT_RETENTION_DAYS: "30",
  ORDER_STATUS_READ_ENABLED: "true",
  ORDER_STATUS_TOKEN_SECRET: "synthetic-o3-status-secret-at-least-32-bytes",
};
const command = {
  menuId: "f4000000-0000-0000-0000-000000000001",
  menuVersionId: "f5000000-0000-0000-0000-000000000001",
  requestedFor: "2026-10-08T20:00:00.000Z",
  lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 1 }],
  submissionKey: crypto.randomUUID(),
  customer: {
    contactName: "Synthetic Guest",
    phoneE164: "+999100000001",
    email: "synthetic@example.invalid",
  },
  privacyNoticeVersion: "preview-v1",
};
const session = crypto.randomUUID();
const rawReceipt = {
  orderId: crypto.randomUUID(),
  status: "submitted",
  fulfillmentType: "pickup",
  paymentCollectionMode: "on_fulfillment",
  requestedFor: command.requestedFor,
  currency: "EUR",
  totalAmountMinor: 1250,
  itemCount: 1,
};
const intent = {
  sessionId: session,
  submissionKey: command.submissionKey,
  writeExpiresAt: "2026-10-08T20:30:00.000Z",
  receiptExpiresAt: "2026-10-08T21:30:00.000Z",
};
async function signed(
  name: StorefrontRoute["name"],
  body: unknown,
  context: string | null = "a".repeat(64),
  freshContext = false,
  routeScope = scope,
  network = ["b".repeat(64), "c".repeat(64)],
) {
  const at = Date.now();
  const a: CheckoutAttestation = {
    at,
    nonce: crypto.randomUUID(),
    context,
    freshContext,
    network,
    epoch: Math.floor(at / 600000),
  };
  const r = new Request(
    `https://api.test/v1/storefront/${routeScope.restaurantSlug}/${routeScope.locationSlug}/${name === "orderStatus" ? "order-status" : name}`,
    { method: "POST" },
  );
  const text = JSON.stringify(body);
  return new Request(r, {
    headers: await signCheckoutRequest(r, text, a, env.CHECKOUT_GATEWAY_SECRET!),
    body: text,
  });
}
function setup() {
  const repo = {
    guard: vi.fn<CheckoutProtectionRepository["guard"]>().mockResolvedValue({ outcome: "allowed" }),
    context: vi.fn<CheckoutProtectionRepository["context"]>().mockResolvedValue({
      outcome: "allowed",
      contextExpiresAt: new Date(Date.now() + 5400000).toISOString(),
    }),
    beginIssue: vi
      .fn<CheckoutProtectionRepository["beginIssue"]>()
      .mockResolvedValue({ outcome: "pending" }),
    finishIssue: vi
      .fn<CheckoutProtectionRepository["finishIssue"]>()
      .mockResolvedValue({ outcome: "issued", intent }),
    receipt: vi
      .fn<CheckoutProtectionRepository["receipt"]>()
      .mockResolvedValue({ outcome: "unsubmitted", writeExpired: false }),
    submit: vi.fn<CheckoutProtectionRepository["submit"]>().mockResolvedValue(rawReceipt),
    cleanup: vi.fn<CheckoutProtectionRepository["cleanup"]>(),
  };
  const challenge = { verify: vi.fn().mockResolvedValue(true) };
  const logger = { error: vi.fn() };
  const writers: ProtectedWriters = {
    checkout: { submit: vi.fn() },
    delivery: { quote: vi.fn(), submit: vi.fn() },
    online: postgresOnlineRepository,
  };
  const delegate = vi.fn((r: Request, w: ProtectedWriters) =>
    handleGuestPickupOrder(
      r,
      { ...scope, name: "orders" },
      env,
      w.checkout,
      { requestId: "o3-test" },
      logger,
      new Headers(),
    ),
  );
  const run = async (
    name: StorefrontRoute["name"],
    body: unknown = { sessionId: session, command },
    overrides: Partial<CheckoutProtectionEnvironment> = {},
    aContext: string | null = "a".repeat(64),
    fresh = false,
    routeScope = scope,
    network = ["b".repeat(64), "c".repeat(64)],
  ) =>
    handleProtectedStorefront(
      await signed(name, body, aContext, fresh, routeScope, network),
      { ...routeScope, name },
      { ...env, ...overrides },
      repo,
      challenge,
      writers,
      { requestId: "o3-test" },
      new Headers(),
      delegate,
    );
  return { repo, challenge, logger, writers, delegate, run };
}
describe("O3 actual dispatcher / protected handler units (repository doubles)", () => {
  it("O3-T24 prior gateway secrets require a bounded absolute deadline and expire independently of fresh signatures", async () => {
    const x = setup();
    const prior = "synthetic-prior-gateway-secret-at-least-32";
    for (const until of [undefined, "invalid", new Date(Date.now() + 60000).toISOString()]) {
      expect(
        (
          await x.run(
            "orders",
            { sessionId: session, command },
            {
              CHECKOUT_GATEWAY_SECRET_PREVIOUS: prior,
              ...(until ? { CHECKOUT_GATEWAY_SECRET_PREVIOUS_UNTIL: until } : {}),
            },
          )
        ).status,
      ).toBe(503);
    }
    expect(x.repo.guard).not.toHaveBeenCalled();
    const request = await signed("orders", { sessionId: session, command });
    const text = await request.clone().text();
    const metadata = JSON.parse(request.headers.get("x-provide-checkout")!) as CheckoutAttestation;
    const oldSigned = new Request(request, {
      headers: await signCheckoutRequest(request, text, metadata, prior),
    });
    const runOld = (until: string) =>
      handleProtectedStorefront(
        oldSigned.clone(),
        { ...scope, name: "orders" },
        {
          ...env,
          CHECKOUT_GATEWAY_SECRET_PREVIOUS: prior,
          CHECKOUT_GATEWAY_SECRET_PREVIOUS_UNTIL: until,
        },
        x.repo,
        x.challenge,
        x.writers,
        { requestId: "rotation-unit" },
        new Headers(),
        x.delegate,
      );
    expect((await runOld(new Date(Date.now() + 10000).toISOString())).status).toBe(201);
    expect((await runOld(new Date(Date.now() - 1).toISOString())).status).toBe(403);
  });
  it.each([
    "orders",
    "delivery-orders",
    "online-orders",
    "cart-quote",
    "delivery-quote",
    "order-status",
    "payment-session",
    "checkout-session",
    "checkout-receipt",
  ])("O3-T19 actual dispatcher closes unsigned %s before SQL", async (path) => {
    const r = new Request(
      `https://api.test/v1/storefront/${scope.restaurantSlug}/${scope.locationSlug}/${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://storefront.test" },
        body: "{}",
      },
    );
    expect((await createApiWorker().fetch(r, env)).status).toBe(403);
  });
  it("O3-T01/T33 binds the challenge to a stable issue and returns only a public intent", async () => {
    const x = setup();
    const issue = {
      issueId: crypto.randomUUID(),
      submissionKey: command.submissionKey,
      challenge: "synthetic-valid",
    };
    const response = await x.run("checkout-session", issue);
    expect(response.status).toBe(201);
    expect(x.challenge.verify).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "storefront.test" }),
      issue.challenge,
      issue.issueId,
    );
    expect(x.repo.submit).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(issue.challenge);
    expect(x.repo.finishIssue).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      issue,
      expect.any(String),
      "a".repeat(64),
      expect.objectContaining(scope),
      true,
    );
  });
  it("O3-T35 issue replay does not consume another challenge verification", async () => {
    const x = setup();
    x.repo.beginIssue.mockResolvedValue({ outcome: "issued", intent });
    expect(
      (
        await x.run("checkout-session", {
          issueId: crypto.randomUUID(),
          submissionKey: command.submissionKey,
          challenge: "used-valid",
        })
      ).status,
    ).toBe(200);
    expect(x.challenge.verify).not.toHaveBeenCalled();
  });
  it("O3-T36 challenge transport uncertainty creates no session and leaves valid checkout usable", async () => {
    const x = setup();
    x.challenge.verify.mockRejectedValue(new Error("provider-details-secret"));
    expect(
      (
        await x.run("checkout-session", {
          issueId: crypto.randomUUID(),
          submissionKey: command.submissionKey,
          challenge: "valid",
        })
      ).status,
    ).toBe(503);
    expect(x.repo.finishIssue).not.toHaveBeenCalled();
    expect((await x.run("orders")).status).toBe(201);
  });
  it.each([false, undefined])(
    "O3-T34 negative or indeterminate challenge %s creates no session",
    async (verified) => {
      const x = setup();
      x.challenge.verify.mockResolvedValue(verified);
      x.repo.finishIssue.mockResolvedValue({ outcome: "forbidden" });
      expect(
        (
          await x.run("checkout-session", {
            issueId: crypto.randomUUID(),
            submissionKey: command.submissionKey,
            challenge: "invalid",
          })
        ).status,
      ).toBe(409);
      expect(x.repo.submit).not.toHaveBeenCalled();
    },
  );
  it("O3-T05/T09/T16 replay is read only after new-write gates close and validates the complete fingerprint", async () => {
    const x = setup();
    expect((await x.run("orders")).status).toBe(201);
    const args = x.repo.submit.mock.calls[0]!;
    const fingerprint = args[5];
    x.repo.receipt.mockResolvedValue({
      outcome: "committed",
      mode: "orders",
      receipt: rawReceipt,
      fingerprint,
    });
    x.repo.submit.mockClear();
    x.delegate.mockClear();
    const response = await x.run(
      "orders",
      { sessionId: session, command },
      { CHECKOUT_WRITE_ENABLED: "false" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { orderId: rawReceipt.orderId } });
    expect(x.repo.submit).not.toHaveBeenCalled();
    expect(x.delegate).not.toHaveBeenCalled();
    expect(
      (
        await x.run("orders", {
          sessionId: session,
          command: { ...command, customer: { ...command.customer, contactName: "changed" } },
        })
      ).status,
    ).toBe(409);
    const budgets = x.repo.guard.mock.calls.at(-1)![3];
    expect(budgets.every((b) => !b.key.includes("write"))).toBe(true);
  });
  it.each([
    { outcome: "expired" },
    { outcome: "forbidden" },
    { outcome: "unsubmitted", writeExpired: true },
  ])("O3-T02/T03/T04/T06 expired or foreign intent %j cannot write", async (value) => {
    const x = setup();
    x.repo.receipt.mockResolvedValue(value);
    expect([403, 410]).toContain((await x.run("orders")).status);
    expect(x.repo.submit).not.toHaveBeenCalled();
  });
  it("O3-T11/T12/T13 never lets a public ID or replacement key authorize itself", async () => {
    const x = setup();
    expect((await x.run("orders", { sessionId: session, command }, {}, null)).status).toBe(403);
    expect(
      (
        await x.run("orders", {
          sessionId: session,
          command: { ...command, submissionKey: "wrong" },
        })
      ).status,
    ).toBe(400);
    expect(x.repo.submit).not.toHaveBeenCalled();
  });
  it("O3-T14/T37 distinguishes an uncertain DB/commit result from a definite transaction rejection", async () => {
    const x = setup();
    x.repo.submit.mockRejectedValue(new Error("connection lost after commit with Synthetic Guest"));
    const unknown = await x.run("orders");
    expect(unknown.status).toBe(503);
    expect(await unknown.json()).toMatchObject({ error: { code: "checkout_result_unknown" } });
    x.repo.submit.mockRejectedValue({ code: "P0001" });
    expect((await x.run("orders")).status).toBe(409);
    expect(JSON.stringify(x.logger.error.mock.calls)).not.toContain("Synthetic Guest");
  });
  it("O3-T23/T25/T31 checks the rate decision before the domain writer and exposes a bounded Retry-After", async () => {
    const x = setup();
    x.repo.guard.mockResolvedValue({ outcome: "limited", retryAfter: 10 });
    const r = await x.run("orders");
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("10");
    expect(x.repo.submit).not.toHaveBeenCalled();
    expect(x.delegate).not.toHaveBeenCalled();
    x.repo.guard.mockResolvedValue({ outcome: "limited", retryAfter: 999999 });
    expect((await x.run("orders")).status).toBe(503);
  });
  it.each([{ outcome: "unavailable" }, { outcome: "unexpected" }, null])(
    "O3-T37 rate/nonce store invalid %j fails closed",
    async (value) => {
      const x = setup();
      x.repo.guard.mockResolvedValue(value);
      expect((await x.run("orders")).status).toBe(503);
      expect(x.repo.submit).not.toHaveBeenCalled();
    },
  );
  it("O3-T27/T28 network buckets are scope-independent; primary writes remain context/intent-bound", async () => {
    const x = setup();
    await x.run("orders");
    const budgets = x.repo.guard.mock.calls[0]![3];
    expect(budgets.slice(0, 2)).toEqual(
      ["b", "c"].map((v) => ({ key: `network:write:${v.repeat(64)}`, capacity: 120, period: 60 })),
    );
    expect(budgets[2]?.capacity).toBe(6);
    expect(budgets[2]?.key).toContain(await checkoutDigest(`${"a".repeat(64)}:${session}`));
    await x.run("orders", { sessionId: session, command }, {}, "d".repeat(64), false, {
      restaurantSlug: "storefront-restaurant-b",
      locationSlug: "storefront-b-mitte",
    });
    const sharedNat = x.repo.guard.mock.calls[1]![3];
    expect(sharedNat.slice(0, 2)).toEqual(budgets.slice(0, 2));
    expect(sharedNat[2]?.key).not.toBe(budgets[2]?.key);
    await x.run("orders", { sessionId: session, command }, {}, "a".repeat(64), false, scope, [
      "e".repeat(64),
      "f".repeat(64),
    ]);
    const switchedNetwork = x.repo.guard.mock.calls[2]![3];
    expect(switchedNetwork[2]).toEqual(budgets[2]);
    expect(switchedNetwork.slice(0, 2)).not.toEqual(budgets.slice(0, 2));
  });
  it("O3-T30/T46 status primary counters require their own capability, independent of active checkout sessions", async () => {
    const x = setup();
    x.delegate.mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })));
    await x.run(
      "orderStatus",
      { orderId: rawReceipt.orderId, statusAccessToken: "z".repeat(43) },
      {},
      null,
    );
    expect(x.repo.guard.mock.calls[0]![3] as unknown[]).toHaveLength(2);
    const token = await createStatusAccessToken(
      env.ORDER_STATUS_TOKEN_SECRET!,
      scope,
      rawReceipt.orderId,
    );
    await x.run("orderStatus", { orderId: rawReceipt.orderId, statusAccessToken: token }, {}, null);
    expect(x.repo.guard.mock.calls[1]![3] as unknown[]).toHaveLength(3);
  });
  it.each([
    { CHECKOUT_PROTECTION_ENABLED: "false" },
    { CHECKOUT_GATEWAY_SECRET: "short" },
    { CHECKOUT_FINGERPRINT_SECRET: env.CHECKOUT_GATEWAY_SECRET! },
    { CHECKOUT_STOREFRONT_ORIGIN: "http://storefront.test" },
    { APP_ENV: "production", CHECKOUT_STOREFRONT_ORIGIN: "https://localhost" },
  ])("O3-T24/T38 unsafe configuration %j has no fallback", async (override) => {
    const x = setup();
    expect((await x.run("orders", { sessionId: session, command }, override)).status).toBe(503);
    expect(x.repo.guard).not.toHaveBeenCalled();
    expect(x.repo.submit).not.toHaveBeenCalled();
  });
  it("O3-T08 only a fresh server-issued bootstrap can create an unknown verifier hash", async () => {
    const x = setup();
    await x.run("checkout-context", {}, {}, "a".repeat(64), true);
    expect(x.repo.context).toHaveBeenCalledWith(expect.any(String), "a".repeat(64), true, {
      ...scope,
      name: "checkout-context",
    });
    expect(x.repo.guard.mock.calls[0]![3] as unknown[]).toHaveLength(2);
  });
});
