import { parseDeliveryAddress, type DeliveryAddress } from "./delivery.js";
import { isExplicitInstant } from "./storefront.js";
import { publicOrderStatuses, type PublicOrderStatusName } from "./order-status.js";

export type DashboardOrderStatus = PublicOrderStatusName;

export interface DashboardOrderSummary {
  readonly orderId: string;
  readonly status: DashboardOrderStatus;
  readonly fulfillmentType: "pickup" | "delivery";
  readonly paymentCollectionMode: "on_fulfillment";
  readonly requestedFor: string;
  readonly currency: string;
  readonly totalAmountMinor: number;
  readonly itemCount: number;
  readonly updatedAt: string;
  readonly allowedTransitions: readonly DashboardOrderStatus[];
}

export interface DashboardOrderList {
  readonly restaurantId: string;
  readonly locationId: string;
  readonly orders: readonly DashboardOrderSummary[];
  readonly nextCursor: string | null;
}

export interface DashboardOrderLine {
  readonly lineNumber: number;
  readonly displayName: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly lineAmountMinor: number;
}

export interface DashboardOrderDetail extends DashboardOrderSummary {
  readonly delivery?: (DeliveryAddress & { recipientName: string; phoneE164: string }) | null;
  readonly deliveryFeeAmountMinor?: number;
  readonly restaurantId: string;
  readonly locationId: string;
  readonly contactName: string | null;
  readonly lines: readonly DashboardOrderLine[];
}

export interface DashboardOrderStatusCommand {
  readonly expectedStatus: DashboardOrderStatus;
  readonly targetStatus: DashboardOrderStatus;
}

export interface DashboardOrderStatusResult {
  readonly orderId: string;
  readonly status: DashboardOrderStatus;
  readonly updatedAt: string;
}

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const cursorPattern = /^(.+)\|([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function isStatus(value: unknown): value is DashboardOrderStatus {
  return typeof value === "string" && publicOrderStatuses.some((status) => status === value);
}

export function allowedOrderTransitions(
  status: DashboardOrderStatus,
): readonly DashboardOrderStatus[] {
  if (status === "submitted") return ["accepted", "rejected", "cancelled"];
  if (status === "accepted") return ["preparing", "cancelled"];
  if (status === "preparing") return ["ready", "cancelled"];
  if (status === "ready") return ["completed"];
  return [];
}

export function parseDashboardOrderCursor(
  value: string | null | undefined,
): { readonly requestedFor: string; readonly orderId: string } | undefined {
  if (!value || value.length > 96) return undefined;
  const match = cursorPattern.exec(value);
  if (!match?.[1] || !match[2] || !isExplicitInstant(match[1])) return undefined;
  return { requestedFor: match[1], orderId: match[2] };
}

function parseTransitions(value: unknown, status: DashboardOrderStatus) {
  if (!Array.isArray(value) || value.length > 3 || !value.every(isStatus)) return undefined;
  const transitions = value;
  const valid = allowedOrderTransitions(status);
  if (
    new Set(transitions).size !== transitions.length ||
    transitions.some((item) => !valid.includes(item))
  )
    return undefined;
  return transitions;
}

function parseSummary(value: unknown): DashboardOrderSummary | undefined {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, [
      "orderId",
      "status",
      "fulfillmentType",
      "paymentCollectionMode",
      "requestedFor",
      "currency",
      "totalAmountMinor",
      "itemCount",
      "updatedAt",
      "allowedTransitions",
    ]) ||
    typeof source.orderId !== "string" ||
    !uuidPattern.test(source.orderId) ||
    !isStatus(source.status) ||
    (source.fulfillmentType !== "pickup" && source.fulfillmentType !== "delivery") ||
    source.paymentCollectionMode !== "on_fulfillment" ||
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
    !isExplicitInstant(source.updatedAt)
  )
    return undefined;
  const allowedTransitions = parseTransitions(source.allowedTransitions, source.status);
  if (!allowedTransitions) return undefined;
  return {
    orderId: source.orderId,
    status: source.status,
    fulfillmentType: source.fulfillmentType,
    paymentCollectionMode: "on_fulfillment",
    requestedFor: source.requestedFor,
    currency: source.currency,
    totalAmountMinor: source.totalAmountMinor,
    itemCount: source.itemCount,
    updatedAt: source.updatedAt,
    allowedTransitions,
  };
}

export function parseDashboardOrderList(value: unknown): DashboardOrderList | undefined {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ["restaurantId", "locationId", "orders", "nextCursor"]) ||
    typeof source.restaurantId !== "string" ||
    !uuidPattern.test(source.restaurantId) ||
    typeof source.locationId !== "string" ||
    !uuidPattern.test(source.locationId) ||
    !Array.isArray(source.orders) ||
    source.orders.length > 50 ||
    (source.nextCursor !== null &&
      (typeof source.nextCursor !== "string" || !parseDashboardOrderCursor(source.nextCursor)))
  )
    return undefined;
  const orders = source.orders.map(parseSummary);
  if (orders.some((order) => !order)) return undefined;
  return {
    restaurantId: source.restaurantId,
    locationId: source.locationId,
    orders: orders as DashboardOrderSummary[],
    nextCursor: source.nextCursor,
  };
}

function parseLine(value: unknown): DashboardOrderLine | undefined {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, [
      "lineNumber",
      "displayName",
      "quantity",
      "unitPriceAmountMinor",
      "lineAmountMinor",
    ]) ||
    typeof source.lineNumber !== "number" ||
    !Number.isInteger(source.lineNumber) ||
    source.lineNumber < 1 ||
    typeof source.displayName !== "string" ||
    source.displayName.trim() !== source.displayName ||
    source.displayName.length < 1 ||
    source.displayName.length > 300 ||
    typeof source.quantity !== "number" ||
    !Number.isInteger(source.quantity) ||
    source.quantity < 1 ||
    source.quantity > 1000 ||
    typeof source.unitPriceAmountMinor !== "number" ||
    !Number.isSafeInteger(source.unitPriceAmountMinor) ||
    source.unitPriceAmountMinor < 0 ||
    typeof source.lineAmountMinor !== "number" ||
    !Number.isSafeInteger(source.lineAmountMinor) ||
    source.lineAmountMinor !== source.unitPriceAmountMinor * source.quantity
  )
    return undefined;
  return source as unknown as DashboardOrderLine;
}

export function parseDashboardOrderDetail(value: unknown): DashboardOrderDetail | undefined {
  const source = record(value);
  if (!source) return undefined;
  const summaryKeys = [
    "orderId",
    "status",
    "fulfillmentType",
    "paymentCollectionMode",
    "requestedFor",
    "currency",
    "totalAmountMinor",
    "itemCount",
    "updatedAt",
    "allowedTransitions",
  ];
  if (
    !exactKeys(source, [
      ...summaryKeys,
      "restaurantId",
      "locationId",
      "contactName",
      "lines",
      ...("delivery" in source ? ["delivery", "deliveryFeeAmountMinor"] : []),
    ]) ||
    typeof source.restaurantId !== "string" ||
    !uuidPattern.test(source.restaurantId) ||
    typeof source.locationId !== "string" ||
    !uuidPattern.test(source.locationId) ||
    (source.contactName !== null &&
      (typeof source.contactName !== "string" ||
        source.contactName.trim() !== source.contactName ||
        source.contactName.length < 1 ||
        source.contactName.length > 120)) ||
    !Array.isArray(source.lines) ||
    source.lines.length < 1 ||
    source.lines.length > 100
  )
    return undefined;
  const summary = parseSummary(Object.fromEntries(summaryKeys.map((key) => [key, source[key]])));
  const lines = source.lines.map(parseLine);
  if (!summary || lines.some((line) => !line)) return undefined;
  let delivery: DashboardOrderDetail["delivery"] = null;
  if (source.delivery !== undefined && source.delivery !== null) {
    const d = record(source.delivery);
    if (
      !d ||
      typeof d.recipientName !== "string" ||
      !d.recipientName.trim() ||
      d.recipientName.length > 120 ||
      typeof d.phoneE164 !== "string" ||
      !/^\+[1-9][0-9]{7,14}$/.test(d.phoneE164)
    )
      return undefined;
    const { recipientName, phoneE164, ...address } = d;
    const parsed = parseDeliveryAddress(address);
    if (!parsed || summary.fulfillmentType !== "delivery") return undefined;
    delivery = { ...parsed, recipientName, phoneE164 };
  }
  if (
    source.deliveryFeeAmountMinor !== undefined &&
    (typeof source.deliveryFeeAmountMinor !== "number" ||
      !Number.isSafeInteger(source.deliveryFeeAmountMinor) ||
      source.deliveryFeeAmountMinor < 0 ||
      source.deliveryFeeAmountMinor > summary.totalAmountMinor)
  )
    return undefined;
  return {
    ...summary,
    ...("delivery" in source
      ? { delivery, deliveryFeeAmountMinor: source.deliveryFeeAmountMinor as number }
      : {}),
    restaurantId: source.restaurantId,
    locationId: source.locationId,
    contactName: source.contactName,
    lines: lines as DashboardOrderLine[],
  };
}

export function parseDashboardOrderStatusCommand(
  value: unknown,
): DashboardOrderStatusCommand | undefined {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ["expectedStatus", "targetStatus"]) ||
    !isStatus(source.expectedStatus) ||
    !isStatus(source.targetStatus) ||
    !allowedOrderTransitions(source.expectedStatus).includes(source.targetStatus)
  )
    return undefined;
  return { expectedStatus: source.expectedStatus, targetStatus: source.targetStatus };
}

export function parseDashboardOrderStatusResult(
  value: unknown,
): DashboardOrderStatusResult | undefined {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ["orderId", "status", "updatedAt"]) ||
    typeof source.orderId !== "string" ||
    !uuidPattern.test(source.orderId) ||
    !isStatus(source.status) ||
    typeof source.updatedAt !== "string" ||
    !isExplicitInstant(source.updatedAt)
  )
    return undefined;
  return { orderId: source.orderId, status: source.status, updatedAt: source.updatedAt };
}
