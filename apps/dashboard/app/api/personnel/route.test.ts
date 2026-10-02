import { beforeEach, it, expect, vi } from "vitest";
vi.mock("@/lib/session.js", () => ({
  dashboardAccessToken: vi
    .fn()
    .mockResolvedValue({ status: "authenticated", accessToken: "header.payload.signature" }),
}));
vi.mock("@/lib/gateway.js", () => ({
  readPersonnelBody: vi.fn().mockResolvedValue({ action: "inbox" }),
  fetchPersonnel: vi.fn().mockResolvedValue(new Response("{}")),
}));
import { POST } from "./route.js";
import { dashboardAccessToken } from "@/lib/session.js";
import { fetchPersonnel } from "@/lib/gateway.js";
const req = (origin = "https://dashboard.test", suffix = "") =>
  new Request("https://dashboard.test/api/personnel" + suffix, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: '{"action":"inbox"}',
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DASHBOARD_AUTH_ENABLED", "true");
  vi.stubEnv("DASHBOARD_PERSONNEL_ENABLED", "true");
  vi.stubEnv("DASHBOARD_API_BASE_URL", "https://api.test");
});
it("rejects foreign origin and URL input before session lookup", async () => {
  expect((await POST(req("https://other.test"))).status).toBe(400);
  expect((await POST(req("https://dashboard.test", "?email=private"))).status).toBe(400);
  expect(dashboardAccessToken).not.toHaveBeenCalled();
});
it("uses server session token only", async () => {
  expect((await POST(req())).status).toBe(200);
  expect(fetchPersonnel).toHaveBeenCalledWith("header.payload.signature", "https://api.test", {
    action: "inbox",
  });
});
it("requires explicit feature enablement", async () => {
  vi.stubEnv("DASHBOARD_PERSONNEL_ENABLED", "false");
  expect((await POST(req())).status).toBe(503);
  expect(dashboardAccessToken).not.toHaveBeenCalled();
});
