import { isExplicitInstant, isStorefrontScope } from "./storefront.js";
import { isValidGuestEmail } from "./checkout.js";

export const emailTemplateKeys = [
  "order_submitted",
  "order_accepted",
  "order_rejected",
  "order_cancelled",
  "order_ready",
  "order_dispatched",
  "order_time_changed",
  "order_refunded",
] as const;
export type EmailTemplateKey = (typeof emailTemplateKeys)[number];
export const orderReasonLabels = {
  unavailable: "Das Restaurant kann die Bestellung derzeit nicht ausführen.",
  sold_out: "Ein bestellter Artikel ist nicht mehr verfügbar.",
  customer_request: "Die Bestellung wurde auf Kundenwunsch beendet.",
  operational: "Die Bestellung kann aus betrieblichen Gründen nicht ausgeführt werden.",
  payment_expired: "Die Zahlung wurde nicht rechtzeitig abgeschlossen.",
  unspecified: "Die Bestellung konnte nicht fortgeführt werden.",
} as const;
export type OrderReasonCode = keyof typeof orderReasonLabels;

export interface EmailReconcileJob {
  readonly deliveryId: string;
  readonly lockToken: string;
  readonly mode: "reconcile";
  readonly templateVersion: 1;
}
export type EmailDispatchJob = EmailSendJob | EmailReconcileJob;
export interface EmailSendJob {
  readonly deliveryId: string;
  readonly lockToken: string;
  readonly orderId: string;
  readonly mode: "send";
  readonly templateKey: EmailTemplateKey;
  readonly templateVersion: 1;
  readonly restaurantSlug: string;
  readonly locationSlug: string;
  readonly restaurantName: string;
  readonly pickupLocation: string;
  readonly locationTimezone: string;
  readonly fulfillmentType: "pickup" | "delivery";
  readonly email: string;
  readonly requestedFor: string;
  readonly confirmedFor: string | null;
  readonly reasonCode: OrderReasonCode;
  readonly refundAmountMinor: number | null;
  readonly currency: string;
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= max &&
    ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  );
}
export function parseEmailDispatchJob(value: unknown): EmailDispatchJob | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const s = value as Record<string, unknown>;
  if (s.mode === "reconcile") {
    return Object.keys(s).length === 4 &&
      ["deliveryId", "lockToken", "mode", "templateVersion"].every((key) =>
        Object.hasOwn(s, key),
      ) &&
      [s.deliveryId, s.lockToken].every((v) => typeof v === "string" && uuid.test(v)) &&
      s.templateVersion === 1
      ? (s as unknown as EmailReconcileJob)
      : undefined;
  }
  const keys = [
    "deliveryId",
    "lockToken",
    "orderId",
    "mode",
    "templateKey",
    "templateVersion",
    "restaurantSlug",
    "locationSlug",
    "restaurantName",
    "pickupLocation",
    "locationTimezone",
    "fulfillmentType",
    "email",
    "requestedFor",
    "confirmedFor",
    "reasonCode",
    "refundAmountMinor",
    "currency",
  ];
  if (
    Object.keys(s).length !== keys.length ||
    !Object.keys(s).every((k) => keys.includes(k)) ||
    ![s.deliveryId, s.lockToken, s.orderId].every((v) => typeof v === "string" && uuid.test(v)) ||
    s.mode !== "send" ||
    !emailTemplateKeys.includes(s.templateKey as EmailTemplateKey) ||
    s.templateVersion !== 1 ||
    typeof s.restaurantSlug !== "string" ||
    typeof s.locationSlug !== "string" ||
    !isStorefrontScope({ restaurantSlug: s.restaurantSlug, locationSlug: s.locationSlug }) ||
    !text(s.restaurantName, 160) ||
    !text(s.pickupLocation, 600) ||
    !text(s.locationTimezone, 100) ||
    (s.fulfillmentType !== "pickup" && s.fulfillmentType !== "delivery") ||
    !text(s.email, 254) ||
    !isValidGuestEmail(s.email) ||
    typeof s.requestedFor !== "string" ||
    !isExplicitInstant(s.requestedFor) ||
    (s.confirmedFor !== null &&
      (typeof s.confirmedFor !== "string" || !isExplicitInstant(s.confirmedFor))) ||
    typeof s.reasonCode !== "string" ||
    !Object.hasOwn(orderReasonLabels, s.reasonCode) ||
    (s.refundAmountMinor !== null &&
      (typeof s.refundAmountMinor !== "number" ||
        !Number.isSafeInteger(s.refundAmountMinor) ||
        s.refundAmountMinor <= 0 ||
        s.refundAmountMinor > 1e12)) ||
    typeof s.currency !== "string" ||
    !/^[A-Z]{3}$/.test(s.currency) ||
    (["order_accepted", "order_time_changed"].includes(String(s.templateKey)) &&
      s.confirmedFor === null) ||
    (s.templateKey === "order_ready" && s.fulfillmentType !== "pickup") ||
    (s.templateKey === "order_dispatched" && s.fulfillmentType !== "delivery") ||
    (s.templateKey === "order_refunded" && s.refundAmountMinor === null)
  )
    return undefined;
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: s.locationTimezone });
  } catch {
    return undefined;
  }
  return s as unknown as EmailDispatchJob;
}
export function parseEmailDispatchBatch(value: unknown): EmailDispatchJob[] | undefined {
  if (!Array.isArray(value) || value.length > 25) return undefined;
  const jobs = value.map(parseEmailDispatchJob);
  return jobs.every((j): j is EmailDispatchJob => !!j) ? jobs : undefined;
}

export interface OrderCommunication {
  readonly timezone: string;
  readonly confirmedFor: string | null;
  readonly dispatchedAt: string | null;
  readonly revision: number;
}
export function parseOrderCommunication(value: unknown): OrderCommunication | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const s = value as Record<string, unknown>;
  if (
    Object.keys(s).length !== 4 ||
    !["confirmedFor", "dispatchedAt", "revision", "timezone"].every((k) => Object.hasOwn(s, k)) ||
    !text(s.timezone, 100) ||
    typeof s.revision !== "number" ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 0 ||
    ![s.confirmedFor, s.dispatchedAt].every(
      (v) => v === null || (typeof v === "string" && isExplicitInstant(v)),
    )
  )
    return undefined;
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: s.timezone });
  } catch {
    return undefined;
  }
  return s as unknown as OrderCommunication;
}
export type OrderCommunicationCommand =
  | {
      readonly action: "confirm_time";
      readonly confirmedFor: string;
      readonly expectedStatus: "accepted" | "preparing" | "ready";
      readonly expectedRevision: number;
    }
  | {
      readonly action: "dispatch";
      readonly expectedStatus: "ready";
      readonly expectedRevision: number;
    };
export function parseOrderCommunicationCommand(
  value: unknown,
): OrderCommunicationCommand | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const s = value as Record<string, unknown>;
  const keys =
    s.action === "confirm_time"
      ? ["action", "confirmedFor", "expectedStatus", "expectedRevision"]
      : ["action", "expectedStatus", "expectedRevision"];
  if (
    Object.keys(s).length !== keys.length ||
    !Object.keys(s).every((k) => keys.includes(k)) ||
    typeof s.expectedRevision !== "number" ||
    !Number.isSafeInteger(s.expectedRevision) ||
    s.expectedRevision < 0 ||
    (s.action === "confirm_time"
      ? !["accepted", "preparing", "ready"].includes(String(s.expectedStatus)) ||
        typeof s.confirmedFor !== "string" ||
        !isExplicitInstant(s.confirmedFor)
      : s.action !== "dispatch" || s.expectedStatus !== "ready")
  )
    return undefined;
  return s as unknown as OrderCommunicationCommand;
}
