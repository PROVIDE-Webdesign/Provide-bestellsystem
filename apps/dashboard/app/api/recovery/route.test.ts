import { beforeEach, it, expect, vi } from "vitest";
vi.mock("@/lib/session.js", () => ({
  dashboardAccessToken: vi
    .fn()
    .mockResolvedValue({ status: "authenticated", accessToken: "synthetic.header.signature" }),
}));
import { POST } from "./route.js";
import { dashboardAccessToken } from "@/lib/session.js";
const id = "a4100000-0000-0000-0000-000000000001",
  command = { action: "read", caseId: id, commandId: id };
const projection = {
  caseId: id,
  kind: "lost_factor",
  state: "requested",
  revision: 1,
  expiresAt: "2026-10-04T01:00:00Z",
  approvalExpiresAt: null,
  requiredApprovals: 1,
};
const req = (origin = "https://dashboard.test", body: unknown = { command }) =>
  new Request("https://dashboard.test/api/recovery", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ACCOUNT_RECOVERY_ENABLED", "true");
  vi.stubEnv("DASHBOARD_AUTH_ENABLED", "true");
  vi.stubEnv("DASHBOARD_API_BASE_URL", "https://api.test");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: projection })));
});
it("rejects cross-origin commands before cookie-session lookup", async () => {
  expect((await POST(req("https://evil.test"))).status).toBe(400);
  expect(dashboardAccessToken).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it("requires explicit enablement and the server-owned bearer", async () => {
  vi.stubEnv("ACCOUNT_RECOVERY_ENABLED", "false");
  expect((await POST(req())).status).toBe(503);
  expect(dashboardAccessToken).not.toHaveBeenCalled();
  vi.stubEnv("ACCOUNT_RECOVERY_ENABLED", "true");
  expect((await POST(req())).status).toBe(200);
  expect(fetch).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({
      cache: "no-store",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer synthetic.header.signature",
        origin: "https://dashboard.test",
      },
    }),
  );
});
it("redacts backend/provider errors and rejects raw authority and oversized bodies", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("provider-secret", { status: 500 }));
  const r = await POST(req());
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("provider-secret");
  vi.mocked(fetch).mockClear();
  expect(
    (await POST(req("https://dashboard.test", { command: { ...command, approved: true } }))).status,
  ).toBe(400);
  expect(
    (await POST(req("https://dashboard.test", { command, unexpected: "x".repeat(5000) }))).status,
  ).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("cancels a chunked oversized body before consuming the remaining stream", async () => {
  let chunks = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        chunks++;
        controller.enqueue(new Uint8Array(2048));
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const request = new Request("https://dashboard.test/api/recovery", {
    method: "POST",
    headers: { origin: "https://dashboard.test", "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
  expect((await POST(request)).status).toBe(400);
  expect(chunks).toBe(3);
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects malformed input and a valid projection belonging to another case", async () => {
  const malformed = req();
  expect((await POST(new Request(malformed, { body: "{" }))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ data: { ...projection, caseId: "a4100000-0000-0000-0000-000000000002" } }),
  );
  expect((await POST(req())).status).toBe(503);
});
