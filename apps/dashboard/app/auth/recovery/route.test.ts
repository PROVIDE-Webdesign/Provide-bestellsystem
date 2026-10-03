import { beforeEach, it, expect, vi } from "vitest";
vi.mock("@/lib/supabase-server.js", () => ({
  createDashboardServerClient: vi.fn().mockResolvedValue({
    auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }) },
  }),
}));
import { createDashboardServerClient } from "@/lib/supabase-server.js";
import { GET } from "./route.js";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ACCOUNT_RECOVERY_ENABLED", "true");
  vi.stubEnv("DASHBOARD_AUTH_ENABLED", "true");
  vi.stubEnv("ACCOUNT_RECOVERY_ORIGIN", "https://dashboard.test");
});
it("accepts only one bounded PKCE code and redirects to a fixed clean recovery URL", async () => {
  const r = await GET(new Request("https://dashboard.test/auth/recovery?code=synthetic-pkce-code"));
  expect(r.headers.get("location")).toBe("https://dashboard.test/recovery");
  expect(r.headers.get("cache-control")).toContain("no-store");
  expect(r.headers.get("referrer-policy")).toBe("no-referrer");
});
it("rejects duplicate codes, foreign redirects, fragment-style sessions and disabled recovery", async () => {
  for (const s of [
    "?code=a&code=b",
    "?code=a&next=https://evil.test",
    "?access_token=synthetic&type=invite",
    "?code=" + "x".repeat(2049),
  ]) {
    const r = await GET(new Request("https://dashboard.test/auth/recovery" + s));
    expect(r.headers.get("location")).toBe("https://dashboard.test/recovery#link_failed");
  }
  expect(createDashboardServerClient).not.toHaveBeenCalled();
  vi.stubEnv("ACCOUNT_RECOVERY_ENABLED", "false");
  await GET(new Request("https://dashboard.test/auth/recovery?code=valid"));
  expect(createDashboardServerClient).not.toHaveBeenCalled();
});
