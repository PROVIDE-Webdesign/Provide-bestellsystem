import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session.js", () => ({ dashboardAccessToken: vi.fn() }));
vi.mock("@/lib/gateway.js", () => ({ fetchDashboardAcceptance: vi.fn() }));
import { dashboardAccessToken } from "@/lib/session.js";
import { fetchDashboardAcceptance } from "@/lib/gateway.js";
import { GET } from "./route.js";
const query =
  "restaurantId=f2000000-0000-0000-0000-000000000001&locationId=f3000000-0000-0000-0000-000000000001";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function enable() {
  for (const key of [
    "DASHBOARD_AUTH_ENABLED",
    "DASHBOARD_ORDER_OPERATIONS_ENABLED",
    "DASHBOARD_ORDER_ALERTS_ENABLED",
  ])
    vi.stubEnv(key, "true");
}
describe("same-origin order alert gateway", () => {
  it("requires explicit activation without probing a session", async () => {
    expect(
      (await GET(new Request(`https://dashboard.test/api/order-alerts?${query}`))).status,
    ).toBe(503);
    expect(dashboardAccessToken).not.toHaveBeenCalled();
  });
  it("rejects hidden filter and duplicate scope parameters", async () => {
    enable();
    for (const suffix of ["&status=accepted", "&locationId=x"]) {
      expect(
        (await GET(new Request(`https://dashboard.test/api/order-alerts?${query}${suffix}`)))
          .status,
      ).toBe(400);
    }
    expect(dashboardAccessToken).not.toHaveBeenCalled();
  });
  it("requires a session and forwards only validated scope", async () => {
    enable();
    vi.mocked(dashboardAccessToken).mockResolvedValueOnce({ status: "unauthorized" });
    expect(
      (await GET(new Request(`https://dashboard.test/api/order-alerts?${query}`))).status,
    ).toBe(401);
    vi.mocked(dashboardAccessToken).mockResolvedValueOnce({
      status: "authenticated",
      accessToken: "test.jwt.token",
    });
    vi.mocked(fetchDashboardAcceptance).mockResolvedValueOnce(Response.json({ data: {} }));
    expect(
      (await GET(new Request(`https://dashboard.test/api/order-alerts?${query}`))).status,
    ).toBe(200);
    expect(fetchDashboardAcceptance).toHaveBeenCalledWith("test.jwt.token", undefined, {
      restaurantId: "f2000000-0000-0000-0000-000000000001",
      locationId: "f3000000-0000-0000-0000-000000000001",
    });
  });
});
