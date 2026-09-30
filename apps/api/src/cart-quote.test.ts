import { describe, it, expect, vi } from "vitest";
import { handleCartQuote } from "./cart-quote.js";
import { routeRequest } from "./router.js";
const scope = { restaurantSlug: "storefront-restaurant-a", locationSlug: "storefront-a-mitte" };
const base =
  "https://api.test/v1/storefront/" +
  scope.restaurantSlug +
  "/" +
  scope.locationSlug +
  "/cart-quote";
const request = {
  menuId: "f4000000-0000-0000-0000-000000000001",
  menuVersionId: "f5000000-0000-0000-0000-000000000001",
  fulfillmentType: "pickup",
  requestedFor: "2026-10-01T12:00:00Z",
  lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 1 }],
};
const quote = {
  status: "current",
  currentMenuVersionId: request.menuVersionId,
  currency: "EUR",
  itemCount: 1,
  subtotalAmountMinor: 1250,
  deliveryQuote: null,
  lines: [
    {
      menuItemId: request.lines[0]!.menuItemId,
      quantity: 1,
      name: "Synthetic",
      variantId: null,
      optionIds: [],
      unitPriceAmountMinor: 1250,
      lineAmountMinor: 1250,
      selectionSnapshot: null,
    },
  ],
};
const env = {
  CART_QUOTE_ENABLED: "true",
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "synthetic" },
};
const context = { requestId: "synthetic-request" };
describe("bounded cart review API", () => {
  it("routes POST only", () => {
    expect(routeRequest(new Request(base, { method: "POST" }))?.name).toBe("cart-quote");
    expect(routeRequest(new Request(base))).toBeUndefined();
  });
  it("returns the public server quote and discards upstream extra fields", async () => {
    const reader = vi.fn().mockResolvedValue({ ...quote, private: "discard" }),
      logger = { error: vi.fn() };
    const result = await handleCartQuote(
      new Request(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      }),
      scope,
      env,
      reader,
      context,
      logger,
      new Headers(),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ data: quote });
    expect(result.headers.get("cache-control")).toBe("no-store");
  });
  it.each([
    { ...env, CART_QUOTE_ENABLED: "false" },
    { ...env, HYPERDRIVE_CACHE_DISABLED: "false" },
    { CART_QUOTE_ENABLED: "true", HYPERDRIVE_CACHE_DISABLED: "true" },
  ])("fails closed before SQL", async (gatedEnv) => {
    const reader = vi.fn();
    expect(
      (
        await handleCartQuote(
          new Request(base, { method: "POST" }),
          scope,
          gatedEnv,
          reader,
          context,
          { error: vi.fn() },
          new Headers(),
        )
      ).status,
    ).toBe(503);
    expect(reader).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...request, price: 1 },
    { ...request, lines: [{ ...request.lines[0], price: 1 }] },
  ])("rejects unsafe requests before SQL", async (body) => {
    const reader = vi.fn();
    expect(
      (
        await handleCartQuote(
          new Request(base, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          scope,
          env,
          reader,
          context,
          { error: vi.fn() },
          new Headers(),
        )
      ).status,
    ).toBe(400);
    expect(reader).not.toHaveBeenCalled();
  });
  it("uses the existing media and payload bounds", async () => {
    const reader = vi.fn();
    const invoke = (headers: HeadersInit) =>
      handleCartQuote(
        new Request(base, { method: "POST", headers, body: "{}" }),
        scope,
        env,
        reader,
        context,
        { error: vi.fn() },
        new Headers(),
      );
    expect((await invoke({ "content-type": "text/plain" })).status).toBe(415);
    expect(
      (await invoke({ "content-type": "application/json", "content-length": "65537" })).status,
    ).toBe(413);
    expect(reader).not.toHaveBeenCalled();
  });
  it("hides scoped misses and logs only a fixed failure class", async () => {
    const logger = { error: vi.fn() },
      reader = vi.fn().mockResolvedValue(null);
    const invoke = () =>
      handleCartQuote(
        new Request(base, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }),
        scope,
        env,
        reader,
        context,
        logger,
        new Headers(),
      );
    expect((await invoke()).status).toBe(404);
    reader.mockRejectedValue(new Error("private data"));
    const result = await invoke();
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain("private data");
    expect(logger.error).toHaveBeenCalledWith(context, "cart_quote_failed");
  });
});
