import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("@/lib/session.js", () => ({
  dashboardAccessToken: vi
    .fn()
    .mockResolvedValue({ status: "authenticated", accessToken: "header.payload.signature" }),
}));
vi.mock("@/lib/gateway.js", () => ({
  readSupportBody: vi.fn().mockResolvedValue({ action: "read" }),
  fetchSupport: vi.fn().mockResolvedValue(new Response("{}")),
}));
import { POST } from "./route.js";
import { dashboardAccessToken } from "@/lib/session.js";
import { fetchSupport } from "@/lib/gateway.js";
const req = (origin = "https://dashboard.test", suffix = "") =>
  new Request("https://dashboard.test/api/support" + suffix, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: '{"action":"read"}',
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DASHBOARD_AUTH_ENABLED", "true");
  vi.stubEnv("SUPPORT_CASES_ENABLED", "true");
  vi.stubEnv("DASHBOARD_API_BASE_URL", "https://api.test");
});
describe("O1 server-only support gateway", () => {
  it("rejects CSRF and URL input before session access", async () => {
    expect((await POST(req("https://attacker.test"))).status).toBe(400);
    expect((await POST(req(undefined, "?source=other"))).status).toBe(400);
    expect(dashboardAccessToken).not.toHaveBeenCalled();
    expect(fetchSupport).not.toHaveBeenCalled();
  });
  it("requires its separate disabled-by-default flag", async () => {
    vi.stubEnv("SUPPORT_CASES_ENABLED", "false");
    expect((await POST(req())).status).toBe(503);
    expect(dashboardAccessToken).not.toHaveBeenCalled();
  });
  it("forwards only the server session token", async () => {
    expect((await POST(req())).status).toBe(200);
    expect(fetchSupport).toHaveBeenCalledWith("header.payload.signature", "https://api.test", {
      action: "read",
    });
  });
});
