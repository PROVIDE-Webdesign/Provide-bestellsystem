import { describe, it, expect } from "vitest";
import { parsePublicCatalog, parseMenuConfiguration } from "@provide/contracts";
import config from "../../../../fixtures/menu-configuration.json" with { type: "json" };
import catalog from "../../../../fixtures/storefront-catalog.json" with { type: "json" };
import {
  addCartItem,
  cartLineKey,
  setCartItemQuantity,
  cartSelectionLines,
  applyCartQuote,
} from "./cart.js";
import { serializeCart, restoreCart, cartStorageKey } from "./cart-storage.js";
const menu = parsePublicCatalog(catalog).menus[0]!,
  item = { ...menu.sections[0]!.items[0]!, configuration: parseMenuConfiguration(config)! };
const selection = {
  variantId: config.variants[1]!.id,
  optionIds: [config.optionGroups[0]!.options[1]!.id],
};
describe("configured cart and local recovery", () => {
  it("keeps distinct selections separate and changes only their quantity", () => {
    let cart = addCartItem([], menu, item, selection);
    cart = addCartItem(cart, menu, item, { ...selection, variantId: config.variants[0]!.id });
    cart = addCartItem(cart, menu, item, selection);
    expect(cart).toHaveLength(2);
    expect(cart[0]!.quantity).toBe(2);
    expect(cart[0]!.unitPriceAmountMinor).toBe(1500);
    expect(setCartItemQuantity(cart, cartLineKey(cart[0]!), 0)).toEqual([cart[1]]);
    expect(cartSelectionLines(cart)[0]).toEqual({ ...selection, menuItemId: item.id, quantity: 2 });
  });
  it("canonicalizes extras and enforces required choices and inactive options", () => {
    const both = { ...selection, optionIds: config.optionGroups[0]!.options.map((o) => o.id) };
    let cart = addCartItem([], menu, item, both);
    cart = addCartItem(cart, menu, item, { ...both, optionIds: [...both.optionIds].reverse() });
    expect(cart).toHaveLength(1);
    expect(cart[0]!.quantity).toBe(2);
    expect(addCartItem([], menu, item, {})).toEqual([]);
    expect(addCartItem([], menu, item, { ...selection, optionIds: [] })).toEqual([]);
    expect(
      addCartItem([], menu, item, {
        ...selection,
        optionIds: [selection.optionIds[0]!, selection.optionIds[0]!],
      }),
    ).toEqual([]);
  });
  it("restores only a bounded 24-hour cart and never serializes contact or credentials", () => {
    const cart = addCartItem([], menu, item, selection);
    const text = serializeCart(
      [{ ...cart[0]!, email: "private", statusAccessToken: "secret" } as (typeof cart)[number]],
      1000,
      2000,
    )!;
    expect(text).not.toMatch(/private|secret|email|statusAccessToken/);
    expect(restoreCart(text, 3000)?.lines).toEqual(cart);
    expect(restoreCart(text, 1000 + 86400000)).toBeUndefined();
    expect(serializeCart(cart, 1000, 1000 + 86400000)).toBeUndefined();
    expect(
      restoreCart(JSON.stringify({ ...JSON.parse(text), expiresAt: 1000 + 86400001 }), 3000),
    ).toBeUndefined();
    expect(
      restoreCart(
        JSON.stringify({ ...JSON.parse(text), lines: [{ ...cart[0], phoneE164: "+999" }] }),
        3000,
      ),
    ).toBeUndefined();
  });
  it("separates location keys and rejects mixed-version recovery", () => {
    expect(cartStorageKey({ restaurantSlug: "test-restaurant", locationSlug: "north" })).not.toBe(
      cartStorageKey({ restaurantSlug: "test-restaurant", locationSlug: "south" }),
    );
    const cart = addCartItem([], menu, item, selection);
    expect(
      restoreCart(
        serializeCart(
          [cart[0]!, { ...cart[0]!, menuVersionId: "fa000000-0000-0000-0000-000000000009" }],
          1000,
          2000,
        )!,
        3000,
      ),
    ).toBeUndefined();
  });
  it("uses only the authoritative quote for rebased prices and labels", () => {
    const cart = addCartItem([], menu, item, selection);
    const quote = {
      status: "changed" as const,
      currentMenuVersionId: "fa000000-0000-0000-0000-000000000009",
      currency: "EUR",
      itemCount: 1,
      subtotalAmountMinor: 1600,
      deliveryQuote: null,
      lines: [
        {
          menuItemId: item.id,
          name: "Updated",
          quantity: 1,
          variantId: null,
          optionIds: [],
          unitPriceAmountMinor: 1600,
          lineAmountMinor: 1600,
          selectionSnapshot: null,
        },
      ],
    };
    expect(applyCartQuote(cart, quote)[0]).toMatchObject({
      name: "Updated",
      unitPriceAmountMinor: 1600,
      menuVersionId: quote.currentMenuVersionId,
    });
  });
});
