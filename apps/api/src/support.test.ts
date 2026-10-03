import { describe, it, expect, vi } from "vitest";
import raw from "../../../fixtures/support.json" with { type: "json" };
import { handleSupport } from "./support.js";
import { routeRequest } from "./router.js";
const env = {
  SUPPORT_CASES_ENABLED: "true",
  DASHBOARD_AUTH_ENABLED: "true",
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "synthetic" },
  SUPABASE_AUTH_ISSUER: "https://project.supabase.co/auth/v1",
  SUPABASE_AUTH_AUDIENCE: "authenticated",
};
const identity = {
  userId: "f1000000-0000-0000-0000-000000000001",
  sessionId: "f1000000-0000-0000-0000-000000000001",
  aal: "aal2",
};
const command = {
  action: "read",
  restaurantId: raw.restaurantId,
  locationId: raw.locationId,
  cursor: null,
  caseId: null,
};
const request = (q: unknown = command, url = "https://api.test/v1/provide/support", token = true) =>
  new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer header.payload.signature" } : {}),
    },
    body: JSON.stringify(q),
  });
const repository = () => vi.fn().mockResolvedValue({ outcome: "allowed", data: raw });
const run = (req = request(), repo = repository(), settings = env, actor = identity) =>
  handleSupport(
    req,
    settings,
    { verify: vi.fn().mockResolvedValue(actor) },
    repo,
    { requestId: "synthetic" },
    { error: vi.fn() },
    new Headers(),
  );
describe("O1 support API boundary", () => {
  it("uses verified actor and no-store projection on a separate route", async () => {
    const repo = repository();
    const res = await run(request(), repo);
    expect(res.status).toBe(200);
    expect(routeRequest(request())?.name).toBe("support");
    expect(repo).toHaveBeenCalledWith("synthetic", identity, command);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
  it.each([
    { SUPPORT_CASES_ENABLED: "false" },
    { SUPPORT_CASES_ENABLED: "" },
    { DASHBOARD_AUTH_ENABLED: "false" },
    { HYPERDRIVE_CACHE_DISABLED: "false" },
  ])("fails closed %j", async (patch) => {
    const repo = repository();
    expect((await run(request(), repo, { ...env, ...patch })).status).toBe(503);
    expect(repo).not.toHaveBeenCalled();
  });
  it("rejects no login, AAL1, missing provider session and actor spoofing", async () => {
    const repo = repository();
    expect((await run(request(command, undefined, false), repo)).status).toBe(401);
    expect((await run(request(), repo, env, { ...identity, aal: "aal1" })).status).toBe(403);
    expect((await run(request(), repo, env, { ...identity, sessionId: "" })).status).toBe(403);
    expect((await run(request({ ...command, actorUserId: identity.userId }), repo)).status).toBe(
      400,
    );
    expect(
      (await run(request(command, "https://api.test/v1/provide/support?source=other"), repo))
        .status,
    ).toBe(400);
    expect(repo).not.toHaveBeenCalled();
  });
  it.each([
    ["forbidden", 403],
    ["conflict", 409],
    ["invalid", 400],
    ["not_found", 404],
  ] as const)("maps %s without leaking private data", async (outcome, status) => {
    const r = await run(
      request(),
      vi.fn().mockResolvedValue({ outcome, data: { secret: "private" } }),
    );
    expect(r.status).toBe(status);
    expect(await r.text()).not.toContain("private");
  });
  it("rejects foreign scope, accidental PII and invalid database replies", async () => {
    for (const data of [
      { ...raw, restaurantId: identity.userId },
      { ...raw, locationId: identity.userId },
      { ...raw, email: "guest@example.invalid" },
      null,
    ])
      expect(
        (await run(request(), vi.fn().mockResolvedValue({ outcome: "allowed", data }))).status,
      ).toBe(503);
  });
  it("forbids payment, refund, email and Auth commands without invoking storage", async () => {
    const repo = repository();
    for (const action of [
      "processOnlinePayment",
      "dispatchOnlinePayments",
      "retry_online_refund",
      "dispatchEmailNotifications",
      "send",
      "lookup",
      "recover",
      "confirm_payment",
    ])
      expect((await run(request({ ...command, action }), repo)).status).toBe(400);
    expect(repo).not.toHaveBeenCalled();
  });
});
