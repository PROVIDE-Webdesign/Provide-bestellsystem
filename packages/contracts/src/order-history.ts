import { menuIdPattern } from "./menu-selection.js";
import { isExplicitInstant } from "./storefront.js";
import { isOrderNumber } from "./order-number.js";
import { publicOrderStatuses } from "./order-status.js";
import {
  parseDashboardOrderDetail,
  parseDashboardOrderList,
  type DashboardOrderDetail,
  type DashboardOrderSummary,
} from "./dashboard-orders.js";

export interface HistoryQuery {
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly status?: (typeof publicOrderStatuses)[number];
  readonly fulfillmentType?: "pickup" | "delivery";
  readonly orderNumber?: string;
  readonly customerName?: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly orderId?: string;
}
export function isHistoryDate(v: unknown): v is string {
  return (
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isExplicitInstant(v + "T00:00:00Z")
  );
}
export function parseHistoryCursor(v: unknown): { createdAt: string; orderId: string } | undefined {
  if (typeof v !== "string" || v.length > 96) return undefined;
  const parts = v.split("|");
  const time = parts[0];
  if (
    parts.length !== 2 ||
    !time ||
    !parts[1] ||
    !menuIdPattern.test(parts[1]) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(time) ||
    !isExplicitInstant(time.replace(/\.(\d{3})\d{3}Z$/, ".$1Z"))
  )
    return undefined;
  return { createdAt: time, orderId: parts[1] };
}
function record(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
function keys(v: Record<string, unknown>, expected: readonly string[]) {
  return (
    Object.keys(v).length === expected.length && Object.keys(v).every((k) => expected.includes(k))
  );
}
export function parseHistoryQuery(v: unknown): HistoryQuery | undefined {
  const s = record(v);
  if (
    !s ||
    Object.keys(s).some(
      (k) =>
        ![
          "fromDate",
          "toDate",
          "status",
          "fulfillmentType",
          "orderNumber",
          "customerName",
          "cursor",
          "limit",
          "orderId",
        ].includes(k),
    ) ||
    (s.fromDate === undefined) !== (s.toDate === undefined) ||
    (s.fromDate !== undefined &&
      (!isHistoryDate(s.fromDate) ||
        !isHistoryDate(s.toDate) ||
        s.fromDate > s.toDate ||
        Date.parse(s.toDate) - Date.parse(s.fromDate) > 92 * 86400000)) ||
    (s.status !== undefined && !publicOrderStatuses.some((x) => x === s.status)) ||
    (s.fulfillmentType !== undefined &&
      s.fulfillmentType !== "pickup" &&
      s.fulfillmentType !== "delivery") ||
    (s.orderNumber !== undefined && !isOrderNumber(s.orderNumber)) ||
    (s.customerName !== undefined &&
      (typeof s.customerName !== "string" ||
        s.customerName.trim().length < 2 ||
        s.customerName.trim().length > 80 ||
        /[\p{Cc}\p{Cf}]/u.test(s.customerName))) ||
    (s.cursor !== undefined && !parseHistoryCursor(s.cursor)) ||
    (s.limit !== undefined &&
      (typeof s.limit !== "number" || !Number.isInteger(s.limit) || s.limit < 1 || s.limit > 50)) ||
    (s.orderId !== undefined && (typeof s.orderId !== "string" || !menuIdPattern.test(s.orderId)))
  )
    return undefined;
  return {
    ...s,
    ...(typeof s.customerName === "string" ? { customerName: s.customerName.trim() } : {}),
  };
}
export interface HistoryMetric {
  readonly period: "total" | "day" | "week";
  readonly date: string;
  readonly currency: string;
  readonly orderCount: number;
  readonly completedCount: number;
  readonly rejectedCount: number;
  readonly cancelledCount: number;
  readonly pickupCount: number;
  readonly deliveryCount: number;
  readonly completedGrossMinor: number;
  readonly averageCompletedMinor: number | null;
  readonly rejectionBasisPoints: number | null;
  readonly capturedMinor: number;
  readonly refundedMinor: number;
}
export interface HistoryEvent {
  readonly sequence: number;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly actorKind: "personnel" | "system";
  readonly at: string;
}
export interface OrderHistory {
  readonly restaurantId: string;
  readonly locationId: string;
  readonly timezone: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly serverNow: string;
  readonly orders: readonly DashboardOrderSummary[];
  readonly nextCursor: string | null;
  readonly metrics: readonly HistoryMetric[];
  readonly detail: {
    readonly order: DashboardOrderDetail;
    readonly events: readonly HistoryEvent[];
  } | null;
  readonly purge: { readonly lastRunAt: string } | null;
}
const metricKeys = [
  "period",
  "date",
  "currency",
  "orderCount",
  "completedCount",
  "rejectedCount",
  "cancelledCount",
  "pickupCount",
  "deliveryCount",
  "completedGrossMinor",
  "averageCompletedMinor",
  "rejectionBasisPoints",
  "capturedMinor",
  "refundedMinor",
];
function metric(v: unknown): HistoryMetric | undefined {
  const s = record(v);
  if (
    !s ||
    !keys(s, metricKeys) ||
    !["total", "day", "week"].includes(String(s.period)) ||
    !isHistoryDate(s.date) ||
    typeof s.currency !== "string" ||
    !/^[A-Z]{3}$/.test(s.currency)
  )
    return undefined;
  for (const k of metricKeys.slice(3))
    if (s[k] !== null || !["averageCompletedMinor", "rejectionBasisPoints"].includes(k)) {
      if (typeof s[k] !== "number" || !Number.isSafeInteger(s[k]) || s[k] < 0) return undefined;
    }
  const m = s as unknown as HistoryMetric;
  if (
    m.pickupCount + m.deliveryCount !== m.orderCount ||
    m.completedCount + m.rejectedCount + m.cancelledCount > m.orderCount ||
    m.refundedMinor > m.capturedMinor ||
    m.averageCompletedMinor !==
      (m.completedCount === 0 ? null : Math.round(m.completedGrossMinor / m.completedCount)) ||
    m.rejectionBasisPoints !==
      (m.orderCount === 0 ? null : Math.round((m.rejectedCount * 10000) / m.orderCount))
  )
    return undefined;
  return m;
}
export function parseOrderHistory(v: unknown): OrderHistory | undefined {
  const s = record(v);
  if (
    !s ||
    !keys(s, [
      "restaurantId",
      "locationId",
      "timezone",
      "fromDate",
      "toDate",
      "serverNow",
      "orders",
      "nextCursor",
      "metrics",
      "detail",
      "purge",
    ]) ||
    typeof s.timezone !== "string" ||
    s.timezone.length > 100 ||
    !isHistoryDate(s.fromDate) ||
    !isHistoryDate(s.toDate) ||
    s.fromDate > s.toDate ||
    Date.parse(s.toDate) - Date.parse(s.fromDate) > 92 * 86400000 ||
    typeof s.serverNow !== "string" ||
    !isExplicitInstant(s.serverNow) ||
    (s.nextCursor !== null && !parseHistoryCursor(s.nextCursor)) ||
    !Array.isArray(s.metrics) ||
    s.metrics.length > 500
  )
    return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: s.timezone });
  } catch {
    return undefined;
  }
  const list = parseDashboardOrderList({
    restaurantId: s.restaurantId,
    locationId: s.locationId,
    orders: s.orders,
    nextCursor: null,
  });
  const metrics = s.metrics.map(metric);
  if (!list || metrics.some((x) => !x)) return undefined;
  let detail: OrderHistory["detail"] = null;
  if (s.detail !== null) {
    const d = record(s.detail);
    const order = d && parseDashboardOrderDetail(d.order);
    if (
      !d ||
      !keys(d, ["order", "events"]) ||
      !order ||
      order.restaurantId !== list.restaurantId ||
      order.locationId !== list.locationId ||
      !Array.isArray(d.events) ||
      d.events.length > 20
    )
      return undefined;
    const events: HistoryEvent[] = [];
    for (const raw of d.events) {
      const e = record(raw);
      if (
        !e ||
        !keys(e, ["sequence", "fromStatus", "toStatus", "actorKind", "at"]) ||
        e.sequence !== events.length + 1 ||
        (e.fromStatus !== null && !publicOrderStatuses.some((x) => x === e.fromStatus)) ||
        !publicOrderStatuses.some((x) => x === e.toStatus) ||
        (e.actorKind !== "system" && e.actorKind !== "personnel") ||
        typeof e.at !== "string" ||
        !isExplicitInstant(e.at)
      )
        return undefined;
      events.push(e as unknown as HistoryEvent);
    }
    detail = { order, events };
  }
  const p = record(s.purge);
  if (
    s.purge !== null &&
    (!p ||
      !keys(p, ["lastRunAt"]) ||
      typeof p.lastRunAt !== "string" ||
      !isExplicitInstant(p.lastRunAt))
  )
    return undefined;
  return {
    ...list,
    timezone: s.timezone,
    fromDate: s.fromDate,
    toDate: s.toDate,
    serverNow: s.serverNow,
    nextCursor: s.nextCursor as string | null,
    metrics: metrics as HistoryMetric[],
    detail,
    purge: s.purge === null ? null : (p as OrderHistory["purge"]),
  };
}
