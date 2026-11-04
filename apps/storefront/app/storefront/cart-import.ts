import { parseCartHandoffSelection, type PublicCatalog } from "@provide/contracts";
import { addCartItem, type CartLine } from "./cart";
export function buildImportedCart(
  value: unknown,
  catalog: PublicCatalog,
): readonly CartLine[] | undefined {
  const s = parseCartHandoffSelection(value);
  if (!s) return;
  const menu = catalog.menus.find((m) => m.id === s.menuId);
  if (!menu) return;
  let cart: readonly CartLine[] = [];
  for (const l of s.lines) {
    const item = menu.sections.flatMap((s) => s.items).find((i) => i.id === l.menuItemId);
    if (!item) return;
    for (let n = 0; n < l.quantity; n++) {
      const next = addCartItem(cart, menu, item, l);
      if (next === cart) return;
      cart = next;
    }
  }
  return cart;
}
