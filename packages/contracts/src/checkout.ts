import { parseOrderSelectionLines, type OrderSelectionLine } from "./menu-selection.js";
import { isOrderNumber } from "./order-number.js";
import { isExplicitInstant, isStorefrontScope, type StorefrontScope } from "./storefront.js";

export interface GuestCheckoutCustomer {
  readonly contactName: string;
  readonly phoneE164: string | null;
  readonly email: string | null;
}

export interface GuestPickupOrderRequest {
  readonly menuId: string;
  readonly menuVersionId: string;
  readonly requestedFor: string;
  readonly lines: readonly OrderSelectionLine[];
  readonly submissionKey: string;
  readonly customer: GuestCheckoutCustomer;
  readonly privacyNoticeVersion: string;
}

export interface GuestPickupOrderCommand extends GuestPickupOrderRequest, StorefrontScope {}

export interface GuestPickupOrderConfirmation {
  readonly orderId: string;
  readonly orderNumber?: string;
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

function hasControlCharacters(value: string): boolean {
  return [...value].some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
}

export function isValidGuestEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 254 &&
    emailPattern.test(value) &&
    !hasControlCharacters(value)
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Missing contact methods normalize to null; every supplied method must be valid. */
export function parseGuestCheckoutCustomer(value: unknown): GuestCheckoutCustomer | undefined {
  const customer = record(value);
  if (
    !customer ||
    !exactKeys(customer, ["contactName", "phoneE164", "email"]) ||
    typeof customer.contactName !== "string" ||
    (customer.phoneE164 != null && typeof customer.phoneE164 !== "string") ||
    (customer.email != null && typeof customer.email !== "string") ||
    (typeof customer.email === "string" && hasControlCharacters(customer.email))
  )
    return undefined;
  const contactName = customer.contactName.trim();
  const phoneE164 =
    typeof customer.phoneE164 === "string" ? customer.phoneE164.trim() || null : null;
  const email =
    typeof customer.email === "string" ? customer.email.trim().toLowerCase() || null : null;
  if (
    !contactName ||
    contactName.length > 120 ||
    (!phoneE164 && !email) ||
    (phoneE164 !== null && !phonePattern.test(phoneE164)) ||
    (email !== null && !isValidGuestEmail(email))
  )
    return undefined;
  return { contactName, phoneE164, email };
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

  const customer = parseGuestCheckoutCustomer(source.customer);
  if (!customer) return undefined;

  const lines = parseOrderSelectionLines(source.lines);
  if (!lines) return undefined;

  return {
    menuId: source.menuId,
    menuVersionId: source.menuVersionId,
    requestedFor: source.requestedFor,
    lines,
    submissionKey: source.submissionKey,
    customer,
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
    (Object.hasOwn(source, "orderNumber") && !isOrderNumber(source.orderNumber)) ||
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
    ...(isOrderNumber(source.orderNumber) ? { orderNumber: source.orderNumber } : {}),
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
