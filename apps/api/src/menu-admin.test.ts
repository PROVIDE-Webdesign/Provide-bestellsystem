import { describe, it, expect, vi } from "vitest";
import { handleMenuAdmin } from "./menu-admin.js";
import { routeRequest } from "./router.js";
import { InvalidDashboardTokenError } from "./dashboard-auth.js";
const scope = {
  restaurantId: "f2000000-0000-0000-0000-000000000001",
  locationId: "f3000000-0000-0000-0000-000000000001",
};
const base = `https://api.test/v1/dashboard/restaurants/${scope.restaurantId}/locations/${scope.locationId}/menu`;
const env = {
  DASHBOARD_AUTH_ENABLED: "true",
  DASHBOARD_MENU_ENABLED: "true",
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "synthetic" },
  SUPABASE_AUTH_ISSUER: "https://project.supabase.co/auth/v1",
  SUPABASE_AUTH_AUDIENCE: "authenticated",
};
const identity = { userId: "f1000000-0000-0000-0000-000000000001", aal: "aal2" as const };
const state = { timezone: "Europe/Berlin", stops: [], menus: [] };
const request = (body?: unknown) =>
  new Request(base, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: "Bearer header.payload.signature",
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const run = (
  req: Request,
  repository = vi.fn().mockResolvedValue({ outcome: "allowed", data: state }),
  verifier = { verify: vi.fn().mockResolvedValue(identity) },
  settings = env,
) =>
  handleMenuAdmin(
    req,
    scope,
    settings,
    verifier,
    repository,
    { requestId: "synthetic" },
    { error: vi.fn() },
    new Headers(),
  );
describe("verified menu editor API", () => {
  it("routes only GET and POST", () => {
    expect(routeRequest(request())?.name).toBe("dashboardMenu");
    expect(routeRequest(request({}))?.name).toBe("dashboardMenu");
    expect(routeRequest(new Request(base, { method: "DELETE" }))).toBeUndefined();
  });
  it("passes verified identity and scoped command to SQL and projects the response", async () => {
    const repository = vi
      .fn()
      .mockResolvedValue({ outcome: "allowed", data: { ...state, secret: "discard" } });
    const cmd = { action: "create_menu", name: "Synthetic", slug: "synthetic" };
    const r = await run(request(cmd), repository);
    expect(r.status).toBe(200);
    expect(repository).toHaveBeenCalledWith(
      "synthetic",
      identity,
      scope.restaurantId,
      scope.locationId,
      cmd,
    );
    expect(await r.text()).not.toContain("discard");
  });
  it("requires gates, a verified bearer and MFA before accessing SQL", async () => {
    const repo = vi.fn();
    expect(
      (await run(request(), repo, undefined, { ...env, DASHBOARD_MENU_ENABLED: "false" })).status,
    ).toBe(503);
    expect((await run(new Request(base), repo)).status).toBe(401);
    expect(
      (
        await run(request(), repo, {
          verify: vi.fn().mockResolvedValue({ ...identity, aal: "aal1" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await run(request(), repo, {
          verify: vi.fn().mockRejectedValue(new InvalidDashboardTokenError()),
        })
      ).status,
    ).toBe(401);
    expect(repo).not.toHaveBeenCalled();
  });
  it.each([
    ["forbidden", 403],
    ["conflict", 409],
    ["invalid", 400],
  ])("maps SQL %s without leaking details", async (outcome, status) => {
    expect(
      (await run(request(), vi.fn().mockResolvedValue({ outcome, data: "private" }))).status,
    ).toBe(status);
  });
  it("rejects actor injection, oversized and malformed commands", async () => {
    const repo = vi.fn();
    expect(
      (
        await run(
          request({
            action: "create_menu",
            name: "Synthetic",
            slug: "synthetic",
            actorUserId: identity.userId,
          }),
          repo,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await run(
          new Request(base, {
            method: "POST",
            headers: {
              authorization: "Bearer header.payload.signature",
              "content-type": "application/json",
            },
            body: " ".repeat(512 * 1024 + 1),
          }),
          repo,
        )
      ).status,
    ).toBe(413);
    expect(repo).not.toHaveBeenCalled();
  });
});
