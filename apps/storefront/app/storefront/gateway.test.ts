import { describe, expect, it, vi } from "vitest";
import fixture from "../../../../fixtures/storefront-catalog.json";
import { fetchPublicOrderStatus, fetchPublicStorefront, submitGuestPickupOrder } from "./gateway";
const params = {
  restaurantSlug: "storefront-restaurant-a",
  locationSlug: "storefront-a-mitte",
  resource: "catalog",
};
const request = new Request("https://store.example.test/api/storefront/test/middle/catalog", {
  headers: { authorization: "Bearer private", cookie: "private" },
});

describe("guest pickup checkout gateway", () => {
  const checkout = {
    menuId: "f4000000-0000-0000-0000-000000000001",
    menuVersionId: "f5000000-0000-0000-0000-000000000001",
    requestedFor: "2026-09-15T12:00:00Z",
    lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 1 }],
    submissionKey: "2b18f416-9476-4ce8-b721-a1346f78e978",
    customer: { contactName: "Synthetic Guest", phoneE164: "+999100000001", email: null },
    privacyNoticeVersion: "preview-v1",
  };
  const confirmation = {
    orderId: "fa000000-0000-0000-0000-000000000001",
    statusAccessToken: "a".repeat(43),
    statusAvailableUntil: "2026-09-17T12:00:00Z",
    status: "submitted",
    fulfillmentType: "pickup",
    paymentCollectionMode: "on_fulfillment",
    requestedFor: "2026-09-15T12:00:00Z",
    currency: "EUR",
    totalAmountMinor: 1250,
    itemCount: 1,
  };
  const checkoutRequest = (value: unknown = checkout) =>
    new Request("https://store.example.test/api/storefront/test/middle/orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "private" },
      body: JSON.stringify(value),
    });

  it("forwards only normalized JSON without browser credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: confirmation }));
    const response = await submitGuestPickupOrder(
      checkoutRequest(),
      { ...params, resource: "orders" },
      "https://api.example.test",
      fetcher,
    );
    expect(response.status).toBe(201);
    expect(fetcher).toHaveBeenCalledWith(
      new URL(
        "https://api.example.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte/orders",
      ),
      expect.objectContaining({
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
      }),
    );
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("private");
  });

  it("rejects unsupported fields before contacting the API", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await submitGuestPickupOrder(
      checkoutRequest({ ...checkout, totalAmountMinor: 1 }),
      { ...params, resource: "orders" },
      "https://api.example.test",
      fetcher,
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves safe checkout failures while hiding upstream bodies", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: "database private" }, { status: 409 }));
    const response = await submitGuestPickupOrder(
      checkoutRequest(),
      { ...params, resource: "orders" },
      "https://api.example.test",
      fetcher,
    );
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("database private");
  });
});
describe("public order status gateway", () => {
  const orderId = "fa000000-0000-0000-0000-000000000001";
  const statusAccessToken = "a".repeat(43);
  const status = {
    orderId,
    status: "ready",
    fulfillmentType: "pickup",
    paymentCollectionMode: "on_fulfillment",
    requestedFor: "2026-09-15T12:00:00.000Z",
    currency: "EUR",
    totalAmountMinor: 2500,
    itemCount: 2,
    updatedAt: "2026-09-15T11:30:00.000Z",
    statusAvailableUntil: "2026-09-17T12:00:00.000Z",
  };
  const statusRequest = (value: unknown = { orderId, statusAccessToken }) =>
    new Request("https://store.example.test/api/storefront/test/middle/order-status", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "private" },
      body: JSON.stringify(value),
    });

  it("forwards only the capability body and strips browser credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: status }));
    const response = await fetchPublicOrderStatus(
      statusRequest(),
      { ...params, resource: "order-status" },
      "https://api.example.test",
      fetcher,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith(
      new URL(
        "https://api.example.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte/order-status",
      ),
      expect.objectContaining({
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
      }),
    );
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("private");
  });

  it("rejects extra fields and preserves only a uniform upstream 404", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      (
        await fetchPublicOrderStatus(
          statusRequest({ orderId, statusAccessToken, phone: "+999100000001" }),
          { ...params, resource: "order-status" },
          "https://api.example.test",
          fetcher,
        )
      ).status,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(Response.json({ internal: "hidden" }, { status: 404 }));
    const response = await fetchPublicOrderStatus(
      statusRequest(),
      { ...params, resource: "order-status" },
      "https://api.example.test",
      fetcher,
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("hidden");
  });
});
describe("storefront public gateway", () => {
  it("uses only the configured upstream with no cookies, authorization, redirects or cache", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: fixture }));
    const response = await fetchPublicStorefront(
      request,
      params,
      "https://api.example.test",
      fetcher,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith(
      new URL(
        "https://api.example.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte/catalog",
      ),
      expect.objectContaining({
        cache: "no-store",
        redirect: "error",
        headers: { accept: "application/json" },
      }),
    );
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("private");
  });
  it("hides upstream exceptions and malformed output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private"));
    expect(
      (await fetchPublicStorefront(request, params, "https://api.example.test", fetcher)).status,
    ).toBe(503);
    fetcher.mockResolvedValue(Response.json({ data: { secret: "private" } }));
    const response = await fetchPublicStorefront(
      request,
      params,
      "https://api.example.test",
      fetcher,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
  });
  it("rejects unconfigured or unsafe upstream URLs", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const base of [
      undefined,
      "http://example.com",
      "https://user:pass@example.com",
      "https://example.com/path",
      "file:///tmp/a",
    ])
      expect((await fetchPublicStorefront(request, params, base, fetcher)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves hidden-scope 404 while discarding internal error bodies", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ internal: "private" }, { status: 404 }));
    const response = await fetchPublicStorefront(
      request,
      params,
      "https://api.example.test",
      fetcher,
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("private");
  });
});
