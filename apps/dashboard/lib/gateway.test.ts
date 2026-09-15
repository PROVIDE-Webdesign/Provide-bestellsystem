import { describe, expect, it, vi } from "vitest";

import { fetchDashboardAccess } from "./gateway.js";

const token = "header.payload.signature";
const data = {
  aal: "aal1",
  memberships: [
    {
      restaurantId: "f2000000-0000-0000-0000-000000000001",
      role: "owner",
      status: "active",
      access: "mfa_required",
      restaurant: null,
      locations: [],
    },
  ],
};

describe("dashboard API gateway", () => {
  it("forwards only the verified session access token to the fixed upstream", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ data }, { headers: { "content-type": "application/json" } }),
      );
    const response = await fetchDashboardAccess(token, "https://api.example.test", fetcher);
    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url instanceof URL ? url.href : typeof url === "string" ? url : url?.url).toBe(
      "https://api.example.test/v1/dashboard/access-context",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(init).not.toHaveProperty("credentials");
  });

  it("preserves an authentication failure without exposing upstream details", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: { message: token } }, { status: 401 }));
    const response = await fetchDashboardAccess(token, "https://api.example.test", fetcher);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(token);
  });

  it("rejects unsafe upstream configuration", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      (await fetchDashboardAccess(token, "https://user:secret@api.example.test", fetcher)).status,
    ).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
