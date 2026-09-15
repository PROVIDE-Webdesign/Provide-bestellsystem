import { describe, expect, it, vi } from "vitest";
import { createApiWorker } from "./index.js";

const url =
  "https://api.example.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte/orders";
const body = {
  menuId: "f4000000-0000-0000-0000-000000000001",
  menuVersionId: "f5000000-0000-0000-0000-000000000001",
  requestedFor: "2026-09-15T12:00:00Z",
  lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 2 }],
  submissionKey: "2b18f416-9476-4ce8-b721-a1346f78e978",
  customer: { contactName: "Synthetic Guest", phoneE164: "+999100000001", email: null },
  privacyNoticeVersion: "preview-v1",
};
const env = {
  APP_ENV: "test",
  CHECKOUT_WRITE_ENABLED: "true",
  CHECKOUT_PRIVACY_NOTICE_VERSION: "preview-v1",
  CHECKOUT_RETENTION_DAYS: "30",
  ORDER_STATUS_READ_ENABLED: "true",
  ORDER_STATUS_TOKEN_SECRET: "synthetic-checkout-status-secret-at-least-32-bytes",
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "postgresql://synthetic.invalid/db" },
};
const confirmation = {
  orderId: "fa000000-0000-0000-0000-000000000001",
  status: "submitted",
  fulfillmentType: "pickup",
  paymentCollectionMode: "on_fulfillment",
  requestedFor: "2026-09-15T12:00:00Z",
  currency: "EUR",
  totalAmountMinor: 2500,
  itemCount: 2,
};
const request = (
  value: unknown = body,
  headers: HeadersInit = { "content-type": "application/json" },
) => new Request(url, { method: "POST", headers, body: JSON.stringify(value) });

describe("guest pickup checkout API", () => {
  it("submits only normalized values and returns an allowlisted confirmation", async () => {
    const writer = { submit: vi.fn().mockResolvedValue({ ...confirmation, internal: "hidden" }) };
    const worker = createApiWorker(vi.fn(), { error: vi.fn() }, undefined, writer);
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(201);
    expect(writer.submit).toHaveBeenCalledWith(
      env.HYPERDRIVE.connectionString,
      expect.objectContaining({
        restaurantSlug: "storefront-restaurant-a",
        locationSlug: "storefront-a-mitte",
        customer: body.customer,
      }),
      30,
    );
    const text = await response.text();
    expect(text).not.toContain("hidden");
    const payload = JSON.parse(text) as {
      data?: { statusAccessToken?: unknown; statusAvailableUntil?: unknown };
    };
    expect(payload.data?.statusAccessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(payload.data?.statusAvailableUntil).toBe("2026-09-17T12:00:00.000Z");
  });

  it("fails closed unless every server-side write setting is explicit", async () => {
    const writer = { submit: vi.fn() };
    const worker = createApiWorker(vi.fn(), { error: vi.fn() }, undefined, writer);
    for (const unsafe of [
      { ...env, CHECKOUT_WRITE_ENABLED: "false" },
      { ...env, HYPERDRIVE_CACHE_DISABLED: "false" },
      { ...env, CHECKOUT_PRIVACY_NOTICE_VERSION: "" },
      { ...env, CHECKOUT_RETENTION_DAYS: "731" },
      { ...env, ORDER_STATUS_READ_ENABLED: "false" },
      { ...env, ORDER_STATUS_TOKEN_SECRET: "short" },
      {
        APP_ENV: "test",
        CHECKOUT_WRITE_ENABLED: "true",
        CHECKOUT_PRIVACY_NOTICE_VERSION: "preview-v1",
        CHECKOUT_RETENTION_DAYS: "30",
        HYPERDRIVE_CACHE_DISABLED: "true",
      },
    ])
      expect((await worker.fetch(request(), unsafe)).status).toBe(503);
    expect(writer.submit).not.toHaveBeenCalled();
  });

  it("rejects unsupported fields, notice mismatches and invalid media types before SQL", async () => {
    const writer = { submit: vi.fn() };
    const worker = createApiWorker(vi.fn(), { error: vi.fn() }, undefined, writer);
    expect((await worker.fetch(request({ ...body, price: 1 }), env)).status).toBe(400);
    expect(
      (await worker.fetch(request({ ...body, privacyNoticeVersion: "old" }), env)).status,
    ).toBe(400);
    expect((await worker.fetch(request(body, { "content-type": "text/plain" }), env)).status).toBe(
      415,
    );
    expect(writer.submit).not.toHaveBeenCalled();
  });

  it("bounds request bodies before parsing", async () => {
    const writer = { submit: vi.fn() };
    const worker = createApiWorker(vi.fn(), { error: vi.fn() }, undefined, writer);
    const response = await worker.fetch(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, padding: "x".repeat(70_000) }),
      }),
      env,
    );
    expect(response.status).toBe(413);
    expect(writer.submit).not.toHaveBeenCalled();
  });

  it("hides database errors and never logs personal request values", async () => {
    const logger = { error: vi.fn() };
    const writer = {
      submit: vi.fn().mockRejectedValue(new Error("Synthetic Guest +999100000001")),
    };
    const worker = createApiWorker(vi.fn(), logger, undefined, writer);
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("Synthetic Guest");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("999100000001");
  });
});
