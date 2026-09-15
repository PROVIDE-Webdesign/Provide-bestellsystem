import { describe, expect, it } from "vitest";
import { parseGuestPickupOrderConfirmation, parseGuestPickupOrderRequest } from "./checkout.js";

const request = {
  menuId: "f4000000-0000-0000-0000-000000000001",
  menuVersionId: "f5000000-0000-0000-0000-000000000001",
  requestedFor: "2026-09-15T12:00:00Z",
  lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 2 }],
  submissionKey: "2b18f416-9476-4ce8-b721-a1346f78e978",
  customer: { contactName: " Test Gast ", phoneE164: "+999100000001", email: "A@B.DE" },
  privacyNoticeVersion: "preview-v1",
};

describe("guest pickup checkout contracts", () => {
  it("normalizes the strict request allowlist", () => {
    expect(parseGuestPickupOrderRequest(request)).toMatchObject({
      customer: { contactName: "Test Gast", email: "a@b.de" },
    });
  });

  it.each([
    { ...request, extra: "blocked" },
    { ...request, lines: [] },
    { ...request, lines: [...request.lines, request.lines[0]] },
    { ...request, customer: { ...request.customer, marketing: true } },
    { ...request, customer: { ...request.customer, phoneE164: "0170" } },
    { ...request, requestedFor: "2026-09-15 12:00" },
  ])("rejects invalid or unsupported input", (value) => {
    expect(parseGuestPickupOrderRequest(value)).toBeUndefined();
  });

  it("reconstructs the public confirmation without extra fields", () => {
    expect(
      parseGuestPickupOrderConfirmation({
        orderId: "fa000000-0000-0000-0000-000000000001",
        status: "submitted",
        fulfillmentType: "pickup",
        paymentCollectionMode: "on_fulfillment",
        requestedFor: "2026-09-15T12:00:00Z",
        currency: "EUR",
        totalAmountMinor: 2500,
        itemCount: 2,
        internal: "removed",
      }),
    ).toEqual({
      orderId: "fa000000-0000-0000-0000-000000000001",
      status: "submitted",
      fulfillmentType: "pickup",
      paymentCollectionMode: "on_fulfillment",
      requestedFor: "2026-09-15T12:00:00Z",
      currency: "EUR",
      totalAmountMinor: 2500,
      itemCount: 2,
    });
  });
});
