import type { PublicCatalog, OrderSelectionLine, CartQuote } from "@provide/contracts";

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
  readonly variantId?: string;
  readonly optionIds?: readonly string[];
  readonly selectionLabels?: readonly string[];
}

export function addCartItem(
  cart: readonly CartLine[],
  menu: CatalogMenu,
  item: CatalogItem,
  selection: Pick<OrderSelectionLine, "variantId" | "optionIds"> = {},
): readonly CartLine[] {
  if (item.availability !== "available") return cart;
  if (cart.some((line) => line.menuId !== menu.id || line.menuVersionId !== menu.versionId))
    return cart;
  const total = cart.reduce((sum, line) => sum + line.quantity, 0);
  if (total >= 1000) return cart;
  const variant = item.configuration?.variants.find(
    (v) => v.id === selection.variantId && v.isActive,
  );
  const optionIds = [...(selection.optionIds ?? [])].sort();
  const options =
    item.configuration?.optionGroups
      .flatMap((g) => g.options)
      .filter((o) => o.isActive && optionIds.includes(o.id)) ?? [];
  if (
    item.configuration
      ? (item.configuration.variants.length > 0 && !variant) ||
        (selection.variantId !== undefined && !variant) ||
        options.length !== optionIds.length ||
        item.configuration.optionGroups.some((g) => {
          const n = g.options.filter((o) => optionIds.includes(o.id) && o.isActive).length;
          return n < g.minSelections || n > g.maxSelections;
        })
      : selection.variantId || optionIds.length
  )
    return cart;
  const configured = !!item.configuration;
  const choice = configured
    ? {
        ...(variant ? { variantId: variant.id } : {}),
        optionIds,
        selectionLabels: [...(variant ? [variant.name] : []), ...options.map((o) => o.name)],
      }
    : {};
  const key = cartLineKey({ menuItemId: item.id, ...choice });
  const existing = cart.find((line) => cartLineKey(line) === key);
  if (existing)
    return cart.map((line) =>
      cartLineKey(line) === key ? { ...line, quantity: line.quantity + 1 } : line,
    );
  if (cart.length >= 100) return cart;
  return [
    ...cart,
    {
      menuId: menu.id,
      menuVersionId: menu.versionId,
      currency: menu.currency,
      menuItemId: item.id,
      name: item.name,
      unitPriceAmountMinor:
        item.priceAmountMinor +
        (variant?.priceDeltaAmountMinor ?? 0) +
        options.reduce((n, o) => n + o.priceDeltaAmountMinor, 0),
      ...choice,
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
  if (quantity <= 0) return cart.filter((line) => cartLineKey(line) !== menuItemId);
  const otherTotal = cart.reduce(
    (sum, line) => sum + (cartLineKey(line) === menuItemId ? 0 : line.quantity),
    0,
  );
  if (quantity > 1000 || otherTotal + quantity > 1000) return cart;
  return cart.map((line) => (cartLineKey(line) === menuItemId ? { ...line, quantity } : line));
}

export function cartItemCount(cart: readonly CartLine[]): number {
  return cart.reduce((sum, line) => sum + line.quantity, 0);
}

export function cartTotalAmountMinor(cart: readonly CartLine[]): number {
  return cart.reduce((sum, line) => sum + line.unitPriceAmountMinor * line.quantity, 0);
}

export function cartLineKey(
  line: Pick<CartLine, "menuItemId" | "variantId" | "optionIds">,
): string {
  return line.variantId || (line.optionIds?.length ?? 0) > 0
    ? line.menuItemId +
        ":" +
        (line.variantId ?? "") +
        ":" +
        [...(line.optionIds ?? [])].sort().join(",")
    : line.menuItemId;
}
export function cartSelectionLines(cart: readonly CartLine[]): readonly OrderSelectionLine[] {
  return cart.map((l) => ({
    menuItemId: l.menuItemId,
    quantity: l.quantity,
    ...(l.variantId ? { variantId: l.variantId } : {}),
    ...(l.optionIds ? { optionIds: l.optionIds } : {}),
  }));
}
export function applyCartQuote(
  cart: readonly CartLine[],
  quote: Extract<CartQuote, { status: "current" | "changed" }>,
): readonly CartLine[] {
  return quote.lines.map((l) => ({
    menuId: cart[0]!.menuId,
    menuVersionId: quote.currentMenuVersionId,
    currency: quote.currency,
    menuItemId: l.menuItemId,
    name: l.name,
    quantity: l.quantity,
    unitPriceAmountMinor: l.unitPriceAmountMinor,
    ...(l.selectionSnapshot
      ? {
          ...(l.variantId ? { variantId: l.variantId } : {}),
          optionIds: l.optionIds,
          selectionLabels: [
            ...(l.selectionSnapshot.variant ? [l.selectionSnapshot.variant.name] : []),
            ...l.selectionSnapshot.options.map((o) => o.name),
          ],
        }
      : {}),
  }));
}
