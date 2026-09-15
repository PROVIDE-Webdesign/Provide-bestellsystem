import type { DashboardOrderStatus } from "@provide/contracts";

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

export function formatOrderTime(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
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
