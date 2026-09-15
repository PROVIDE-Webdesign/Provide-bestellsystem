import { describe, expect, it } from "vitest";
import { parsePublicCatalog } from "@provide/contracts";
import fixture from "../../../../fixtures/storefront-catalog.json";
import { addCartItem, cartItemCount, cartTotalAmountMinor, setCartItemQuantity } from "./cart";

const menu = parsePublicCatalog(fixture).menus[0]!;
const curry = menu.sections[0]!.items[0]!;
const rice = menu.sections[0]!.items[1]!;

describe("storefront cart", () => {
  it("adds available items and derives count and display total", () => {
    const cart = addCartItem(addCartItem([], menu, curry), menu, rice);
    expect(cartItemCount(cart)).toBe(2);
    expect(cartTotalAmountMinor(cart)).toBe(1550);
  });

  it("changes quantities and removes zero quantities", () => {
    const cart = addCartItem([], menu, curry);
    expect(setCartItemQuantity(cart, curry.id, 3)[0]?.quantity).toBe(3);
    expect(setCartItemQuantity(cart, curry.id, 0)).toEqual([]);
  });

  it("rejects unavailable items and mixed menu versions", () => {
    expect(addCartItem([], menu, { ...curry, availability: "sold_out" })).toEqual([]);
    const cart = addCartItem([], menu, curry);
    expect(
      addCartItem(cart, { ...menu, versionId: "fa000000-0000-0000-0000-000000000099" }, rice),
    ).toBe(cart);
  });
});
