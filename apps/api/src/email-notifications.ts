import { orderReasonLabels, type EmailDispatchJob, type EmailSendJob } from "@provide/contracts";
import { createRequestContext } from "./context.js";
import type { ApiLogger } from "./logger.js";
import {
  createStatusAccessToken,
  hasValidStatusSecret,
  statusAvailableUntil,
} from "./status-token.js";

export interface EmailMessage {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}
export type EmailAdapterResult =
  | { readonly outcome: "accepted"; readonly reference: string }
  | {
      readonly outcome: "temporary_failure" | "permanent_failure" | "unknown";
      readonly code: string;
    };
export type EmailLookupResult = EmailAdapterResult | { readonly outcome: "not_found" };
export interface EmailAdapter {
  readonly configured: boolean;
  send(
    this: void,
    command: EmailMessage & { readonly destination: string; readonly idempotencyKey: string },
  ): Promise<EmailAdapterResult>;
  lookup(this: void, idempotencyKey: string): Promise<EmailLookupResult>;
}
export interface EmailRepository {
  claim(
    this: void,
    connection: string,
    lock: string,
    limit: number,
    now: string,
  ): Promise<readonly EmailDispatchJob[]>;
  finish(
    this: void,
    connection: string,
    id: string,
    lock: string,
    result: EmailLookupResult,
    now: string,
  ): Promise<string>;
}
export interface EmailEnvironment {
  readonly EMAIL_DISPATCH_ENABLED?: string;
  readonly EMAIL_STOREFRONT_ORIGIN?: string;
  readonly ORDER_STATUS_TOKEN_SECRET?: string;
  readonly HYPERDRIVE_CACHE_DISABLED?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
}
export const unconfiguredEmailAdapter: EmailAdapter = {
  configured: false,
  send: () => Promise.resolve({ outcome: "unknown", code: "adapter_unavailable" }),
  lookup: () => Promise.resolve({ outcome: "unknown", code: "adapter_unavailable" }),
};
function origin(value: string | undefined): string | undefined {
  try {
    const u = new URL(value ?? "");
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.pathname === "/" &&
      !u.search &&
      !u.hash
      ? u.origin
      : undefined;
  } catch {
    return undefined;
  }
}
function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
export function renderEmailNotification(job: EmailSendJob, statusUrl: string): EmailMessage {
  const number = job.orderId.slice(-8).toUpperCase();
  const time = job.confirmedFor
    ? new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: job.locationTimezone,
      }).format(new Date(job.confirmedFor)) + " Uhr"
    : "";
  const method = job.fulfillmentType === "pickup" ? "Abholzeit" : "Lieferzeit";
  const phrases: Record<EmailSendJob["templateKey"], readonly [string, string]> = {
    order_submitted: [
      "ist eingegangen",
      `Ihre Bestellung bei ${job.restaurantName} ist eingegangen. Das Restaurant prüft sie jetzt. Eine Annahmebestätigung folgt separat.`,
    ],
    order_accepted: [
      "bestätigt",
      `Ihre Bestellung wurde angenommen. Bestätigte ${method}: ${time}.${job.fulfillmentType === "pickup" ? " Abholort: " + job.pickupLocation + "." : ""}`,
    ],
    order_rejected: [
      "abgelehnt",
      `Das Restaurant konnte Ihre Bestellung nicht annehmen. Grund: ${orderReasonLabels[job.reasonCode]} Den Zahlungs- und Erstattungsstand finden Sie auf der Statusseite.`,
    ],
    order_cancelled: [
      "storniert",
      `Ihre Bestellung wurde storniert. Grund: ${orderReasonLabels[job.reasonCode]} Den Zahlungs- und Erstattungsstand finden Sie auf der Statusseite.`,
    ],
    order_ready: [
      "ist abholbereit",
      `Ihre Bestellung ist zur Abholung bei ${job.pickupLocation} bereit.`,
    ],
    order_dispatched: ["ist unterwegs", "Ihre Lieferung ist unterwegs."],
    order_time_changed: [
      "hat eine neue Zeit",
      `Die bestätigte ${method} wurde geändert auf ${time}.`,
    ],
    order_refunded: [
      "Erstattung bestätigt",
      `Die Erstattung über ${new Intl.NumberFormat("de-DE", { style: "currency", currency: job.currency }).format((job.refundAmountMinor ?? 0) / 100)} wurde vom Zahlungsanbieter bestätigt. Die Anzeige auf Ihrem Konto kann später erfolgen.`,
    ],
  };
  const [ending, body] = phrases[job.templateKey];
  return {
    subject: `Bestellung ${number} ${ending}`,
    text: `${body}\n\nAktueller Stand: ${statusUrl}`,
    html: `<!doctype html><html lang="de"><head><meta charset="utf-8"></head><body><p>${escape(body)}</p><p><a href="${escape(statusUrl)}">Aktuellen Bestellstatus öffnen</a></p></body></html>`,
  };
}
const failureCodes = new Set([
  "provider_timeout",
  "provider_unavailable",
  "provider_rate_limited",
  "destination_rejected",
  "destination_invalid",
  "content_rejected",
  "adapter_request_failed",
  "invalid_adapter_result",
]);
function result(value: unknown, reconcile: boolean): EmailLookupResult {
  if (!value || typeof value !== "object")
    return { outcome: "unknown", code: "invalid_adapter_result" };
  const s = value as Record<string, unknown>;
  if (s.outcome === "not_found" && reconcile) return { outcome: "not_found" };
  if (
    s.outcome === "accepted" &&
    typeof s.reference === "string" &&
    /^[A-Za-z0-9:_-]{1,160}$/.test(s.reference)
  )
    return { outcome: "accepted", reference: s.reference };
  if (
    ["temporary_failure", "permanent_failure", "unknown"].includes(String(s.outcome)) &&
    typeof s.code === "string" &&
    failureCodes.has(s.code)
  )
    return {
      outcome: s.outcome as "temporary_failure" | "permanent_failure" | "unknown",
      code: s.code,
    };
  return { outcome: "unknown", code: "invalid_adapter_result" };
}
export async function dispatchEmailNotifications(
  env: EmailEnvironment,
  repository: EmailRepository,
  adapter: EmailAdapter,
  logger: ApiLogger,
  now: () => Date = () => new Date(),
): Promise<void> {
  if (env.EMAIL_DISPATCH_ENABLED !== "true") return;
  const context = createRequestContext(),
    base = origin(env.EMAIL_STOREFRONT_ORIGIN);
  if (
    !base ||
    !env.HYPERDRIVE ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true" ||
    !hasValidStatusSecret(env.ORDER_STATUS_TOKEN_SECRET) ||
    !adapter.configured
  ) {
    logger.error(context, "email_dispatch_unavailable");
    return;
  }
  try {
    const claimedAt = now().getTime();
    const jobs = await repository.claim(
      env.HYPERDRIVE.connectionString,
      crypto.randomUUID(),
      25,
      new Date(claimedAt).toISOString(),
    );
    for (const job of jobs) {
      // Do not start another provider request once the batch lease has expired.
      if (now().getTime() - claimedAt >= 5 * 60 * 1000) break;
      const idempotencyKey = `email:${job.deliveryId}:v${job.templateVersion}`;
      let completion: EmailLookupResult;
      try {
        if (job.mode === "reconcile")
          completion = result(await adapter.lookup(idempotencyKey), true);
        else {
          const token = await createStatusAccessToken(
            env.ORDER_STATUS_TOKEN_SECRET,
            job,
            job.orderId,
          );
          const url = new URL(`/r/${job.restaurantSlug}/${job.locationSlug}`, base);
          url.hash = new URLSearchParams({
            orderId: job.orderId,
            statusAccessToken: token,
            statusAvailableUntil: statusAvailableUntil(job.requestedFor)!,
          }).toString();
          completion = result(
            await adapter.send({
              ...renderEmailNotification(job, url.href),
              destination: job.email,
              idempotencyKey,
            }),
            false,
          );
        }
      } catch {
        completion = { outcome: "unknown", code: "adapter_request_failed" };
      }
      const outcome = await repository.finish(
        env.HYPERDRIVE.connectionString,
        job.deliveryId,
        job.lockToken,
        completion,
        now().toISOString(),
      );
      if (outcome === "conflict") logger.error(context, "email_completion_conflict");
    }
  } catch {
    logger.error(context, "email_dispatch_failed");
  }
}
