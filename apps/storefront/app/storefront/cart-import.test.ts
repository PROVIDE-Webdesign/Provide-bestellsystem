import { describe, it, expect } from "vitest";
import { parsePublicCatalog, parseCartHandoffSelection } from "@provide/contracts";
import fixture from "../../../../fixtures/storefront-catalog.json";
import { buildImportedCart } from "./cart-import";
const catalog = parsePublicCatalog(fixture),
  menu = catalog.menus[0]!,
  item = menu.sections[0]!.items[0]!;
const selection = {
  schemaVersion: 1,
  menuId: menu.id,
  menuVersionId: menu.versionId,
  lines: [{ menuItemId: item.id, quantity: 2 }],
};
describe("cross website cart import", () => {
  it("imports quantities and current server catalog price, never client prices", () => {
    const cart = buildImportedCart(selection, catalog);
    expect(cart?.[0]?.quantity).toBe(2);
    expect(cart?.[0]?.unitPriceAmountMinor).toBe(item.priceAmountMinor);
    expect(parseCartHandoffSelection({ ...selection, price: 1 })).toBeUndefined();
  });
  it("rejects contact credentials foreign scope and redirects", () => {
    for (const key of ["customer", "email", "paymentToken", "restaurantSlug", "redirectUrl"])
      expect(parseCartHandoffSelection({ ...selection, [key]: "forged" })).toBeUndefined();
  });
  it("does not silently drop unavailable or foreign items", () => {
    expect(
      buildImportedCart(
        {
          ...selection,
          lines: [{ menuItemId: "ffffffff-ffff-4fff-8fff-ffffffffffff", quantity: 1 }],
        },
        catalog,
      ),
    ).toBeUndefined();
  });
  it("requires current catalog even when source menu version is old", () => {
    const old = { ...selection, menuVersionId: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
    expect(buildImportedCart(old, catalog)?.[0]?.menuVersionId).toBe(menu.versionId);
  });
  it("rejects totals above the supported quantity bound", () => {
    expect(
      parseCartHandoffSelection({ ...selection, lines: [{ menuItemId: item.id, quantity: 1001 }] }),
    ).toBeUndefined();
  });
  it("rejects unexpected line properties", () => {
    expect(
      parseCartHandoffSelection({
        ...selection,
        lines: [{ menuItemId: item.id, quantity: 1, unitPriceAmountMinor: 1 }],
      }),
    ).toBeUndefined();
  });
});
