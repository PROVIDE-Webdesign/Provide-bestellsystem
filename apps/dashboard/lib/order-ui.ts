import {
  orderReference,
  paymentStateLabels,
  type DashboardOrderStatus,
  type DashboardOrderSummary,
} from "@provide/contracts";

export const orderStatusLabels: Record<DashboardOrderStatus, string> = {
  submitted: "Eingegangen",
  accepted: "Angenommen",
  preparing: "In Zubereitung",
  ready: "Abholbereit",
  completed: "Abgeschlossen",
  rejected: "Abgelehnt",
  cancelled: "Storniert",
};

export const transitionLabels: Partial<Record<DashboardOrderStatus, string>> = {
  accepted: "Annehmen",
  preparing: "Zubereitung starten",
  ready: "Als abholbereit markieren",
  completed: "Abschließen",
  rejected: "Ablehnen",
  cancelled: "Stornieren",
};

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amountMinor / 100);
}

export function formatOrderTime(value: string, timezone = "Europe/Berlin"): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function fulfillmentStatusLabel(
  status: DashboardOrderStatus,
  fulfillmentType: "pickup" | "delivery",
) {
  if (fulfillmentType === "delivery" && status === "ready") return "Bereit zur Auslieferung";
  if (fulfillmentType === "delivery" && status === "completed") return "Zugestellt";
  return orderStatusLabels[status];
}
export function fulfillmentTransitionLabel(
  status: DashboardOrderStatus,
  fulfillmentType: "pickup" | "delivery",
) {
  if (fulfillmentType === "delivery" && status === "ready") return "Zur Auslieferung bereit";
  if (fulfillmentType === "delivery" && status === "completed") return "Als zugestellt bestätigen";
  return transitionLabels[status];
}

export function shortOrderNumber(order: Pick<DashboardOrderSummary, "orderId" | "orderNumber">) {
  return order.orderNumber ? BigInt(order.orderNumber.slice(3)).toString() : orderReference(order);
}

export function operatorStage(order: Pick<DashboardOrderSummary, "status" | "fulfillmentType">) {
  if (order.status === "submitted") return "Neu";
  if (order.status === "accepted" || order.status === "preparing") return "In Zubereitung";
  if (order.status === "ready")
    return order.fulfillmentType === "delivery" ? "Bereit zur Lieferung" : "Abholbereit";
  return { completed: "Abgeschlossen", cancelled: "Storniert", rejected: "Abgelehnt" }[
    order.status
  ];
}

export function operatorPayment(order: DashboardOrderSummary) {
  if (order.paymentCollectionMode === "on_fulfillment")
    return order.fulfillmentType === "delivery" ? "Bei Lieferung zahlen" : "Bei Abholung zahlen";
  return order.paymentState === "paid"
    ? "Online bezahlt"
    : order.paymentState
      ? paymentStateLabels[order.paymentState]
      : "Onlinezahlung wird geprüft";
}

export function shortOrderTime(value: string, timezone = "Europe/Berlin") {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}
