import { isExplicitInstant } from "./storefront.js";

export const orderNotificationTemplateKeys = [
  "order_submitted",
  "order_accepted",
  "order_rejected",
  "order_ready",
  "order_cancelled",
] as const;

export type OrderNotificationTemplateKey = (typeof orderNotificationTemplateKeys)[number];

export interface NotificationDispatchJob {
  readonly deliveryId: string;
  readonly lockToken: string;
  readonly orderId: string;
  readonly channel: "sms";
  readonly templateKey: OrderNotificationTemplateKey;
  readonly templateVersion: 1;
  readonly targetStatus: "submitted" | "accepted" | "rejected" | "ready" | "cancelled";
  readonly restaurantName: string;
  readonly requestedFor: string;
  readonly locationTimezone: string;
  readonly phoneE164: string;
}

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const phonePattern = /^\+[1-9][0-9]{7,14}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseNotificationDispatchJob(value: unknown): NotificationDispatchJob | undefined {
  const source = record(value);
  if (
    !source ||
    Object.keys(source).length !== 11 ||
    !Object.keys(source).every((key) =>
      [
        "deliveryId",
        "lockToken",
        "orderId",
        "channel",
        "templateKey",
        "templateVersion",
        "targetStatus",
        "restaurantName",
        "requestedFor",
        "locationTimezone",
        "phoneE164",
      ].includes(key),
    ) ||
    typeof source.deliveryId !== "string" ||
    !uuidPattern.test(source.deliveryId) ||
    typeof source.lockToken !== "string" ||
    !uuidPattern.test(source.lockToken) ||
    typeof source.orderId !== "string" ||
    !uuidPattern.test(source.orderId) ||
    source.channel !== "sms" ||
    typeof source.templateKey !== "string" ||
    !orderNotificationTemplateKeys.some((key) => key === source.templateKey) ||
    source.templateVersion !== 1 ||
    typeof source.targetStatus !== "string" ||
    source.templateKey !== `order_${source.targetStatus}` ||
    typeof source.restaurantName !== "string" ||
    source.restaurantName.trim() !== source.restaurantName ||
    source.restaurantName.length < 1 ||
    source.restaurantName.length > 160 ||
    typeof source.requestedFor !== "string" ||
    !isExplicitInstant(source.requestedFor) ||
    typeof source.locationTimezone !== "string" ||
    source.locationTimezone.length < 1 ||
    source.locationTimezone.length > 100 ||
    typeof source.phoneE164 !== "string" ||
    !phonePattern.test(source.phoneE164)
  )
    return undefined;

  return source as unknown as NotificationDispatchJob;
}

export function parseNotificationDispatchBatch(
  value: unknown,
): NotificationDispatchJob[] | undefined {
  if (!Array.isArray(value) || value.length > 25) return undefined;
  const jobs = value.map(parseNotificationDispatchJob);
  return jobs.every((job): job is NotificationDispatchJob => job !== undefined) ? jobs : undefined;
}
