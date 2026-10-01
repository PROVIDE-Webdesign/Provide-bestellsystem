/** Gross-inclusive amounts; round once per line/rate, allocate component cents, then sum. */
export interface TaxComponent {
  readonly kind: "base" | "variant" | "option";
  readonly choiceId: string | null;
  readonly grossAmountMinor: number;
  readonly taxRateBasisPoints: number;
  readonly taxAmountMinor: number;
}
export interface TaxSummary {
  readonly schemaVersion: 1;
  readonly status: "complete" | "partial";
  readonly subtotalAmountMinor: number;
  readonly discountAmountMinor: 0;
  readonly deliveryFeeAmountMinor: number;
  readonly totalAmountMinor: number;
  readonly knownNetAmountMinor: number;
  readonly taxAmountMinor: number;
  readonly undeclaredGrossAmountMinor: number;
  readonly buckets: readonly {
    readonly taxRateBasisPoints: number;
    readonly grossAmountMinor: number;
    readonly netAmountMinor: number;
    readonly taxAmountMinor: number;
  }[];
}
export const taxAmount = (gross: number, rate: number): number =>
  Number((2n * BigInt(gross) * BigInt(rate) + BigInt(10000 + rate)) / (2n * BigInt(10000 + rate)));
const amount = (x: unknown, max = 1_000_000_000_000): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= max;
const object = (x: unknown): Record<string, unknown> | undefined =>
  x !== null && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : undefined;
export function parseTaxComponents(
  value: unknown,
  gross: number,
  tax: number,
): readonly TaxComponent[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 202) return;
  const result: TaxComponent[] = [];
  const keys = new Set<string>();
  for (const entry of value) {
    const c = object(entry);
    if (
      !c ||
      !["base", "variant", "option"].includes(String(c.kind)) ||
      (c.kind === "base"
        ? c.choiceId !== null
        : typeof c.choiceId !== "string" ||
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(c.choiceId)) ||
      !amount(c.grossAmountMinor) ||
      !amount(c.taxRateBasisPoints, 10000) ||
      !amount(c.taxAmountMinor) ||
      Math.abs(taxAmount(c.grossAmountMinor, c.taxRateBasisPoints) - c.taxAmountMinor) > 1 ||
      c.taxAmountMinor > c.grossAmountMinor
    )
      return;
    const key = String(c.kind) + ":" + String(c.choiceId).toLowerCase();
    if (keys.has(key)) return;
    keys.add(key);
    result.push({
      kind: c.kind as TaxComponent["kind"],
      choiceId: c.choiceId as string | null,
      grossAmountMinor: c.grossAmountMinor,
      taxRateBasisPoints: c.taxRateBasisPoints,
      taxAmountMinor: c.taxAmountMinor,
    });
  }
  if (
    result.filter((c) => c.kind === "base").length !== 1 ||
    result.filter((c) => c.kind === "variant").length > 1 ||
    result.reduce((n, c) => n + c.grossAmountMinor, 0) !== gross ||
    result.reduce((n, c) => n + c.taxAmountMinor, 0) !== tax
  )
    return;
  const grouped = new Map<number, { gross: number; tax: number }>();
  for (const c of result) {
    const g = grouped.get(c.taxRateBasisPoints) ?? { gross: 0, tax: 0 };
    g.gross += c.grossAmountMinor;
    g.tax += c.taxAmountMinor;
    grouped.set(c.taxRateBasisPoints, g);
  }
  if ([...grouped].some(([rate, g]) => taxAmount(g.gross, rate) !== g.tax)) return;
  return result;
}
export function parseTaxSummary(value: unknown, expectedGross: number): TaxSummary | undefined {
  const s = object(value);
  if (
    !s ||
    s.schemaVersion !== 1 ||
    (s.status !== "complete" && s.status !== "partial") ||
    s.discountAmountMinor !== 0 ||
    !amount(expectedGross) ||
    ![
      s.subtotalAmountMinor,
      s.deliveryFeeAmountMinor,
      s.totalAmountMinor,
      s.knownNetAmountMinor,
      s.taxAmountMinor,
      s.undeclaredGrossAmountMinor,
    ].every((x) => amount(x)) ||
    s.totalAmountMinor !== expectedGross ||
    Number(s.subtotalAmountMinor) + Number(s.deliveryFeeAmountMinor) !== expectedGross ||
    !Array.isArray(s.buckets) ||
    s.buckets.length > 10001
  )
    return;
  const buckets: TaxSummary["buckets"][number][] = [];
  let previous = -1;
  for (const value of s.buckets) {
    const b = object(value);
    if (
      !b ||
      !amount(b.taxRateBasisPoints, 10000) ||
      b.taxRateBasisPoints <= previous ||
      !amount(b.grossAmountMinor) ||
      !amount(b.netAmountMinor) ||
      !amount(b.taxAmountMinor) ||
      b.netAmountMinor + b.taxAmountMinor !== b.grossAmountMinor
    )
      return;
    previous = b.taxRateBasisPoints;
    buckets.push({
      taxRateBasisPoints: b.taxRateBasisPoints,
      grossAmountMinor: b.grossAmountMinor,
      netAmountMinor: b.netAmountMinor,
      taxAmountMinor: b.taxAmountMinor,
    });
  }
  const sum = (key: "grossAmountMinor" | "netAmountMinor" | "taxAmountMinor") =>
    buckets.reduce((n, b) => n + b[key], 0);
  if (
    sum("grossAmountMinor") + Number(s.undeclaredGrossAmountMinor) !== expectedGross ||
    sum("netAmountMinor") !== s.knownNetAmountMinor ||
    sum("taxAmountMinor") !== s.taxAmountMinor ||
    (s.status === "complete") !== (s.undeclaredGrossAmountMinor === 0)
  )
    return;
  return {
    schemaVersion: 1,
    status: s.status,
    subtotalAmountMinor: Number(s.subtotalAmountMinor),
    discountAmountMinor: 0,
    deliveryFeeAmountMinor: Number(s.deliveryFeeAmountMinor),
    totalAmountMinor: expectedGross,
    knownNetAmountMinor: Number(s.knownNetAmountMinor),
    taxAmountMinor: Number(s.taxAmountMinor),
    undeclaredGrossAmountMinor: Number(s.undeclaredGrossAmountMinor),
    buckets,
  };
}
