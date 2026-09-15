import { describe, expect, it, vi } from "vitest";

import { createApiWorker } from "./index.js";
import { InvalidDashboardTokenError } from "./dashboard-auth.js";
import type { DashboardOrdersReader } from "./dashboard-orders.js";

const restaurantId = "f2000000-0000-0000-0000-000000000001";
const locationId = "f3000000-0000-0000-0000-000000000001";
const orderId = "fa000000-0000-0000-0000-000000000001";
const token = "header.payload.signature";
const base = `https://api.test/v1/dashboard/restaurants/${restaurantId}/locations/${locationId}/orders`;
const env = {
  APP_ENV: "test",
  DASHBOARD_AUTH_ENABLED: "true",
  DASHBOARD_ORDER_OPERATIONS_ENABLED: "true",
  SUPABASE_AUTH_ISSUER: "https://project.supabase.co/auth/v1",
  SUPABASE_AUTH_AUDIENCE: "authenticated",
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "postgresql://synthetic.invalid/db" },
};
const identity = { userId: "f1000000-0000-0000-0000-000000000001", aal: "aal2" as const };
const summary = {
  orderId,
  status: "submitted",
  fulfillmentType: "pickup",
  paymentCollectionMode: "on_fulfillment",
  requestedFor: "2026-09-15T18:00:00.000Z",
  currency: "EUR",
  totalAmountMinor: 2500,
  itemCount: 2,
  updatedAt: "2026-09-15T16:00:00.000Z",
  allowedTransitions: ["accepted", "rejected", "cancelled"],
};

function authorized(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(url, { ...init, headers });
}

function worker(
  reader: Partial<DashboardOrdersReader>,
  verifier = { verify: vi.fn().mockResolvedValue(identity) },
) {
  const completeReader: DashboardOrdersReader = {
    list: reader.list ?? (() => Promise.resolve(undefined)),
    detail: reader.detail ?? (() => Promise.resolve(undefined)),
    transition: reader.transition ?? (() => Promise.resolve(undefined)),
  };
  return createApiWorker(
    vi.fn(),
    { error: vi.fn() },
    undefined,
    undefined,
    undefined,
    verifier,
    undefined,
    completeReader,
  );
}

describe("dashboard order API", () => {
  it("returns a bounded authorized location queue", async () => {
    const list = vi.fn().mockResolvedValue({
      outcome: "allowed",
      data: { restaurantId, locationId, orders: [summary], nextCursor: null },
    });
    const response = await worker({ list }).fetch(
      authorized(`${base}?status=submitted&limit=25`),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(list).toHaveBeenCalledWith(
      env.HYPERDRIVE.connectionString,
      identity,
      { restaurantId, locationId },
      { status: "submitted", cursor: undefined, limit: 25 },
    );
  });

  it("maps location denial without exposing database details", async () => {
    const response = await worker({
      list: vi.fn().mockResolvedValue({ outcome: "forbidden" }),
    }).fetch(authorized(base), env);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it("rejects unknown filters and a disabled feature before SQL", async () => {
    const list = vi.fn();
    expect((await worker({ list }).fetch(authorized(`${base}?unknown=1`), env)).status).toBe(400);
    expect(
      (
        await worker({ list }).fetch(authorized(base), {
          ...env,
          DASHBOARD_ORDER_OPERATIONS_ENABLED: "false",
        })
      ).status,
    ).toBe(503);
    expect(list).not.toHaveBeenCalled();
  });

  it("requires a valid bearer identity", async () => {
    const verifier = { verify: vi.fn().mockRejectedValue(new InvalidDashboardTokenError()) };
    const response = await worker({}, verifier).fetch(authorized(base), env);
    expect(response.status).toBe(401);
  });

  it("updates status with an expected-state guard and maps stale writes", async () => {
    const transition = vi
      .fn()
      .mockResolvedValueOnce({
        outcome: "updated",
        data: { orderId, status: "accepted", updatedAt: summary.updatedAt },
      })
      .mockResolvedValueOnce({ outcome: "conflict" });
    const request = () =>
      authorized(`${base}/${orderId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedStatus: "submitted", targetStatus: "accepted" }),
      });
    expect((await worker({ transition }).fetch(request(), env)).status).toBe(200);
    expect((await worker({ transition }).fetch(request(), env)).status).toBe(409);
  });

  it("rejects invalid transitions before the database", async () => {
    const transition = vi.fn();
    const response = await worker({ transition }).fetch(
      authorized(`${base}/${orderId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedStatus: "ready", targetStatus: "accepted" }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(transition).not.toHaveBeenCalled();
  });
});
