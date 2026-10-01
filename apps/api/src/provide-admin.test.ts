import { describe, it, expect, vi } from "vitest";
import raw from "../../../fixtures/provide-admin.json" with { type: "json" };
import { handleProvideAdmin } from "./provide-admin.js";
import { routeRequest } from "./router.js";
const env = {
  DASHBOARD_AUTH_ENABLED: "true",
  PROVIDE_ADMIN_ENABLED: "true",
  PROVIDE_ADMIN_LIVE_ENABLED: "false",
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "synthetic" },
  SUPABASE_AUTH_ISSUER: "https://project.supabase.co/auth/v1",
  SUPABASE_AUTH_AUDIENCE: "authenticated",
};
const identity = { userId: "f1000000-0000-0000-0000-000000000001", aal: "aal2" as const };
const request = (
  q: unknown = { action: "read", restaurantId: raw.selected.restaurantId },
  url = "https://api.test/v1/provide/administration",
) =>
  new Request(url, {
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
  handleProvideAdmin(
    req,
    settings,
    verifier,
    reader,
    { requestId: "synthetic" },
    { error: vi.fn() },
    new Headers(),
  );
describe("separate verified PROVIDE API", () => {
  it("routes separately and passes only the verified actor", async () => {
    expect(routeRequest(request())?.name).toBe("provideAdmin");
    const reader = repository();
    const response = await run(request(), reader);
    expect(response.status).toBe(200);
    expect(reader).toHaveBeenCalledWith(
      "synthetic",
      identity,
      { action: "read", restaurantId: raw.selected.restaurantId },
      false,
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each([
    { PROVIDE_ADMIN_ENABLED: "false" },
    { DASHBOARD_AUTH_ENABLED: "false" },
    { HYPERDRIVE_CACHE_DISABLED: "false" },
  ])("fails closed %j", async (patch) => {
    const reader = repository();
    expect((await run(request(), reader, { ...env, ...patch })).status).toBe(503);
    expect(reader).not.toHaveBeenCalled();
  });
  it("rejects MFA downgrade, forgery and query strings before database writes", async () => {
    const reader = repository();
    expect(
      (
        await run(request(), reader, env, {
          verify: vi.fn().mockResolvedValue({ ...identity, aal: "aal1" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await run(request({ action: "read", actorUserId: identity.userId }), reader)).status,
    ).toBe(400);
    expect(
      (await run(request({}, "https://api.test/v1/provide/administration?actor=other"), reader))
        .status,
    ).toBe(400);
    expect(reader).not.toHaveBeenCalled();
  });
  it.each([
    ["forbidden", 403],
    ["conflict", 409],
    ["invalid", 400],
    ["not_found", 404],
  ] as const)("maps %s without exposing internal state", async (outcome, status) => {
    const response = await run(
      request(),
      vi.fn().mockResolvedValue({ outcome, data: { secret: "internal" } }),
    );
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("internal");
  });
  it("rejects foreign-scope and malformed repository projections", async () => {
    for (const data of [
      { ...raw, selected: { ...raw.selected, restaurantId: identity.userId } },
      { ...raw, secret: true },
    ])
      expect(
        (await run(request(), vi.fn().mockResolvedValue({ outcome: "allowed", data }))).status,
      ).toBe(503);
  });
  it("blocks live activation even with a verified PROVIDE identity", async () => {
    const reader = repository();
    expect(
      (
        await run(
          request({
            action: "goLive",
            restaurantId: raw.selected.restaurantId,
            locationId: null,
            expectedRevision: 10,
            requestId: identity.userId,
            reason: "Synthetic review",
            status: "live",
            confirmation: raw.selected.slug,
          }),
          reader,
        )
      ).status,
    ).toBe(503);
    expect(reader).not.toHaveBeenCalled();
  });
});
