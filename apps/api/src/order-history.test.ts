import { describe, it, expect, vi } from "vitest";
import raw from "../../../fixtures/order-history.json" with { type: "json" };
import { handleOrderHistory, dispatchGuestPurge } from "./order-history.js";
import { createApiWorker } from "./index.js";
import { routeRequest } from "./router.js";
const scope = { restaurantId: raw.restaurantId, locationId: raw.locationId };
const base = `https://api.test/v1/dashboard/restaurants/${scope.restaurantId}/locations/${scope.locationId}/history`;
const env = {
  APP_ENV: "test",
  DASHBOARD_AUTH_ENABLED: "true",
  DASHBOARD_HISTORY_ENABLED: "true",
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "synthetic" },
  SUPABASE_AUTH_ISSUER: "https://project.supabase.co/auth/v1",
  SUPABASE_AUTH_AUDIENCE: "authenticated",
};
const identity = { userId: "f1000000-0000-0000-0000-000000000001", aal: "aal2" as const };
const request = (q: unknown = {}) =>
  new Request(base, {
    method: "POST",
    headers: {
      authorization: "Bearer header.payload.signature",
      "content-type": "application/json",
    },
    body: JSON.stringify(q),
  });
const repository = () => vi.fn().mockResolvedValue({ outcome: "allowed", data: raw });
const run = (
  req = request(),
  reader = repository(),
  settings = env,
  verifier = { verify: vi.fn().mockResolvedValue(identity) },
) =>
  handleOrderHistory(
    req,
    scope,
    settings,
    verifier,
    reader,
    { requestId: "synthetic" },
    { error: vi.fn() },
    new Headers(),
  );
describe("verified history and retention API", () => {
  it("routes only read-only POST, never query strings containing names", async () => {
    expect(routeRequest(request())?.name).toBe("dashboardHistory");
    expect(routeRequest(new Request(base))).toBeUndefined();
    expect(
      (await run(new Request(base + "?customerName=Synthetic", { method: "POST", body: "{}" })))
        .status,
    ).toBe(400);
  });
  it("passes only verified actor and scope and bounded trimmed input", async () => {
    const reader = repository();
    expect((await run(request({ customerName: "  Synthetic  " }), reader)).status).toBe(200);
    expect(reader).toHaveBeenCalledWith(
      "synthetic",
      identity,
      scope.restaurantId,
      scope.locationId,
      { customerName: "Synthetic" },
    );
  });
  it.each([
    { DASHBOARD_HISTORY_ENABLED: "false" },
    { HYPERDRIVE_CACHE_DISABLED: "false" },
    { DASHBOARD_AUTH_ENABLED: "false" },
  ])("fails closed %j", async (patch) => {
    const reader = repository();
    expect((await run(request(), reader, { ...env, ...patch })).status).toBe(503);
    expect(reader).not.toHaveBeenCalled();
  });
  it("does not accept forged actor or excessive bodies", async () => {
    expect((await run(request({ actor: identity.userId }))).status).toBe(400);
    expect((await run(request({ customerName: "a".repeat(2200) }))).status).toBe(413);
  });
  it("requires MFA and reprojects same-scope response", async () => {
    expect(
      (
        await run(request(), repository(), env, {
          verify: vi.fn().mockResolvedValue({ ...identity, aal: "aal1" }),
        })
      ).status,
    ).toBe(403);
    for (const data of [
      { ...raw, locationId: "f3000000-0000-0000-0000-000000000002" },
      { ...raw, secret: "leak" },
    ])
      expect(
        (await run(request(), vi.fn().mockResolvedValue({ outcome: "allowed", data }))).status,
      ).toBe(503);
  });
  it.each([
    ["forbidden", 403],
    ["invalid", 400],
    ["not_found", 404],
  ])("maps %s", async (outcome, status) =>
    expect((await run(request(), vi.fn().mockResolvedValue({ outcome }))).status).toBe(status),
  );
  it("worker wires history and scheduled purge without changing earlier injections", async () => {
    const reader = repository(),
      purge = vi.fn().mockResolvedValue(0),
      logger = { error: vi.fn() };
    const worker = createApiWorker(
      undefined,
      logger,
      undefined,
      undefined,
      undefined,
      { verify: vi.fn().mockResolvedValue(identity) },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      reader,
      purge,
    );
    expect((await worker.fetch(request(), env)).status).toBe(200);
    const pending: Promise<unknown>[] = [];
    worker.scheduled({} as ScheduledController, { ...env, GUEST_RETENTION_PURGE_ENABLED: "true" }, {
      waitUntil(p: Promise<unknown>) {
        pending.push(p);
      },
    } as ExecutionContext);
    await Promise.all(pending);
    expect(purge).toHaveBeenCalledWith("synthetic");
  });
  it("purge is gated and logs only a fixed error code on failure", async () => {
    const purge = vi.fn().mockRejectedValue(Error("private customer content")),
      logger = { error: vi.fn() };
    await dispatchGuestPurge(env, logger, purge);
    expect(purge).not.toHaveBeenCalled();
    await dispatchGuestPurge({ ...env, GUEST_RETENTION_PURGE_ENABLED: "true" }, logger, purge);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({}),
      "guest_retention_purge_failed",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private customer");
  });
});
