import { describe, it, expect, vi, afterEach } from "vitest";
import raw from "../../../fixtures/personnel.json" with { type: "json" };
import {
  handlePersonnel,
  supabasePersonnelInvite,
  type PersonnelEnvironment,
} from "./personnel.js";
const env: PersonnelEnvironment = {
  DASHBOARD_AUTH_ENABLED: "true",
  DASHBOARD_PERSONNEL_ENABLED: "true",
  PERSONNEL_INVITATIONS_ENABLED: "true",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-admin-key",
  PERSONNEL_DASHBOARD_ORIGIN: "https://dashboard.test",
  SUPABASE_AUTH_ISSUER: "https://project.supabase.co/auth/v1",
  SUPABASE_AUTH_AUDIENCE: "authenticated",
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "synthetic" },
};
const identity = { userId: raw.members[0]!.userId, aal: "aal2" as const };
const req = (q: unknown = { action: "read", restaurantId: raw.restaurantId }, suffix = "") =>
  new Request("https://api.test/v1/dashboard/personnel" + suffix, {
    method: "POST",
    headers: {
      authorization: "Bearer header.payload.signature",
      "content-type": "application/json",
    },
    body: JSON.stringify(q),
  });
const repo = () => vi.fn().mockResolvedValue({ outcome: "allowed", data: raw });
const provider = () => vi.fn().mockResolvedValue("sent");
const run = (
  q = req(),
  db = repo(),
  p = provider(),
  settings = env,
  aal: "aal1" | "aal2" = "aal2",
) =>
  handlePersonnel(
    q,
    settings,
    { verify: vi.fn().mockResolvedValue({ ...identity, aal }) },
    db,
    p,
    { requestId: "synthetic" },
    { error: vi.fn() },
    new Headers(),
  );
afterEach(() => vi.unstubAllGlobals());
describe("verified personnel API and Auth adapter", () => {
  it("passes only verified identity, no cache", async () => {
    const db = repo();
    const r = await run(req(), db);
    expect(r.status).toBe(200);
    expect(db).toHaveBeenCalledWith(
      "synthetic",
      identity,
      { action: "read", restaurantId: raw.restaurantId },
      "read",
    );
    expect(r.headers.get("cache-control")).toContain("no-store");
  });
  it.each([
    { DASHBOARD_PERSONNEL_ENABLED: "false" },
    { DASHBOARD_AUTH_ENABLED: "false" },
    { HYPERDRIVE_CACHE_DISABLED: "false" },
  ])("closed environment %j", async (patch) => {
    const db = repo();
    expect((await run(req(), db, provider(), { ...env, ...patch })).status).toBe(503);
    expect(db).not.toHaveBeenCalled();
  });
  it("rejects URL identity, injected actor and aal1 management", async () => {
    const db = repo();
    expect((await run(req(undefined, "?email=private"), db)).status).toBe(400);
    expect(
      (
        await run(
          req({ action: "read", restaurantId: raw.restaurantId, actorUserId: identity.userId }),
          db,
        )
      ).status,
    ).toBe(400);
    expect((await run(req(), db, provider(), env, "aal1")).status).toBe(403);
    expect(db).not.toHaveBeenCalled();
  });
  it("allows own inbox at primary authentication", async () => {
    const db = repo().mockResolvedValue({
      outcome: "allowed",
      data: { mode: "inbox", invitations: [] },
    });
    expect((await run(req({ action: "inbox" }), db, provider(), env, "aal1")).status).toBe(200);
  });
  it.each([
    ["forbidden", 403],
    ["conflict", 409],
    ["not_found", 404],
    ["invalid", 400],
  ] as const)("maps safe outcome %s", async (outcome, status) => {
    expect((await run(req(), repo().mockResolvedValue({ outcome }))).status).toBe(status);
  });
  it("dispatches once only after reservation and claim", async () => {
    const q = {
      action: "invite",
      restaurantId: raw.restaurantId,
      expectedRevision: 10,
      requestId: "aa000000-0000-0000-0000-000000000001",
      reason: "Synthetic invitation review",
      email: "new@example.invalid",
      role: "kitchen",
      locationIds: [raw.locations[0]!.id],
    };
    const db = repo()
      .mockResolvedValueOnce({ outcome: "allowed", data: raw })
      .mockResolvedValueOnce({ email: q.email, existingUserId: null });
    const p = provider();
    expect((await run(req(q), db, p)).status).toBe(200);
    expect(p).toHaveBeenCalledExactlyOnceWith(env, q.email, false);
    expect(db).toHaveBeenLastCalledWith("synthetic", identity, q, "finish", "sent");
    const repeat = repo()
      .mockResolvedValueOnce({ outcome: "allowed", data: raw })
      .mockResolvedValueOnce(null);
    const p2 = provider();
    expect((await run(req(q), repeat, p2)).status).toBe(200);
    expect(p2).not.toHaveBeenCalled();
  });
  it("never calls Auth when authorization or revision fails", async () => {
    const db = repo().mockResolvedValue({ outcome: "forbidden" }),
      p = provider();
    expect((await run(req(), db, p)).status).toBe(403);
    expect(p).not.toHaveBeenCalled();
  });
  it("new and existing Auth links use pinned origin with no role metadata", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", f);
    expect(await supabasePersonnelInvite(env, "new@example.invalid", false)).toBe("sent");
    let [url, init] = f.mock.calls[0]!;
    if (!(url instanceof URL)) throw Error("Expected pinned Auth URL");
    expect(url.pathname).toBe("/auth/v1/invite");
    expect(url.searchParams.get("redirect_to")).toBe("https://dashboard.test/invitations");
    expect(JSON.parse(init!.body as string)).toEqual({ email: "new@example.invalid" });
    await supabasePersonnelInvite(env, "new@example.invalid", true);
    [url, init] = f.mock.calls[1]!;
    if (!(url instanceof URL)) throw Error("Expected pinned Auth URL");
    expect(url.pathname).toBe("/auth/v1/otp");
    expect(JSON.parse(init!.body as string)).toEqual({
      email: "new@example.invalid",
      create_user: false,
    });
  });
  it("ambiguous Auth response is recorded without resend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("timeout")));
    expect(await supabasePersonnelInvite(env, "new@example.invalid", false)).toBe("uncertain");
  });
  it("rejects invalid admin configuration before external request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(
      await supabasePersonnelInvite(
        { ...env, PERSONNEL_DASHBOARD_ORIGIN: "https://attacker.test/path" },
        "new@example.invalid",
        false,
      ),
    ).toBe("failed");
    expect(f).not.toHaveBeenCalled();
  });
});
