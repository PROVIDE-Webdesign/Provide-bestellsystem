import { describe, expect, it, vi } from "vitest";
import { createApiWorker } from "./index.js";
import { createStatusAccessToken } from "./status-token.js";

const base = "https://api.example.test/v1/storefront/restaurant-a/location-a/order-status";
const scope = { restaurantSlug: "restaurant-a", locationSlug: "location-a" };
const orderId = "fa000000-0000-0000-0000-000000000001";
const secret = "current-synthetic-status-secret-at-least-32-bytes";
const previous = "previous-synthetic-status-secret-at-least-32-bytes";
const status = {
  orderId,
  status: "ready",
  fulfillmentType: "pickup",
  paymentCollectionMode: "on_fulfillment",
  requestedFor: "2026-09-15T12:00:00.000Z",
  currency: "EUR",
  totalAmountMinor: 2500,
  itemCount: 2,
  updatedAt: "2026-09-15T11:30:00.000Z",
  statusAvailableUntil: "2026-09-17T12:00:00.000Z",
};
const env = {
  APP_ENV: "test",
  ORDER_STATUS_READ_ENABLED: "true",
  ORDER_STATUS_TOKEN_SECRET: secret,
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "postgresql://synthetic.invalid/db" },
};

function request(token: string, value: Record<string, unknown> = {}) {
  return new Request(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, statusAccessToken: token, ...value }),
  });
}

describe("public order status API", () => {
  it("returns only the allowlisted status after capability verification", async () => {
    const token = await createStatusAccessToken(secret, scope, orderId);
    const reader = { read: vi.fn().mockResolvedValue({ ...status, contactName: "hidden" }) };
    const logger = { error: vi.fn() };
    const worker = createApiWorker(vi.fn(), logger, undefined, undefined, reader);
    const response = await worker.fetch(request(token), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("hidden");
    expect(reader.read).toHaveBeenCalledWith(env.HYPERDRIVE.connectionString, scope, orderId);
  });

  it("uses one 404 boundary for invalid, cross-scope and unknown capabilities", async () => {
    const token = await createStatusAccessToken(secret, scope, orderId);
    const tampered = `${token.startsWith("A") ? "B" : "A"}${token.slice(1)}`;
    const reader = { read: vi.fn().mockResolvedValue(null) };
    const worker = createApiWorker(vi.fn(), { error: vi.fn() }, undefined, undefined, reader);
    expect((await worker.fetch(request(tampered), env)).status).toBe(404);
    expect(reader.read).not.toHaveBeenCalled();
    expect((await worker.fetch(request(token), env)).status).toBe(404);
  });

  it("accepts the previous secret during rotation", async () => {
    const token = await createStatusAccessToken(previous, scope, orderId);
    const reader = { read: vi.fn().mockResolvedValue(status) };
    const worker = createApiWorker(vi.fn(), { error: vi.fn() }, undefined, undefined, reader);
    expect(
      (
        await worker.fetch(request(token), {
          ...env,
          ORDER_STATUS_TOKEN_SECRET_PREVIOUS: previous,
        })
      ).status,
    ).toBe(200);
  });

  it("fails closed on configuration and bounds the request before SQL", async () => {
    const token = await createStatusAccessToken(secret, scope, orderId);
    const reader = { read: vi.fn() };
    const worker = createApiWorker(vi.fn(), { error: vi.fn() }, undefined, undefined, reader);
    expect(
      (await worker.fetch(request(token), { ...env, ORDER_STATUS_READ_ENABLED: "false" })).status,
    ).toBe(503);
    expect(
      (
        await worker.fetch(
          new Request(base, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orderId, statusAccessToken: token, padding: "x".repeat(5000) }),
          }),
          env,
        )
      ).status,
    ).toBe(413);
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("hides database details and logs no capability", async () => {
    const token = await createStatusAccessToken(secret, scope, orderId);
    const logger = { error: vi.fn() };
    const reader = { read: vi.fn().mockRejectedValue(new Error(token)) };
    const worker = createApiWorker(vi.fn(), logger, undefined, undefined, reader);
    const response = await worker.fetch(request(token), env);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(token);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(token);
  });
});
