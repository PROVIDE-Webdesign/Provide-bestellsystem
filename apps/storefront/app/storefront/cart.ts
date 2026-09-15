import type { PublicCatalog } from "@provide/contracts";

type CatalogMenu = PublicCatalog["menus"][number];
type CatalogItem = CatalogMenu["sections"][number]["items"][number];

export interface CartLine {
  readonly menuId: string;
  readonly menuVersionId: string;
  readonly currency: string;
  readonly menuItemId: string;
  readonly name: string;
  readonly unitPriceAmountMinor: number;
  readonly quantity: number;
}

export function addCartItem(
  cart: readonly CartLine[],
  menu: CatalogMenu,
  item: CatalogItem,
): readonly CartLine[] {
  if (item.availability !== "available") return cart;
  if (cart.some((line) => line.menuId !== menu.id || line.menuVersionId !== menu.versionId))
    return cart;
  const total = cart.reduce((sum, line) => sum + line.quantity, 0);
  if (total >= 1000) return cart;
  const existing = cart.find((line) => line.menuItemId === item.id);
  if (existing)
    return cart.map((line) =>
      line.menuItemId === item.id ? { ...line, quantity: line.quantity + 1 } : line,
    );
  return [
    ...cart,
    {
      menuId: menu.id,
      menuVersionId: menu.versionId,
      currency: menu.currency,
      menuItemId: item.id,
      name: item.name,
      unitPriceAmountMinor: item.priceAmountMinor,
      quantity: 1,
    },
  ];
}

export function setCartItemQuantity(
  cart: readonly CartLine[],
  menuItemId: string,
  quantity: number,
): readonly CartLine[] {
  if (!Number.isInteger(quantity)) return cart;
  if (quantity <= 0) return cart.filter((line) => line.menuItemId !== menuItemId);
  const otherTotal = cart.reduce(
    (sum, line) => sum + (line.menuItemId === menuItemId ? 0 : line.quantity),
    0,
  );
  if (quantity > 1000 || otherTotal + quantity > 1000) return cart;
  return cart.map((line) => (line.menuItemId === menuItemId ? { ...line, quantity } : line));
}

export function cartItemCount(cart: readonly CartLine[]): number {
  return cart.reduce((sum, line) => sum + line.quantity, 0);
}

export function cartTotalAmountMinor(cart: readonly CartLine[]): number {
  return cart.reduce((sum, line) => sum + line.unitPriceAmountMinor * line.quantity, 0);
}
