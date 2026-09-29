import { describe, it, expect } from "vitest";
import {
  parseOnlineOrderRequest,
  parsePaymentAction,
  parsePaymentSession,
} from "./online-payment.js";
describe("online checkout contracts", () => {
  it("requires exact payment actions and a hosted test checkout URL", () => {
    const action = {
      orderId: "fa000000-0000-0000-0000-000000000001",
      paymentDeadline: "2026-09-16T12:00:00Z",
      paymentAccessToken: "a".repeat(43),
    };
    expect(parsePaymentAction(action)).toEqual(action);
    expect(parsePaymentAction({ ...action, amount: 1 })).toBeUndefined();
    expect(
      parsePaymentSession({
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_abc#secret",
        paymentState: "open",
      }),
    ).toBeDefined();
    for (const url of [
      "javascript:alert(1)",
      "https://checkout.stripe.com.evil.test/c/pay/cs_test_abc",
      "https://checkout.stripe.com/c/pay/cs_live_abc",
      "https://checkout.stripe.com\\@evil.test/c/pay/cs_test_abc",
    ])
      expect(parsePaymentSession({ checkoutUrl: url, paymentState: "open" })).toBeUndefined();
  });
  it("reuses the existing checkout validation without allowing browser-supplied totals", () => {
    const request = {
      fulfillmentType: "pickup",
      menuId: "f4000000-0000-0000-0000-000000000001",
      menuVersionId: "f5000000-0000-0000-0000-000000000001",
      requestedFor: "2026-09-16T18:00:00Z",
      lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 2 }],
      submissionKey: "online-order-1",
      customer: { contactName: "Synthetic", phoneE164: "+999100000041", email: null },
      privacyNoticeVersion: "preview-v1",
    };
    expect(parseOnlineOrderRequest(request)).toEqual(request);
    expect(parseOnlineOrderRequest({ ...request, totalAmountMinor: 1 })).toBeUndefined();
    expect(parseOnlineOrderRequest({ ...request, fulfillmentType: "delivery" })).toBeUndefined();
  });
});
