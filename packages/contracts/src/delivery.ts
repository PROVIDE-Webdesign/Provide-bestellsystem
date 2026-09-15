import {
  parseGuestPickupOrderRequest,
  parseGuestPickupOrderConfirmation,
  type GuestPickupOrderRequest,
  type GuestPickupOrderConfirmation,
} from "./checkout.js";

export interface DeliveryAddress {
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly postalCode: string;
  readonly city: string;
  readonly countryCode: "DE";
}
export interface DeliveryQuote {
  readonly policyId: string;
  readonly subtotalAmountMinor: number;
  readonly deliveryFeeAmountMinor: number;
  readonly totalAmountMinor: number;
  readonly minimumAmountMinor: number;
  readonly currency: "EUR";
}
export interface DeliveryQuoteRequest {
  readonly menuId: string;
  readonly menuVersionId: string;
  readonly requestedFor: string;
  readonly lines: GuestPickupOrderRequest["lines"];
  readonly postalCode: string;
}
export interface GuestDeliveryOrderRequest extends GuestPickupOrderRequest {
  readonly delivery: DeliveryAddress;
  readonly expectedQuote: DeliveryQuote;
}
export interface GuestDeliveryOrderConfirmation extends Omit<
  GuestPickupOrderConfirmation,
  "fulfillmentType"
> {
  readonly fulfillmentType: "delivery";
  readonly subtotalAmountMinor: number;
  readonly deliveryFeeAmountMinor: number;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function exact(source: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(source).length === keys.length &&
    Object.keys(source).every((key) => keys.includes(key))
  );
}
function amount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 1_000_000_000_000
  );
}
export function parseDeliveryAddress(value: unknown): DeliveryAddress | undefined {
  const s = record(value);
  if (
    !s ||
    !exact(s, ["addressLine1", "addressLine2", "postalCode", "city", "countryCode"]) ||
    s.countryCode !== "DE" ||
    typeof s.postalCode !== "string" ||
    !/^[0-9]{5}$/.test(s.postalCode) ||
    typeof s.addressLine1 !== "string" ||
    !s.addressLine1.trim() ||
    s.addressLine1.length > 200 ||
    typeof s.city !== "string" ||
    !s.city.trim() ||
    s.city.length > 120 ||
    (s.addressLine2 !== null && (typeof s.addressLine2 !== "string" || s.addressLine2.length > 200))
  )
    return undefined;
  return {
    addressLine1: s.addressLine1.trim(),
    addressLine2: typeof s.addressLine2 === "string" ? s.addressLine2.trim() || null : null,
    postalCode: s.postalCode,
    city: s.city.trim(),
    countryCode: "DE",
  };
}
export function parseDeliveryQuote(value: unknown): DeliveryQuote | undefined {
  const s = record(value);
  if (
    !s ||
    !exact(s, [
      "policyId",
      "subtotalAmountMinor",
      "deliveryFeeAmountMinor",
      "totalAmountMinor",
      "minimumAmountMinor",
      "currency",
    ]) ||
    typeof s.policyId !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s.policyId) ||
    s.currency !== "EUR" ||
    !amount(s.subtotalAmountMinor) ||
    !amount(s.deliveryFeeAmountMinor) ||
    s.deliveryFeeAmountMinor > 999999999 ||
    !amount(s.totalAmountMinor) ||
    !amount(s.minimumAmountMinor) ||
    s.minimumAmountMinor > 999999999 ||
    s.subtotalAmountMinor < s.minimumAmountMinor ||
    s.totalAmountMinor !== s.subtotalAmountMinor + s.deliveryFeeAmountMinor
  )
    return undefined;
  return s as unknown as DeliveryQuote;
}
export function parseDeliveryQuoteRequest(value: unknown): DeliveryQuoteRequest | undefined {
  const s = record(value);
  if (
    !s ||
    !exact(s, ["menuId", "menuVersionId", "requestedFor", "lines", "postalCode"]) ||
    typeof s.postalCode !== "string" ||
    !/^[0-9]{5}$/.test(s.postalCode)
  )
    return undefined;
  const { postalCode, ...order } = s;
  // Reuse the exact menu/time/quantity rules of the established checkout contract.
  const parsed = parseGuestPickupOrderRequest({
    ...order,
    submissionKey: "quote-validation",
    customer: { contactName: "Quote", phoneE164: "+999100000000", email: null },
    privacyNoticeVersion: "quote",
  });
  return parsed
    ? {
        menuId: parsed.menuId,
        menuVersionId: parsed.menuVersionId,
        requestedFor: parsed.requestedFor,
        lines: parsed.lines,
        postalCode,
      }
    : undefined;
}
export function parseGuestDeliveryOrderRequest(
  value: unknown,
): GuestDeliveryOrderRequest | undefined {
  const s = record(value);
  if (!s) return undefined;
  const { delivery, expectedQuote, ...order } = s;
  const parsed = parseGuestPickupOrderRequest(order),
    address = parseDeliveryAddress(delivery),
    quote = parseDeliveryQuote(expectedQuote);
  return parsed && address && quote
    ? { ...parsed, delivery: address, expectedQuote: quote }
    : undefined;
}
export function parseGuestDeliveryOrderConfirmation(
  value: unknown,
): GuestDeliveryOrderConfirmation | undefined {
  const s = record(value);
  if (
    !s ||
    s.fulfillmentType !== "delivery" ||
    !amount(s.subtotalAmountMinor) ||
    !amount(s.deliveryFeeAmountMinor) ||
    s.totalAmountMinor !== s.subtotalAmountMinor + s.deliveryFeeAmountMinor
  )
    return undefined;
  const parsed = parseGuestPickupOrderConfirmation({ ...s, fulfillmentType: "pickup" });
  return parsed
    ? {
        ...parsed,
        fulfillmentType: "delivery",
        subtotalAmountMinor: s.subtotalAmountMinor,
        deliveryFeeAmountMinor: s.deliveryFeeAmountMinor,
      }
    : undefined;
}
