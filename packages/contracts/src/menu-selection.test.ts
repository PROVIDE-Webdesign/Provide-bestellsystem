import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/menu-configuration.json" with { type: "json" };
import catalog from "../../../fixtures/storefront-catalog.json" with { type: "json" };
import {
  parseMenuConfiguration,
  parseOrderSelectionLines,
  selectionLinesForDatabase,
} from "./menu-selection.js";
import { parsePublicCatalog } from "./storefront-output.js";
import { parseSelectionSnapshot, parseCartQuoteRequest, parseCartQuote } from "./cart-quote.js";
import { parseDeliveryQuoteRequest } from "./delivery.js";
import { parseOnlineOrderRequest } from "./online-payment.js";
const item = "f6000000-0000-0000-0000-000000000001",
  variant = fixture.variants[0]!.id,
  option = fixture.optionGroups[0]!.options[0]!.id;
const line = { menuItemId: item, quantity: 2, variantId: variant, optionIds: [option] };
const request = {
  menuId: "f4000000-0000-0000-0000-000000000001",
  menuVersionId: "f5000000-0000-0000-0000-000000000001",
  requestedFor: "2026-10-01T12:00:00Z",
  lines: [line],
};
describe("versioned menu selection contracts", () => {
  it("validates configured product information and preserves it in the public allowlist", () => {
    expect(parseMenuConfiguration(fixture)).toEqual(fixture);
    const c = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
    Object.assign(c.menus[0]!.sections[0]!.items[0]!, {
      configuration: fixture,
      private: "discard",
    });
    expect(parsePublicCatalog(c).menus[0]!.sections[0]!.items[0]!.configuration).toEqual(fixture);
  });
  it.each([
    { ...fixture, informationConfirmed: false },
    { ...fixture, taxRateBasisPoints: null },
    { ...fixture, taxRateBasisPoints: 10001 },
    { ...fixture, extra: "forbidden" },
    { ...fixture, variants: [fixture.variants[0], fixture.variants[0]] },
    { ...fixture, variants: fixture.variants.map((v) => ({ ...v, isActive: false })) },
    { ...fixture, optionGroups: [{ ...fixture.optionGroups[0], minSelections: 3 }] },
    { ...fixture, allergens: ["Synthetic\ninvalid"] },
  ])("rejects unsafe or infeasible configuration", (v) =>
    expect(parseMenuConfiguration(v)).toBeUndefined(),
  );
  it("distinguishes configurations and canonicalizes option order", () => {
    const other = {
      ...line,
      variantId: fixture.variants[1]!.id,
      optionIds: [fixture.optionGroups[0]!.options[1]!.id, option],
    };
    const parsed = parseOrderSelectionLines([line, other])!;
    expect(parsed).toHaveLength(2);
    expect(selectionLinesForDatabase(parsed)[1]).toMatchObject({
      variant_id: other.variantId,
      option_ids: [option, other.optionIds[0]],
    });
  });
  it.each([
    { lines: [line, { ...line }] },
    { lines: [{ ...line, optionIds: [option, option.toUpperCase()] }] },
    { lines: [{ ...line, priceAmountMinor: 1 }] },
    { lines: [{ ...line, quantity: 0 }] },
    { lines: [{ ...line, variantId: null }] },
    {
      lines: [
        { ...line, quantity: 1000 },
        { ...line, variantId: fixture.variants[1]!.id },
      ],
    },
  ])("rejects duplicate, forged and out-of-bound selection lines", ({ lines }) =>
    expect(parseOrderSelectionLines(lines)).toBeUndefined(),
  );
  it("keeps the legacy canonical shape without artificial selection fields", () => {
    expect(
      selectionLinesForDatabase(
        parseOrderSelectionLines([{ menuItemId: item, quantity: 1, optionIds: [] }])!,
      ),
    ).toEqual([{ menu_item_id: item, quantity: 1 }]);
  });
  it("shares selection parsing with delivery and online checkout", () => {
    expect(parseDeliveryQuoteRequest({ ...request, postalCode: "52062" })?.lines).toEqual([line]);
    expect(
      parseOnlineOrderRequest({
        ...request,
        fulfillmentType: "pickup",
        submissionKey: "selection-online-0001",
        customer: {
          contactName: "Synthetic",
          phoneE164: "+999100000001",
          email: "synthetic@example.invalid",
        },
        privacyNoticeVersion: "preview-v1",
      })?.lines,
    ).toEqual([line]);
  });
  it("does not accept a browser price, customer or evaluation clock in a cart quote", () => {
    expect(parseCartQuoteRequest({ ...request, fulfillmentType: "pickup" })).toBeDefined();
    for (const extra of [
      { subtotalAmountMinor: 1 },
      { customer: {} },
      { evaluatedAt: request.requestedFor },
      { postalCode: "52062" },
    ])
      expect(
        parseCartQuoteRequest({ ...request, fulfillmentType: "pickup", ...extra }),
      ).toBeUndefined();
  });
  it("validates exact included-tax rounding at large amounts and binds snapshot choices", () => {
    const gross = 999999999999,
      rate = 1900,
      tax = Number(
        (2n * BigInt(gross) * BigInt(rate) + BigInt(10000 + rate)) / (2n * BigInt(10000 + rate)),
      );
    const snapshot = {
      schemaVersion: 1,
      variant: null,
      options: [],
      allergens: [],
      additives: [],
      taxRateBasisPoints: rate,
      taxAmountMinor: tax,
    };
    expect(parseSelectionSnapshot(snapshot, gross)).toBeDefined();
    expect(parseSelectionSnapshot({ ...snapshot, taxAmountMinor: tax + 1 }, gross)).toBeUndefined();
    const quote = {
      status: "current",
      currentMenuVersionId: request.menuVersionId,
      currency: "EUR",
      itemCount: 1,
      subtotalAmountMinor: 1250,
      deliveryQuote: null,
      lines: [
        {
          menuItemId: item,
          quantity: 1,
          name: "Synthetic",
          variantId: null,
          optionIds: [],
          unitPriceAmountMinor: 1250,
          lineAmountMinor: 1250,
          selectionSnapshot: null,
        },
      ],
    };
    expect(parseCartQuote(quote)).toBeDefined();
    expect(parseCartQuote({ ...quote, subtotalAmountMinor: 1 })).toBeUndefined();
    expect(
      parseCartQuote({ ...quote, lines: [{ ...quote.lines[0], variantId: variant }] }),
    ).toBeUndefined();
  });
});
