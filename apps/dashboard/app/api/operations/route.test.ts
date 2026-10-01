import { afterEach, describe, it, expect, vi } from "vitest";
vi.mock("@/lib/session.js", () => ({ dashboardAccessToken: vi.fn() }));
import { GET, POST } from "./route.js";
import { dashboardAccessToken } from "@/lib/session.js";
const url =
  "https://dashboard.test/api/operations?restaurantId=f2000000-0000-0000-0000-000000000001&locationId=f3000000-0000-0000-0000-000000000001";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const enable = () => {
  vi.stubEnv("DASHBOARD_AUTH_ENABLED", "true");
  vi.stubEnv("DASHBOARD_LOCATION_OPERATIONS_ENABLED", "true");
};
describe("menu route session and CSRF boundary", () => {
  it("rejects cross-origin writes before reading the session", async () => {
    enable();
    expect(
      (
        await POST(
          new Request(url, {
            method: "POST",
            headers: { origin: "https://attacker.test", "content-type": "application/json" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(400);
    expect(dashboardAccessToken).not.toHaveBeenCalled();
  });
  it("rejects duplicate scopes before reading a session", async () => {
    enable();
    expect((await GET(new Request(url + "&locationId=other"))).status).toBe(400);
    expect(dashboardAccessToken).not.toHaveBeenCalled();
  });
  it("keeps disabled editing closed and authenticates reads", async () => {
    vi.stubEnv("DASHBOARD_AUTH_ENABLED", "true");
    vi.stubEnv("DASHBOARD_LOCATION_OPERATIONS_ENABLED", "false");
    expect((await GET(new Request(url))).status).toBe(503);
    enable();
    vi.mocked(dashboardAccessToken).mockResolvedValue({ status: "unauthorized" });
    expect((await GET(new Request(url))).status).toBe(401);
  });
});
