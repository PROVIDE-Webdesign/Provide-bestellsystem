import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("@/lib/session.js", () => ({
  dashboardAccessToken: vi
    .fn()
    .mockResolvedValue({ status: "authenticated", accessToken: "header.payload.signature" }),
}));
vi.mock("@/lib/gateway.js", () => ({
  readProvideAdminBody: vi.fn().mockResolvedValue({ action: "read" }),
  fetchProvideAdmin: vi.fn().mockResolvedValue(new Response("{}")),
}));
import { POST } from "./route.js";
import { dashboardAccessToken } from "@/lib/session.js";
import { fetchProvideAdmin } from "@/lib/gateway.js";
const request = (origin = "https://dashboard.test", suffix = "") =>
  new Request("https://dashboard.test/api/provide" + suffix, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: '{"action":"read"}',
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DASHBOARD_AUTH_ENABLED", "true");
  vi.stubEnv("PROVIDE_ADMIN_ENABLED", "true");
  vi.stubEnv("DASHBOARD_API_BASE_URL", "https://api.test");
});
describe("same-origin PROVIDE server gateway", () => {
  it("rejects foreign origin and URL input before session access", async () => {
    expect((await POST(request("https://attacker.test"))).status).toBe(400);
    expect((await POST(request("https://dashboard.test", "?actor=other"))).status).toBe(400);
    expect(dashboardAccessToken).not.toHaveBeenCalled();
    expect(fetchProvideAdmin).not.toHaveBeenCalled();
  });
  it("uses only the server session token", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(fetchProvideAdmin).toHaveBeenCalledWith("header.payload.signature", "https://api.test", {
      action: "read",
    });
  });
  it("requires explicit administration enablement", async () => {
    vi.stubEnv("PROVIDE_ADMIN_ENABLED", "false");
    expect((await POST(request())).status).toBe(503);
    expect(dashboardAccessToken).not.toHaveBeenCalled();
  });
});
