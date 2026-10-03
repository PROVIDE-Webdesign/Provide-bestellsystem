import { describe, it, expect, vi } from "vitest";
import { handleAccountRecovery, type RecoveryRepository } from "./account-recovery.js";
const id = "a4100000-0000-0000-0000-000000000001";
const q = { action: "execute", caseId: id, commandId: id, expectedRevision: 3 };
const env = {
  DASHBOARD_AUTH_ENABLED: "true",
  ACCOUNT_RECOVERY_ENABLED: "true",
  ACCOUNT_RECOVERY_ORIGIN: "https://dashboard.test",
  SUPABASE_AUTH_ISSUER: "https://project.supabase.co/auth/v1",
  SUPABASE_AUTH_AUDIENCE: "authenticated",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-only",
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "postgresql://synthetic.invalid/db" },
};
const projection = {
  caseId: id,
  kind: "lost_factor",
  state: "executing",
  revision: 4,
  expiresAt: "2026-10-04T01:00:00Z",
  approvalExpiresAt: "2026-10-03T02:00:00Z",
  requiredApprovals: 2,
};
const request = (
  body: unknown = { command: q },
  origin = env.ACCOUNT_RECOVERY_ORIGIN,
  suffix = "",
) =>
  new Request("https://api.test/v1/account/recovery" + suffix, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer header.payload.signature",
      origin,
    },
    body: JSON.stringify(body),
  });
function fixture(effectClaimed = true) {
  const verifier = {
    verify: vi.fn().mockResolvedValue({ userId: id, aal: "aal2", sessionId: id }),
  };
  const repository: RecoveryRepository = {
    command: vi.fn().mockResolvedValue({ outcome: "allowed", data: projection, effectClaimed }),
    plan: vi.fn().mockResolvedValue({ targetUserId: id, kind: "lost_factor", factorIds: [id] }),
    finish: vi.fn().mockResolvedValue({
      outcome: "allowed",
      data: { ...projection, state: "awaiting_reenrollment", revision: 5 },
    }),
  };
  const provider = vi.fn().mockResolvedValue(undefined),
    logger = { error: vi.fn() };
  const run = (r = request(), e = env) =>
    handleAccountRecovery(
      r,
      e,
      verifier,
      { requestId: id },
      logger,
      new Headers(),
      repository,
      provider,
    );
  return { verifier, repository, provider, logger, run };
}
describe("recovery external-effect boundary", () => {
  it("requires explicit enablement, uncached DB and exact Origin before any operation", async () => {
    const f = fixture();
    for (const e of [
      { ...env, ACCOUNT_RECOVERY_ENABLED: "false" },
      { ...env, HYPERDRIVE_CACHE_DISABLED: "false" },
    ])
      expect((await f.run(request(), e)).status).toBe(503);
    expect((await f.run(request({ command: q }, "https://evil.test"))).status).toBe(400);
    expect(
      (await f.run(request({ command: q }, env.ACCOUNT_RECOVERY_ORIGIN, "?redirect=evil"))).status,
    ).toBe(400);
    expect(f.verifier.verify).not.toHaveBeenCalled();
    expect(f.repository.command).not.toHaveBeenCalled();
  });
  it("does not repeat provider mutations when a command is replayed", async () => {
    const f = fixture(false);
    const r = await f.run();
    expect(r.status).toBe(200);
    expect(f.provider).not.toHaveBeenCalled();
    expect(f.repository.finish).toHaveBeenCalledOnce();
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("rechecks current authority before each provider mutation and reconciles lost responses", async () => {
    const f = fixture();
    f.provider.mockRejectedValue(Error("Sensitive provider details must never leave the boundary"));
    const r = await f.run();
    expect(r.status).toBe(200);
    expect(f.repository.plan).toHaveBeenCalledTimes(2);
    expect(f.provider).toHaveBeenCalledOnce();
    expect(f.repository.finish).toHaveBeenCalledOnce();
    expect(f.logger.error).not.toHaveBeenCalled();
    expect(await r.text()).not.toContain("Sensitive");
  });
  it("withholds effects when permission changes after claim and keeps partial state blocked", async () => {
    const f = fixture();
    vi.mocked(f.repository.plan).mockResolvedValue(null);
    vi.mocked(f.repository.finish).mockResolvedValue({
      outcome: "allowed",
      data: { ...projection, state: "needs_review" },
    });
    const r = await f.run();
    expect(r.status).toBe(200);
    expect(f.provider).not.toHaveBeenCalled();
    expect(await r.text()).toContain("needs_review");
  });
  it("never carries a transient password into commands, receipts or error logs", async () => {
    const f = fixture();
    const password = "Synthetic-secret-password";
    vi.mocked(f.repository.command).mockRejectedValue(Error(password));
    const r = await f.run(request({ command: { ...q, action: "begin_password" }, password }));
    expect(r.status).toBe(503);
    expect(f.repository.command).toHaveBeenCalledWith(
      env.HYPERDRIVE.connectionString,
      expect.anything(),
      { ...q, action: "begin_password" },
    );
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain(password);
    expect(await r.text()).not.toContain(password);
  });
});
