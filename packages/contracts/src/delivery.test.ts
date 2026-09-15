import { describe, it, expect } from "vitest";
import {
  parseDeliveryQuote,
  parseDeliveryQuoteRequest,
  parseGuestDeliveryOrderRequest,
  parseGuestDeliveryOrderConfirmation,
} from "./delivery.js";
const quote = {
  policyId: "fb000000-0000-0000-0000-000000000001",
  subtotalAmountMinor: 2500,
  deliveryFeeAmountMinor: 350,
  totalAmountMinor: 2850,
  minimumAmountMinor: 2000,
  currency: "EUR",
};
const request = {
  menuId: "f4000000-0000-0000-0000-000000000001",
  menuVersionId: "f5000000-0000-0000-0000-000000000001",
  requestedFor: "2026-09-16T18:00:00.000Z",
  lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 2 }],
  postalCode: "52062",
};
describe("delivery contracts", () => {
  it("requires integer, internally consistent, nonnegative prices", () => {
    expect(parseDeliveryQuote(quote)).toEqual(quote);
    for (const change of [
      { totalAmountMinor: 2500 },
      { deliveryFeeAmountMinor: -1 },
      { minimumAmountMinor: 3000 },
      { currency: "USD" },
      { address: "secret" },
    ])
      expect(parseDeliveryQuote({ ...quote, ...change })).toBeUndefined();
  });
  it("requires exact quote inputs and bounded German postal codes", () => {
    expect(parseDeliveryQuoteRequest(request)).toEqual(request);
    for (const change of [
      { postalCode: "5206" },
      { postalCode: "52062 " },
      { feeAmountMinor: 0 },
      { lines: [...request.lines, ...request.lines] },
    ])
      expect(parseDeliveryQuoteRequest({ ...request, ...change })).toBeUndefined();
  });
  it("requires address and explicit expected quote on delivery submissions", () => {
    const { postalCode, ...base } = request;
    const order = {
      ...base,
      submissionKey: "delivery-test-key",
      customer: { contactName: "Synthetic", phoneE164: "+999100000001", email: null },
      privacyNoticeVersion: "preview-v1",
      delivery: {
        addressLine1: "Testweg 10",
        addressLine2: null,
        city: "Aachen",
        postalCode,
        countryCode: "DE",
      },
      expectedQuote: quote,
    };
    expect(parseGuestDeliveryOrderRequest(order)).toEqual(order);
    expect(
      parseGuestDeliveryOrderRequest({
        ...order,
        delivery: { ...order.delivery, countryCode: "NL" },
      }),
    ).toBeUndefined();
    expect(
      parseGuestDeliveryOrderRequest({
        ...order,
        delivery: { ...order.delivery, coordinates: [1, 2] },
      }),
    ).toBeUndefined();
  });
  it("validates the delivery confirmation without leaking raw fields", () => {
    const input = {
      orderId: quote.policyId,
      status: "submitted",
      fulfillmentType: "delivery",
      paymentCollectionMode: "on_fulfillment",
      requestedFor: request.requestedFor,
      statusAvailableUntil: "2026-09-18T18:00:00.000Z",
      statusAccessToken: "a".repeat(43),
      currency: "EUR",
      subtotalAmountMinor: 2500,
      deliveryFeeAmountMinor: 350,
      totalAmountMinor: 2850,
      itemCount: 2,
      phone: "secret",
    };
    expect(parseGuestDeliveryOrderConfirmation(input)?.totalAmountMinor).toBe(2850);
    expect(JSON.stringify(parseGuestDeliveryOrderConfirmation(input))).not.toContain("secret");
  });
});
