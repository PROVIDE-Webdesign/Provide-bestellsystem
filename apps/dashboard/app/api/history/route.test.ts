import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("@/lib/session.js", () => ({
  dashboardAccessToken: vi
    .fn()
    .mockResolvedValue({ status: "authenticated", accessToken: "header.payload.signature" }),
}));
vi.mock("@/lib/gateway.js", () => ({
  readHistoryBody: vi.fn().mockResolvedValue({ customerName: "Synthetic" }),
  fetchOrderHistory: vi.fn().mockResolvedValue(new Response("{}")),
}));
import { POST } from "./route.js";
import { fetchOrderHistory } from "@/lib/gateway.js";
import { dashboardAccessToken } from "@/lib/session.js";
const url =
  "https://dashboard.test/api/history?restaurantId=f2000000-0000-0000-0000-000000000001&locationId=f3000000-0000-0000-0000-000000000001";
const req = (origin = "https://dashboard.test", suffix = "") =>
  new Request(url + suffix, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: '{"customerName":"Synthetic"}',
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DASHBOARD_AUTH_ENABLED", "true");
  vi.stubEnv("DASHBOARD_HISTORY_ENABLED", "true");
  vi.stubEnv("DASHBOARD_API_BASE_URL", "https://api.test");
});
describe("CSRF-protected history route", () => {
  it("rejects cross-site POST and duplicate/unknown scope query before session access", async () => {
    for (const r of [
      req("https://attacker.test"),
      req("https://dashboard.test", "&customerName=Synthetic"),
      req("https://dashboard.test", "&restaurantId=duplicate"),
    ])
      expect((await POST(r)).status).toBe(400);
    expect(dashboardAccessToken).not.toHaveBeenCalled();
    expect(fetchOrderHistory).not.toHaveBeenCalled();
  });
  it("requires feature flag and uses only the server session token", async () => {
    expect((await POST(req())).status).toBe(200);
    expect(fetchOrderHistory).toHaveBeenCalledWith(
      "header.payload.signature",
      "https://api.test",
      expect.any(Object),
      { customerName: "Synthetic" },
    );
    vi.stubEnv("DASHBOARD_HISTORY_ENABLED", "false");
    expect((await POST(req())).status).toBe(503);
  });
});
