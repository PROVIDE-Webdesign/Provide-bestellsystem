import { isOrderNumber } from "./order-number.js";
import { isExplicitInstant } from "./storefront.js";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const instant = (v: unknown): v is string => typeof v === "string" && isExplicitInstant(v);
function record(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
export interface AcceptanceOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly fulfillmentType: "pickup" | "delivery";
  readonly deadline: string;
  readonly escalatedAt: string | null;
}
export interface DashboardAcceptance {
  readonly restaurantId: string;
  readonly locationId: string;
  readonly serverNow: string;
  readonly timeoutRule: "manual_review";
  readonly totalPending: number;
  readonly orders: readonly AcceptanceOrder[];
}
export function parseDashboardAcceptance(value: unknown): DashboardAcceptance | undefined {
  const v = record(value);
  if (
    !v ||
    typeof v.restaurantId !== "string" ||
    !uuid.test(v.restaurantId) ||
    typeof v.locationId !== "string" ||
    !uuid.test(v.locationId) ||
    !instant(v.serverNow) ||
    v.timeoutRule !== "manual_review" ||
    !Number.isSafeInteger(v.totalPending) ||
    (v.totalPending as number) < 0 ||
    !Array.isArray(v.orders) ||
    v.orders.length > 100 ||
    (v.totalPending as number) < v.orders.length
  )
    return;
  const orders: AcceptanceOrder[] = [];
  for (const candidate of v.orders) {
    const o = record(candidate);
    if (
      !o ||
      typeof o.orderId !== "string" ||
      !uuid.test(o.orderId) ||
      !isOrderNumber(o.orderNumber) ||
      (o.fulfillmentType !== "pickup" && o.fulfillmentType !== "delivery") ||
      !instant(o.deadline) ||
      (o.escalatedAt !== null &&
        (!instant(o.escalatedAt) || Date.parse(o.escalatedAt) < Date.parse(o.deadline))) ||
      orders.some((old) => old.orderId === o.orderId)
    )
      return;
    orders.push({
      orderId: o.orderId,
      orderNumber: o.orderNumber,
      fulfillmentType: o.fulfillmentType,
      deadline: o.deadline,
      escalatedAt: o.escalatedAt,
    });
  }
  return {
    restaurantId: v.restaurantId,
    locationId: v.locationId,
    serverNow: v.serverNow,
    timeoutRule: v.timeoutRule,
    totalPending: v.totalPending as number,
    orders,
  };
}
export function orderLiveTopic(restaurantId: string, locationId: string): string {
  if (!uuid.test(restaurantId) || !uuid.test(locationId)) throw Error("Invalid live scope");
  return `orders:v1:${restaurantId.toLowerCase()}:${locationId.toLowerCase()}`;
}
export function parseOrderInvalidation(
  value: unknown,
): { schemaVersion: 1; id: string } | undefined {
  const v = record(value);
  if (
    !v ||
    Object.keys(v).length !== 2 ||
    v.schemaVersion !== 1 ||
    typeof v.id !== "string" ||
    !uuid.test(v.id)
  )
    return;
  return { schemaVersion: 1, id: v.id };
}
