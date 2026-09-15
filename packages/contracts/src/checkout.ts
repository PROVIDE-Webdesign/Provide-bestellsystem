import { isExplicitInstant, isStorefrontScope, type StorefrontScope } from "./storefront.js";

export interface GuestPickupOrderRequest {
  readonly menuId: string;
  readonly menuVersionId: string;
  readonly requestedFor: string;
  readonly lines: readonly { readonly menuItemId: string; readonly quantity: number }[];
  readonly submissionKey: string;
  readonly customer: {
    readonly contactName: string;
    readonly phoneE164: string;
    readonly email: string | null;
  };
  readonly privacyNoticeVersion: string;
}

export interface GuestPickupOrderCommand extends GuestPickupOrderRequest, StorefrontScope {}

export interface GuestPickupOrderConfirmation {
  readonly orderId: string;
  readonly statusAccessToken: string;
  readonly statusAvailableUntil: string;
  readonly status: "submitted";
  readonly fulfillmentType: "pickup";
  readonly paymentCollectionMode: "on_fulfillment";
  readonly requestedFor: string;
  readonly currency: string;
  readonly totalAmountMinor: number;
  readonly itemCount: number;
}

const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const submissionKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const noticePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const phonePattern = /^\+[1-9][0-9]{7,14}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const statusAccessTokenPattern = /^[A-Za-z0-9_-]{43}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function parseGuestPickupOrderRequest(value: unknown): GuestPickupOrderRequest | undefined {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, [
      "menuId",
      "menuVersionId",
      "requestedFor",
      "lines",
      "submissionKey",
      "customer",
      "privacyNoticeVersion",
    ]) ||
    typeof source.menuId !== "string" ||
    !idPattern.test(source.menuId) ||
    typeof source.menuVersionId !== "string" ||
    !idPattern.test(source.menuVersionId) ||
    typeof source.requestedFor !== "string" ||
    !isExplicitInstant(source.requestedFor) ||
    typeof source.submissionKey !== "string" ||
    !submissionKeyPattern.test(source.submissionKey) ||
    typeof source.privacyNoticeVersion !== "string" ||
    !noticePattern.test(source.privacyNoticeVersion) ||
    !Array.isArray(source.lines) ||
    source.lines.length < 1 ||
    source.lines.length > 100
  )
    return undefined;

  const customer = record(source.customer);
  if (!customer || !exactKeys(customer, ["contactName", "phoneE164", "email"])) return undefined;
  const contactName = typeof customer.contactName === "string" ? customer.contactName.trim() : "";
  const phoneE164 = typeof customer.phoneE164 === "string" ? customer.phoneE164.trim() : "";
  const email =
    customer.email === null
      ? null
      : typeof customer.email === "string"
        ? customer.email.trim().toLowerCase()
        : undefined;
  if (
    contactName.length < 1 ||
    contactName.length > 120 ||
    !phonePattern.test(phoneE164) ||
    email === undefined ||
    (email !== null && (email.length < 3 || email.length > 254 || !emailPattern.test(email)))
  )
    return undefined;

  const lines: { menuItemId: string; quantity: number }[] = [];
  const ids = new Set<string>();
  let itemCount = 0;
  for (const value of source.lines) {
    const line = record(value);
    if (
      !line ||
      !exactKeys(line, ["menuItemId", "quantity"]) ||
      typeof line.menuItemId !== "string" ||
      !idPattern.test(line.menuItemId) ||
      typeof line.quantity !== "number" ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 1000 ||
      ids.has(line.menuItemId)
    )
      return undefined;
    ids.add(line.menuItemId);
    itemCount += line.quantity;
    lines.push({ menuItemId: line.menuItemId, quantity: line.quantity });
  }
  if (itemCount > 1000) return undefined;

  return {
    menuId: source.menuId,
    menuVersionId: source.menuVersionId,
    requestedFor: source.requestedFor,
    lines,
    submissionKey: source.submissionKey,
    customer: { contactName, phoneE164, email },
    privacyNoticeVersion: source.privacyNoticeVersion,
  };
}

export function parseGuestPickupOrderConfirmation(
  value: unknown,
): GuestPickupOrderConfirmation | undefined {
  const source = record(value);
  if (
    !source ||
    typeof source.orderId !== "string" ||
    !idPattern.test(source.orderId) ||
    typeof source.statusAccessToken !== "string" ||
    !statusAccessTokenPattern.test(source.statusAccessToken) ||
    typeof source.statusAvailableUntil !== "string" ||
    !isExplicitInstant(source.statusAvailableUntil) ||
    source.status !== "submitted" ||
    source.fulfillmentType !== "pickup" ||
    source.paymentCollectionMode !== "on_fulfillment" ||
    typeof source.requestedFor !== "string" ||
    !isExplicitInstant(source.requestedFor) ||
    Date.parse(source.statusAvailableUntil) - Date.parse(source.requestedFor) !==
      48 * 60 * 60 * 1000 ||
    typeof source.currency !== "string" ||
    !/^[A-Z]{3}$/.test(source.currency) ||
    typeof source.totalAmountMinor !== "number" ||
    !Number.isSafeInteger(source.totalAmountMinor) ||
    source.totalAmountMinor < 0 ||
    typeof source.itemCount !== "number" ||
    !Number.isInteger(source.itemCount) ||
    source.itemCount < 1 ||
    source.itemCount > 1000
  )
    return undefined;
  return {
    orderId: source.orderId,
    statusAccessToken: source.statusAccessToken,
    statusAvailableUntil: source.statusAvailableUntil,
    status: "submitted",
    fulfillmentType: "pickup",
    paymentCollectionMode: "on_fulfillment",
    requestedFor: source.requestedFor,
    currency: source.currency,
    totalAmountMinor: source.totalAmountMinor,
    itemCount: source.itemCount,
  };
}

export function isGuestPickupOrderCommand(value: GuestPickupOrderCommand): boolean {
  return isStorefrontScope(value) && parseGuestPickupOrderRequest(value) !== undefined;
}
