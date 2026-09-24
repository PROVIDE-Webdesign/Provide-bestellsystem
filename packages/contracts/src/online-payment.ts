import { parseGuestPickupOrderRequest, parseGuestPickupOrderConfirmation } from "./checkout.js";
import {
  parseGuestDeliveryOrderRequest,
  parseGuestDeliveryOrderConfirmation,
  type GuestDeliveryOrderRequest,
} from "./delivery.js";
import { isExplicitInstant } from "./storefront.js";
export const paymentStates = [
  "open",
  "checking",
  "paid",
  "expired",
  "cancelling",
  "refund_pending",
  "refund_failed",
  "refunded",
  "review",
] as const;
export type PaymentState = (typeof paymentStates)[number];
export const paymentStateLabels: Record<PaymentState, string> = {
  open: "Zahlung offen",
  checking: "Zahlung wird geprüft",
  paid: "Bezahlt",
  expired: "Zahlung beendet",
  cancelling: "Stornierung wird geprüft",
  refund_pending: "Erstattung angefordert",
  refund_failed: "Erstattung muss geprüft werden",
  refunded: "Erstattet",
  review: "Zahlung muss geprüft werden",
};
export function isPaymentState(v: unknown): v is PaymentState {
  return typeof v === "string" && (paymentStates as readonly string[]).includes(v);
}
export function object(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
export type OnlineOrderRequest =
  | (ReturnType<typeof parseGuestPickupOrderRequest> & { fulfillmentType: "pickup" })
  | (GuestDeliveryOrderRequest & { fulfillmentType: "delivery" });
export function parseOnlineOrderRequest(v: unknown): OnlineOrderRequest | undefined {
  const s = object(v);
  if (!s) return;
  const { fulfillmentType, ...rest } = s;
  if (fulfillmentType === "pickup") {
    const p = parseGuestPickupOrderRequest(rest);
    return p ? { ...p, fulfillmentType } : undefined;
  }
  if (fulfillmentType === "delivery") {
    const p = parseGuestDeliveryOrderRequest(rest);
    return p ? { ...p, fulfillmentType } : undefined;
  }
  return;
}
export interface PaymentAction {
  orderId: string;
  paymentAccessToken: string;
  paymentDeadline: string;
}
export function parsePaymentAction(v: unknown): PaymentAction | undefined {
  const s = object(v);
  if (
    !s ||
    Object.keys(s).length !== 3 ||
    typeof s.orderId !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s.orderId) ||
    typeof s.paymentAccessToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(s.paymentAccessToken) ||
    typeof s.paymentDeadline !== "string" ||
    !isExplicitInstant(s.paymentDeadline)
  )
    return;
  return {
    orderId: s.orderId,
    paymentAccessToken: s.paymentAccessToken,
    paymentDeadline: s.paymentDeadline,
  };
}
export function parseOnlineOrderConfirmation(v: unknown) {
  const s = object(v);
  if (!s || s.paymentCollectionMode !== "online") return;
  const action = parsePaymentAction({
    orderId: s.orderId,
    paymentAccessToken: s.paymentAccessToken,
    paymentDeadline: s.paymentDeadline,
  });
  const p =
    s.fulfillmentType === "delivery"
      ? parseGuestDeliveryOrderConfirmation({ ...s, paymentCollectionMode: "on_fulfillment" })
      : parseGuestPickupOrderConfirmation({ ...s, paymentCollectionMode: "on_fulfillment" });
  if (!p || !action) return;
  return { ...p, ...action, paymentCollectionMode: "online" as const };
}
export function parsePaymentSession(
  v: unknown,
): { checkoutUrl: string | null; paymentState: PaymentState } | undefined {
  const s = object(v);
  if (!s || Object.keys(s).length !== 2 || !isPaymentState(s.paymentState)) return;
  if (s.checkoutUrl !== null) {
    if (typeof s.checkoutUrl !== "string" || s.checkoutUrl.length > 4096) return;
    if (
      !/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_[A-Za-z0-9]+(?:[?#][^\s\\]*)?$/.test(
        s.checkoutUrl,
      )
    )
      return;
  }
  return { checkoutUrl: s.checkoutUrl, paymentState: s.paymentState };
}
