import {
  isStorefrontScope,
  menuIdPattern,
  parseOrderSelectionLines,
  type StorefrontScope,
} from "@provide/contracts";
import type { CartLine } from "./cart.js";
const ttl = 24 * 60 * 60 * 1000;
export const cartStorageKey = (scope: StorefrontScope) =>
  isStorefrontScope(scope)
    ? `provide:cart:v1:${scope.restaurantSlug}:${scope.locationSlug}`
    : undefined;
export function serializeCart(
  cart: readonly CartLine[],
  createdAt: number,
  now: number = Date.now(),
): string | undefined {
  if (!Number.isFinite(createdAt) || createdAt > now || now >= createdAt + ttl || cart.length > 100)
    return;
  // Only references, quantities and display metadata; never customer or status/payment credentials.
  return JSON.stringify({
    schemaVersion: 1,
    createdAt,
    expiresAt: createdAt + ttl,
    lines: cart.map((l) => ({
      menuId: l.menuId,
      menuVersionId: l.menuVersionId,
      currency: l.currency,
      menuItemId: l.menuItemId,
      name: l.name,
      unitPriceAmountMinor: l.unitPriceAmountMinor,
      quantity: l.quantity,
      ...(l.variantId ? { variantId: l.variantId } : {}),
      ...(l.optionIds ? { optionIds: l.optionIds } : {}),
      ...(l.selectionLabels ? { selectionLabels: l.selectionLabels } : {}),
    })),
  });
}
export function restoreCart(
  text: string | null,
  now: number = Date.now(),
): { lines: readonly CartLine[]; createdAt: number } | undefined {
  if (!text || text.length > 128 * 1024) return;
  try {
    const s = JSON.parse(text) as {
      schemaVersion?: unknown;
      createdAt?: unknown;
      expiresAt?: unknown;
      lines?: unknown;
    };
    if (
      s.schemaVersion !== 1 ||
      typeof s.createdAt !== "number" ||
      typeof s.expiresAt !== "number" ||
      !Number.isFinite(s.createdAt) ||
      s.createdAt > now ||
      s.expiresAt !== s.createdAt + ttl ||
      now >= s.expiresAt ||
      !Array.isArray(s.lines) ||
      !s.lines.length ||
      s.lines.length > 100
    )
      return;
    const lines: CartLine[] = [];
    for (const value of s.lines) {
      if (!value || typeof value !== "object") return;
      const l = value as Record<string, unknown>;
      if (
        Object.keys(l).some(
          (k) =>
            ![
              "menuId",
              "menuVersionId",
              "currency",
              "menuItemId",
              "name",
              "unitPriceAmountMinor",
              "quantity",
              "variantId",
              "optionIds",
              "selectionLabels",
            ].includes(k),
        ) ||
        typeof l.menuId !== "string" ||
        !menuIdPattern.test(l.menuId) ||
        typeof l.menuVersionId !== "string" ||
        !menuIdPattern.test(l.menuVersionId) ||
        typeof l.currency !== "string" ||
        !/^[A-Z]{3}$/.test(l.currency) ||
        typeof l.name !== "string" ||
        !l.name.trim() ||
        l.name.length > 300 ||
        typeof l.unitPriceAmountMinor !== "number" ||
        !Number.isSafeInteger(l.unitPriceAmountMinor) ||
        l.unitPriceAmountMinor < 0 ||
        l.unitPriceAmountMinor > 1_000_000_000
      )
        return;
      const parsed = parseOrderSelectionLines([
        {
          menuItemId: l.menuItemId,
          quantity: l.quantity,
          ...("variantId" in l ? { variantId: l.variantId } : {}),
          ...("optionIds" in l ? { optionIds: l.optionIds } : {}),
        },
      ]);
      if (!parsed?.[0]) return;
      if (
        l.selectionLabels !== undefined &&
        (!Array.isArray(l.selectionLabels) ||
          l.selectionLabels.length > 201 ||
          !l.selectionLabels.every(
            (x) =>
              typeof x === "string" &&
              x.length <= 100 &&
              !Array.from(x).some((c) => c.charCodeAt(0) < 32),
          ))
      )
        return;
      lines.push({
        menuId: l.menuId,
        menuVersionId: l.menuVersionId,
        currency: l.currency,
        name: l.name,
        unitPriceAmountMinor: l.unitPriceAmountMinor,
        ...parsed[0],
        ...(l.selectionLabels ? { selectionLabels: l.selectionLabels as string[] } : {}),
      });
    }
    if (
      lines.some(
        (l) =>
          l.menuId !== lines[0]!.menuId ||
          l.menuVersionId !== lines[0]!.menuVersionId ||
          l.currency !== lines[0]!.currency,
      ) ||
      !parseOrderSelectionLines(
        lines.map((l) => ({
          menuItemId: l.menuItemId,
          quantity: l.quantity,
          ...(l.variantId ? { variantId: l.variantId } : {}),
          ...(l.optionIds ? { optionIds: l.optionIds } : {}),
        })),
      )
    )
      return;
    return { lines, createdAt: s.createdAt };
  } catch {
    return;
  }
}
