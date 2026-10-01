import { describe, it, expect } from "vitest";
import { taxAmount, parseTaxSummary, parseTaxComponents } from "./tax.js";
import { parseMenuConfiguration } from "./menu-selection.js";
import { parseSelectionSnapshot } from "./cart-quote.js";
import config from "../../../fixtures/menu-configuration.json" with { type: "json" };
const summary = {
  schemaVersion: 1,
  status: "complete",
  subtotalAmountMinor: 107,
  discountAmountMinor: 0,
  deliveryFeeAmountMinor: 119,
  totalAmountMinor: 226,
  knownNetAmountMinor: 200,
  taxAmountMinor: 26,
  undeclaredGrossAmountMinor: 0,
  buckets: [
    { taxRateBasisPoints: 700, grossAmountMinor: 107, netAmountMinor: 100, taxAmountMinor: 7 },
    { taxRateBasisPoints: 1900, grossAmountMinor: 119, netAmountMinor: 100, taxAmountMinor: 19 },
  ],
};
describe("declared component taxation", () => {
  it("uses exact inclusive half-up rounding including boundary and large amounts", () => {
    expect(taxAmount(107, 700)).toBe(7);
    expect(taxAmount(119, 1900)).toBe(19);
    expect(taxAmount(1, 10000)).toBe(1);
    expect(taxAmount(1_000_000_000_000, 10000)).toBe(500_000_000_000);
  });
  it("accepts mixed buckets and zero-rated declarations", () => {
    expect(parseTaxSummary(summary, 226)).toEqual(summary);
    expect(taxAmount(100, 0)).toBe(0);
  });
  it.each([
    { ...summary, totalAmountMinor: 225 },
    { ...summary, status: "partial" },
    { ...summary, taxAmountMinor: 25 },
    { ...summary, discountAmountMinor: 1 },
    { ...summary, buckets: [summary.buckets[1], summary.buckets[0]] },
  ])("rejects inconsistent or reordered totals", (s) =>
    expect(parseTaxSummary(s, 226)).toBeUndefined(),
  );
  it("marks missing declarations without treating them as zero tax", () => {
    const s = {
      ...summary,
      status: "partial",
      knownNetAmountMinor: 100,
      taxAmountMinor: 7,
      undeclaredGrossAmountMinor: 119,
      buckets: [summary.buckets[0]],
    };
    expect(parseTaxSummary(s, 226)?.status).toBe("partial");
  });
  it("supports explicit choice rates while preserving inheritance", () => {
    const c = {
      ...config,
      variants: config.variants.map((v) => ({ ...v, taxRateBasisPoints: 1900 })),
    };
    expect(parseMenuConfiguration(c)?.variants[0]?.taxRateBasisPoints).toBe(1900);
    expect(
      parseMenuConfiguration({ ...c, variants: [{ ...c.variants[0], taxRateBasisPoints: null }] }),
    ).toBeUndefined();
  });
  it("checks gross and tax conservation for immutable mixed snapshots", () => {
    const components = [
      {
        kind: "base",
        choiceId: null,
        grossAmountMinor: 107,
        taxRateBasisPoints: 700,
        taxAmountMinor: 7,
      },
      {
        kind: "option",
        choiceId: config.optionGroups[0]!.options[0]!.id,
        grossAmountMinor: 119,
        taxRateBasisPoints: 1900,
        taxAmountMinor: 19,
      },
    ];
    expect(parseTaxComponents(components, 226, 26)).toEqual(components);
    expect(parseTaxComponents(components, 226, 25)).toBeUndefined();
    expect(parseTaxComponents([...components, components[0]], 333, 33)).toBeUndefined();
    const s = {
      schemaVersion: 1,
      variant: null,
      options: [{ ...config.optionGroups[0]!.options[0]!, priceDeltaAmountMinor: 119 }],
      allergens: [],
      additives: [],
      taxRateBasisPoints: 700,
      taxAmountMinor: 26,
      taxComponents: components,
    };
    expect(parseSelectionSnapshot(s, 226)?.taxAmountMinor).toBe(26);
  });
});
