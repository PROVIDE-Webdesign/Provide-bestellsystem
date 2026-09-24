import { isPaymentState, type PaymentState } from "./online-payment.js";
import { isExplicitInstant } from "./storefront.js";

export const publicOrderStatuses = [
  "submitted",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "rejected",
  "cancelled",
] as const;

export type PublicOrderStatusName = (typeof publicOrderStatuses)[number];

export interface PublicOrderStatusRequest {
  readonly orderId: string;
  readonly statusAccessToken: string;
}

export interface PublicOrderStatus {
  readonly orderId: string;
  readonly status: PublicOrderStatusName;
  readonly fulfillmentType: "pickup" | "delivery";
  readonly paymentCollectionMode: "on_fulfillment" | "online";
  readonly paymentState?: PaymentState | null;
  readonly requestedFor: string;
  readonly currency: string;
  readonly totalAmountMinor: number;
  readonly itemCount: number;
  readonly updatedAt: string;
  readonly statusAvailableUntil: string;
}

const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

export function parsePublicOrderStatusRequest(
  value: unknown,
): PublicOrderStatusRequest | undefined {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ["orderId", "statusAccessToken"]) ||
    typeof source.orderId !== "string" ||
    !idPattern.test(source.orderId) ||
    typeof source.statusAccessToken !== "string" ||
    !tokenPattern.test(source.statusAccessToken)
  )
    return undefined;
  return { orderId: source.orderId, statusAccessToken: source.statusAccessToken };
}

export function parsePublicOrderStatus(value: unknown): PublicOrderStatus | undefined {
  const source = record(value);
  if (
    !source ||
    typeof source.orderId !== "string" ||
    !idPattern.test(source.orderId) ||
    typeof source.status !== "string" ||
    !publicOrderStatuses.some((status) => status === source.status) ||
    (source.fulfillmentType !== "pickup" && source.fulfillmentType !== "delivery") ||
    (source.paymentCollectionMode !== "on_fulfillment" &&
      source.paymentCollectionMode !== "online") ||
    (source.paymentState !== undefined &&
      source.paymentState !== null &&
      !isPaymentState(source.paymentState)) ||
    typeof source.requestedFor !== "string" ||
    !isExplicitInstant(source.requestedFor) ||
    typeof source.currency !== "string" ||
    !/^[A-Z]{3}$/.test(source.currency) ||
    typeof source.totalAmountMinor !== "number" ||
    !Number.isSafeInteger(source.totalAmountMinor) ||
    source.totalAmountMinor < 0 ||
    typeof source.itemCount !== "number" ||
    !Number.isInteger(source.itemCount) ||
    source.itemCount < 1 ||
    source.itemCount > 1000 ||
    typeof source.updatedAt !== "string" ||
    !isExplicitInstant(source.updatedAt) ||
    typeof source.statusAvailableUntil !== "string" ||
    !isExplicitInstant(source.statusAvailableUntil) ||
    Date.parse(source.statusAvailableUntil) - Date.parse(source.requestedFor) !==
      48 * 60 * 60 * 1000
  )
    return undefined;
  return {
    orderId: source.orderId,
    status: source.status as PublicOrderStatusName,
    fulfillmentType: source.fulfillmentType,
    paymentCollectionMode: source.paymentCollectionMode,
    ...("paymentState" in source
      ? { paymentState: source.paymentState as PaymentState | null }
      : {}),
    requestedFor: source.requestedFor,
    currency: source.currency,
    totalAmountMinor: source.totalAmountMinor,
    itemCount: source.itemCount,
    updatedAt: source.updatedAt,
    statusAvailableUntil: source.statusAvailableUntil,
  };
}
