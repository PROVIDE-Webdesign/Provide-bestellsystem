import { isExplicitInstant, type FulfillmentType } from "./storefront.js";
import {
  menuIdPattern,
  parseOrderSelectionLines,
  type OrderSelectionLine,
} from "./menu-selection.js";
import { parseDeliveryQuote, type DeliveryQuote } from "./delivery.js";

export interface CartQuoteRequest {
  readonly menuId: string;
  readonly menuVersionId: string;
  readonly fulfillmentType: FulfillmentType;
  readonly requestedFor: string;
  readonly lines: readonly OrderSelectionLine[];
  readonly postalCode?: string;
}
export interface SelectionSnapshot {
  readonly schemaVersion: 1;
  readonly variant: {
    readonly id: string;
    readonly name: string;
    readonly priceDeltaAmountMinor: number;
  } | null;
  readonly options: readonly {
    readonly id: string;
    readonly name: string;
    readonly priceDeltaAmountMinor: number;
  }[];
  readonly allergens: readonly string[];
  readonly additives: readonly string[];
  readonly taxRateBasisPoints: number;
  readonly taxAmountMinor: number;
}
export type CartQuote =
  | {
      readonly status: "unavailable";
      readonly currentMenuVersionId: string;
      readonly issues: readonly {
        readonly code: "selection_unavailable" | "time_unavailable" | "delivery_unavailable";
        readonly menuItemId?: string;
        readonly variantId?: string | null;
        readonly optionIds?: readonly string[];
      }[];
    }
  | {
      readonly status: "current" | "changed";
      readonly currentMenuVersionId: string;
      readonly currency: string;
      readonly itemCount: number;
      readonly subtotalAmountMinor: number;
      readonly deliveryQuote: DeliveryQuote | null;
      readonly lines: readonly {
        readonly menuItemId: string;
        readonly quantity: number;
        readonly name: string;
        readonly variantId: string | null;
        readonly optionIds: readonly string[];
        readonly unitPriceAmountMinor: number;
        readonly lineAmountMinor: number;
        readonly selectionSnapshot: SelectionSnapshot | null;
      }[];
    };
const object = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const id = (v: unknown): v is string => typeof v === "string" && menuIdPattern.test(v);
const amount = (v: unknown, max = 1_000_000_000_000): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
export function parseCartQuoteRequest(v: unknown): CartQuoteRequest | undefined {
  const s = object(v);
  if (
    !s ||
    Object.keys(s).some(
      (k) =>
        ![
          "menuId",
          "menuVersionId",
          "fulfillmentType",
          "requestedFor",
          "lines",
          "postalCode",
        ].includes(k),
    ) ||
    !id(s.menuId) ||
    !id(s.menuVersionId) ||
    (s.fulfillmentType !== "pickup" && s.fulfillmentType !== "delivery") ||
    typeof s.requestedFor !== "string" ||
    !isExplicitInstant(s.requestedFor) ||
    (s.fulfillmentType === "pickup"
      ? "postalCode" in s
      : typeof s.postalCode !== "string" || !/^[0-9]{5}$/.test(s.postalCode))
  )
    return;
  const lines = parseOrderSelectionLines(s.lines);
  if (!lines) return;
  return {
    menuId: s.menuId,
    menuVersionId: s.menuVersionId,
    fulfillmentType: s.fulfillmentType,
    requestedFor: s.requestedFor,
    lines,
    ...(s.fulfillmentType === "delivery" ? { postalCode: s.postalCode as string } : {}),
  };
}
export function parseSelectionSnapshot(v: unknown, gross: number): SelectionSnapshot | undefined {
  if (!amount(gross)) return;
  const s = object(v);
  if (
    !s ||
    s.schemaVersion !== 1 ||
    !amount(s.taxRateBasisPoints, 10000) ||
    !amount(s.taxAmountMinor) ||
    s.taxAmountMinor !==
      Number(
        (2n * BigInt(gross) * BigInt(s.taxRateBasisPoints) + BigInt(10000 + s.taxRateBasisPoints)) /
          (2n * BigInt(10000 + s.taxRateBasisPoints)),
      )
  )
    return;
  const choice = (v: unknown) => {
    const c = object(v);
    return c && id(c.id) && text(c.name, 100) && amount(c.priceDeltaAmountMinor, 1_000_000_000)
      ? { id: c.id, name: c.name, priceDeltaAmountMinor: c.priceDeltaAmountMinor }
      : undefined;
  };
  const variant = s.variant === null ? null : choice(s.variant);
  if (variant === undefined || !Array.isArray(s.options) || s.options.length > 200) return;
  const options = [];
  for (const o of s.options) {
    const c = choice(o);
    if (!c) return;
    options.push(c);
  }
  if (new Set(options.map((o) => o.id.toLowerCase())).size !== options.length) return;
  const labels = (v: unknown): string[] | undefined =>
    Array.isArray(v) &&
    v.length <= 64 &&
    v.every((x) => text(x, 120)) &&
    new Set(v).size === v.length
      ? v
      : undefined;
  const allergens = labels(s.allergens),
    additives = labels(s.additives);
  if (!allergens || !additives) return;
  return {
    schemaVersion: 1,
    variant,
    options,
    allergens,
    additives,
    taxRateBasisPoints: s.taxRateBasisPoints,
    taxAmountMinor: s.taxAmountMinor,
  };
}
export function parseCartQuote(v: unknown): CartQuote | undefined {
  const s = object(v);
  if (!s || !id(s.currentMenuVersionId)) return;
  if (s.status === "unavailable") {
    if (!Array.isArray(s.issues) || s.issues.length < 1 || s.issues.length > 100) return;
    const issues: Extract<CartQuote, { status: "unavailable" }>["issues"][number][] = [];
    for (const i of s.issues) {
      const x = object(i);
      if (!x) return;
      if (x.code === "selection_unavailable") {
        if (
          !id(x.menuItemId) ||
          (x.variantId !== null && !id(x.variantId)) ||
          !Array.isArray(x.optionIds) ||
          x.optionIds.length > 200 ||
          !x.optionIds.every(id)
        )
          return;
        issues.push({
          code: x.code,
          menuItemId: x.menuItemId,
          variantId: x.variantId,
          optionIds: x.optionIds,
        });
      } else if (x.code === "time_unavailable" || x.code === "delivery_unavailable")
        issues.push({ code: x.code });
      else return;
    }
    return { status: s.status, currentMenuVersionId: s.currentMenuVersionId, issues };
  }
  if (
    (s.status !== "current" && s.status !== "changed") ||
    typeof s.currency !== "string" ||
    !/^[A-Z]{3}$/.test(s.currency) ||
    !amount(s.itemCount, 1000) ||
    s.itemCount < 1 ||
    !amount(s.subtotalAmountMinor) ||
    !Array.isArray(s.lines) ||
    s.lines.length < 1 ||
    s.lines.length > 100
  )
    return;
  const lines: Extract<CartQuote, { status: "current" | "changed" }>["lines"][number][] = [];
  for (const v of s.lines) {
    const x = object(v);
    if (
      !x ||
      !id(x.menuItemId) ||
      !amount(x.quantity, 1000) ||
      x.quantity < 1 ||
      !text(x.name, 300) ||
      (x.variantId !== null && !id(x.variantId)) ||
      !Array.isArray(x.optionIds) ||
      x.optionIds.length > 200 ||
      !x.optionIds.every(id) ||
      !amount(x.unitPriceAmountMinor, 1_000_000_000) ||
      !amount(x.lineAmountMinor) ||
      x.lineAmountMinor !== x.quantity * x.unitPriceAmountMinor
    )
      return;
    const selectionSnapshot =
      x.selectionSnapshot === null
        ? null
        : parseSelectionSnapshot(x.selectionSnapshot, x.lineAmountMinor);
    if (
      selectionSnapshot === undefined ||
      (selectionSnapshot &&
        (selectionSnapshot.variant?.id.toLowerCase() ?? null) !==
          (x.variantId?.toLowerCase() ?? null))
    )
      return;
    if (
      selectionSnapshot &&
      JSON.stringify(selectionSnapshot.options.map((o) => o.id.toLowerCase()).sort()) !==
        JSON.stringify(x.optionIds.map((o) => o.toLowerCase()).sort())
    )
      return;
    if (!selectionSnapshot && (x.variantId !== null || x.optionIds.length > 0)) return;
    lines.push({
      menuItemId: x.menuItemId,
      quantity: x.quantity,
      name: x.name,
      variantId: x.variantId,
      optionIds: x.optionIds,
      unitPriceAmountMinor: x.unitPriceAmountMinor,
      lineAmountMinor: x.lineAmountMinor,
      selectionSnapshot,
    });
  }
  if (
    lines.reduce((n, l) => n + l.quantity, 0) !== s.itemCount ||
    lines.reduce((n, l) => n + l.lineAmountMinor, 0) !== s.subtotalAmountMinor ||
    !parseOrderSelectionLines(
      lines.map((l) => ({
        menuItemId: l.menuItemId,
        quantity: l.quantity,
        ...(l.variantId ? { variantId: l.variantId } : {}),
        optionIds: l.optionIds,
      })),
    )
  )
    return;
  const deliveryQuote = s.deliveryQuote === null ? null : parseDeliveryQuote(s.deliveryQuote);
  if (
    deliveryQuote === undefined ||
    (deliveryQuote &&
      (deliveryQuote.subtotalAmountMinor !== s.subtotalAmountMinor ||
        deliveryQuote.currency !== s.currency))
  )
    return;
  return {
    status: s.status,
    currentMenuVersionId: s.currentMenuVersionId,
    currency: s.currency,
    itemCount: s.itemCount,
    subtotalAmountMinor: s.subtotalAmountMinor,
    lines,
    deliveryQuote,
  };
}
