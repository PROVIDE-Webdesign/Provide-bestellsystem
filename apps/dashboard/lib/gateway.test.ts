import { describe, expect, it, vi } from "vitest";

import {
  fetchDashboardAccess,
  fetchDashboardOrderDetail,
  fetchDashboardOrders,
  transitionDashboardOrder,
} from "./gateway.js";

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

describe("dashboard order gateway", () => {
  const scope = {
    restaurantId: "f2000000-0000-0000-0000-000000000001",
    locationId: "f3000000-0000-0000-0000-000000000001",
  };
  const orderId = "fa000000-0000-0000-0000-000000000001";
  const summary = {
    orderId,
    status: "submitted",
    fulfillmentType: "pickup",
    paymentCollectionMode: "on_fulfillment",
    requestedFor: "2026-09-15T18:00:00.000Z",
    currency: "EUR",
    totalAmountMinor: 2500,
    itemCount: 2,
    updatedAt: "2026-09-15T16:00:00.000Z",
    allowedTransitions: ["accepted"],
  };

  it("constructs a fixed scoped list URL and validates the response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { data: { ...scope, orders: [summary], nextCursor: null } },
          { headers: { "content-type": "application/json" } },
        ),
      );
    const response = await fetchDashboardOrders(
      token,
      "https://api.example.test",
      scope,
      { limit: 25 },
      fetcher,
    );
    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    const href = url instanceof URL ? url.href : typeof url === "string" ? url : url?.url;
    expect(href).toContain(
      `/restaurants/${scope.restaurantId}/locations/${scope.locationId}/orders?limit=25`,
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
  });

  it("reads details without accepting an expanded personal-data response", async () => {
    const detail = {
      ...summary,
      ...scope,
      contactName: null,
      lines: [
        {
          lineNumber: 1,
          displayName: "Curry",
          quantity: 2,
          unitPriceAmountMinor: 1250,
          lineAmountMinor: 2500,
        },
      ],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { data: { ...detail, phoneE164: "+999100000001" } },
          { headers: { "content-type": "application/json" } },
        ),
      );
    expect(
      (
        await fetchDashboardOrderDetail(
          token,
          "https://api.example.test",
          { ...scope, orderId },
          fetcher,
        )
      ).status,
    ).toBe(503);
  });

  it("forwards only a validated status command and preserves conflicts", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { message: token } },
          { status: 409, headers: { "content-type": "application/json" } },
        ),
      );
    const response = await transitionDashboardOrder(
      token,
      "https://api.example.test",
      { ...scope, orderId },
      { expectedStatus: "submitted", targetStatus: "accepted" },
      fetcher,
    );
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain(token);
    const body = fetcher.mock.calls[0]?.[1]?.body;
    expect(JSON.parse(typeof body === "string" ? body : "null")).toEqual({
      expectedStatus: "submitted",
      targetStatus: "accepted",
    });
  });
});
