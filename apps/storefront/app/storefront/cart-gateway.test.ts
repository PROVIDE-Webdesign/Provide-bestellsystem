import { describe, it, expect, vi } from "vitest";
import { submitGuestPickupOrder } from "./gateway.js";
const params = {
  restaurantSlug: "storefront-restaurant-a",
  locationSlug: "storefront-a-mitte",
  resource: "cart-quote",
};
const body = {
  menuId: "f4000000-0000-0000-0000-000000000001",
  menuVersionId: "f5000000-0000-0000-0000-000000000001",
  fulfillmentType: "pickup",
  requestedFor: "2026-10-02T12:00:00Z",
  lines: [
    {
      menuItemId: "f6000000-0000-0000-0000-000000000001",
      quantity: 1,
      variantId: "ea100000-0000-0000-0000-000000000001",
      optionIds: ["ea300000-0000-0000-0000-000000000001"],
    },
  ],
};
const req = (value: unknown) =>
  new Request("https://store.test/api/storefront/a/b/cart-quote", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer private",
      cookie: "private",
    },
    body: JSON.stringify(value),
  });
describe("selection quote gateway", () => {
  it("forwards variant IDs without cookies or bearer credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: {
          status: "unavailable",
          currentMenuVersionId: body.menuVersionId,
          issues: [
            {
              code: "selection_unavailable",
              menuItemId: body.lines[0]!.menuItemId,
              variantId: body.lines[0]!.variantId,
              optionIds: [],
            },
          ],
        },
      }),
    );
    expect(
      (await submitGuestPickupOrder(req(body), params, "https://api.test", fetcher)).status,
    ).toBe(200);
    const forwarded = fetcher.mock.calls[0]?.[1]?.body;
    expect(typeof forwarded).toBe("string");
    expect(JSON.parse(typeof forwarded === "string" ? forwarded : "{}")).toEqual(body);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("cookie")).toBe(false);
  });
  it("rejects client price injection and invalid upstream success", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { status: "current" } }));
    expect(
      (
        await submitGuestPickupOrder(
          req({ ...body, subtotalAmountMinor: 1 }),
          params,
          "https://api.test",
          fetcher,
        )
      ).status,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (await submitGuestPickupOrder(req(body), params, "https://api.test", fetcher)).status,
    ).toBe(503);
  });
});
