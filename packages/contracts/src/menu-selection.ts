export interface MenuChoice {
  readonly id: string;
  readonly name: string;
  readonly priceDeltaAmountMinor: number;
  readonly isActive: boolean;
}
export interface MenuConfiguration {
  readonly schemaVersion: 1;
  readonly informationConfirmed: true;
  readonly taxRateBasisPoints: number;
  readonly allergens: readonly string[];
  readonly additives: readonly string[];
  readonly variants: readonly MenuChoice[];
  readonly optionGroups: readonly {
    readonly id: string;
    readonly name: string;
    readonly minSelections: number;
    readonly maxSelections: number;
    readonly options: readonly MenuChoice[];
  }[];
}
export interface OrderSelectionLine {
  readonly menuItemId: string;
  readonly quantity: number;
  readonly variantId?: string;
  readonly optionIds?: readonly string[];
}
export const menuIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const cleanText = (v: unknown, max: number): v is string =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
function record(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
function exact(v: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(v).length === keys.length && Object.keys(v).every((k) => keys.includes(k));
}
const integer = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;

/** Strict configuration is an aggregate of one immutable item/version, never customer input. */
export function parseMenuConfiguration(value: unknown): MenuConfiguration | undefined {
  const s = record(value);
  if (
    !s ||
    !exact(s, [
      "schemaVersion",
      "informationConfirmed",
      "taxRateBasisPoints",
      "allergens",
      "additives",
      "variants",
      "optionGroups",
    ]) ||
    s.schemaVersion !== 1 ||
    s.informationConfirmed !== true ||
    !integer(s.taxRateBasisPoints, 10000)
  )
    return;
  const labels = (v: unknown): readonly string[] | undefined =>
    Array.isArray(v) &&
    v.length <= 64 &&
    v.every((x) => cleanText(x, 120)) &&
    new Set(v).size === v.length
      ? v
      : undefined;
  const allergens = labels(s.allergens),
    additives = labels(s.additives);
  if (
    !allergens ||
    !additives ||
    !Array.isArray(s.variants) ||
    s.variants.length > 20 ||
    !Array.isArray(s.optionGroups) ||
    s.optionGroups.length > 20
  )
    return;
  const ids = new Set<string>();
  const choice = (v: unknown): MenuChoice | undefined => {
    const x = record(v);
    if (
      !x ||
      !exact(x, ["id", "name", "priceDeltaAmountMinor", "isActive"]) ||
      typeof x.id !== "string" ||
      !menuIdPattern.test(x.id) ||
      ids.has(x.id.toLowerCase()) ||
      !cleanText(x.name, 100) ||
      !integer(x.priceDeltaAmountMinor, 1_000_000_000) ||
      typeof x.isActive !== "boolean"
    )
      return;
    ids.add(x.id.toLowerCase());
    return {
      id: x.id.toLowerCase(),
      name: x.name,
      priceDeltaAmountMinor: x.priceDeltaAmountMinor,
      isActive: x.isActive,
    };
  };
  const variants: MenuChoice[] = [];
  for (const v of s.variants) {
    const x = choice(v);
    if (!x) return;
    variants.push(x);
  }
  if (variants.length && !variants.some((v) => v.isActive)) return;
  const optionGroups: MenuConfiguration["optionGroups"][number][] = [];
  let count = 0;
  for (const v of s.optionGroups) {
    const g = record(v);
    if (
      !g ||
      !exact(g, ["id", "name", "minSelections", "maxSelections", "options"]) ||
      typeof g.id !== "string" ||
      !menuIdPattern.test(g.id) ||
      ids.has(g.id.toLowerCase()) ||
      !cleanText(g.name, 100) ||
      !integer(g.minSelections, 50) ||
      !integer(g.maxSelections, 50) ||
      g.minSelections > g.maxSelections ||
      !Array.isArray(g.options) ||
      g.options.length < 1 ||
      g.options.length > 50
    )
      return;
    ids.add(g.id.toLowerCase());
    const options: MenuChoice[] = [];
    for (const o of g.options) {
      const x = choice(o);
      if (!x) return;
      options.push(x);
    }
    count += options.length;
    if (
      count > 200 ||
      g.maxSelections > options.length ||
      g.minSelections > options.filter((o) => o.isActive).length
    )
      return;
    optionGroups.push({
      id: g.id.toLowerCase(),
      name: g.name,
      minSelections: g.minSelections,
      maxSelections: g.maxSelections,
      options,
    });
  }
  return {
    schemaVersion: 1,
    informationConfirmed: true,
    taxRateBasisPoints: s.taxRateBasisPoints,
    allergens,
    additives,
    variants,
    optionGroups,
  };
}

/** Canonical identity distinguishes configurations but preserves the legacy two-field shape. */
export function parseOrderSelectionLines(
  value: unknown,
): readonly OrderSelectionLine[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return;
  const lines: OrderSelectionLine[] = [],
    keys = new Set<string>();
  let total = 0;
  for (const v of value) {
    const s = record(v);
    if (
      !s ||
      Object.keys(s).some(
        (k) => !["menuItemId", "quantity", "variantId", "optionIds"].includes(k),
      ) ||
      typeof s.menuItemId !== "string" ||
      !menuIdPattern.test(s.menuItemId) ||
      !integer(s.quantity, 1000) ||
      s.quantity < 1 ||
      ("variantId" in s && (typeof s.variantId !== "string" || !menuIdPattern.test(s.variantId)))
    )
      return;
    let optionIds: string[] = [];
    if ("optionIds" in s) {
      if (
        !Array.isArray(s.optionIds) ||
        s.optionIds.length > 200 ||
        !s.optionIds.every((o): o is string => typeof o === "string" && menuIdPattern.test(o))
      )
        return;
      optionIds = s.optionIds.map((o) => o.toLowerCase()).sort();
      if (new Set(optionIds).size !== optionIds.length) return;
    }
    const menuItemId = s.menuItemId.toLowerCase(),
      variantId = typeof s.variantId === "string" ? s.variantId.toLowerCase() : undefined;
    const key = JSON.stringify([menuItemId, variantId ?? null, optionIds]);
    if (keys.has(key) || (total += s.quantity) > 1000) return;
    keys.add(key);
    lines.push({
      menuItemId,
      quantity: s.quantity,
      ...(variantId ? { variantId } : {}),
      ...(optionIds.length ? { optionIds } : {}),
    });
  }
  return lines;
}
export function selectionLinesForDatabase(lines: readonly OrderSelectionLine[]) {
  return lines.map((l) => ({
    menu_item_id: l.menuItemId,
    quantity: l.quantity,
    ...(l.variantId ? { variant_id: l.variantId } : {}),
    ...(l.optionIds?.length ? { option_ids: l.optionIds } : {}),
  }));
}
