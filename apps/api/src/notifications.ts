import type { NotificationDispatchJob } from "@provide/contracts";

import { createRequestContext } from "./context.js";
import type { ApiLogger } from "./logger.js";

export interface NotificationEnvironment {
  readonly NOTIFICATION_DISPATCH_ENABLED?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
}

export type NotificationAdapterResult =
  | { readonly outcome: "accepted" }
  | {
      readonly outcome: "temporary_failure" | "permanent_failure";
      readonly code: string;
    };

export interface NotificationAdapter {
  readonly configured: boolean;
  send(command: {
    readonly idempotencyKey: string;
    readonly destination: string;
    readonly body: string;
  }): Promise<NotificationAdapterResult>;
}

export interface NotificationRepository {
  claim(
    connectionString: string,
    lockToken: string,
    batchSize: number,
    now: string,
  ): Promise<readonly NotificationDispatchJob[]>;
  finish(
    connectionString: string,
    deliveryId: string,
    lockToken: string,
    result: NotificationAdapterResult,
    now: string,
  ): Promise<"sent" | "retry" | "dead_letter" | "conflict">;
}

export const unconfiguredNotificationAdapter: NotificationAdapter = {
  configured: false,
  send: () => Promise.resolve({ outcome: "permanent_failure", code: "adapter_unavailable" }),
};

const adapterFailureCodes = new Set([
  "adapter_request_failed",
  "content_rejected",
  "destination_invalid",
  "destination_rejected",
  "invalid_adapter_result",
  "provider_rate_limited",
  "provider_timeout",
  "provider_unavailable",
]);

function validResult(value: unknown): value is NotificationAdapterResult {
  if (!value || typeof value !== "object" || !("outcome" in value)) return false;
  const result = value as { readonly outcome?: unknown; readonly code?: unknown };
  return (
    (result.outcome === "accepted" && result.code === undefined) ||
    ((result.outcome === "temporary_failure" || result.outcome === "permanent_failure") &&
      typeof result.code === "string" &&
      adapterFailureCodes.has(result.code))
  );
}

function pickupTime(job: NotificationDispatchJob): string {
  const formatter = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: job.locationTimezone,
  });
  return formatter.format(new Date(job.requestedFor)).replace(",", " um") + " Uhr";
}

export function renderOrderNotification(job: NotificationDispatchJob): string {
  const restaurant = job.restaurantName;
  let message: string;
  switch (job.templateKey) {
    case "order_submitted":
      message = `PROVIDE: Ihre Abholbestellung bei ${restaurant} ist eingegangen. Abholung am ${pickupTime(job)}.`;
      break;
    case "order_accepted":
      message = `PROVIDE: Ihre Abholbestellung bei ${restaurant} wurde angenommen. Abholung am ${pickupTime(job)}.`;
      break;
    case "order_rejected":
      message = `PROVIDE: Ihre Abholbestellung bei ${restaurant} wurde abgelehnt.`;
      break;
    case "order_ready":
      message = `PROVIDE: Ihre Abholbestellung bei ${restaurant} ist jetzt abholbereit.`;
      break;
    case "order_cancelled":
      message = `PROVIDE: Ihre Abholbestellung bei ${restaurant} wurde storniert.`;
      break;
  }
  if (message.length > 320) throw new Error("Notification template exceeds the SMS boundary");
  return message;
}

async function processJob(
  environment: NotificationEnvironment & { HYPERDRIVE: { connectionString: string } },
  job: NotificationDispatchJob,
  repository: NotificationRepository,
  adapter: NotificationAdapter,
  now: () => Date,
): Promise<"sent" | "retry" | "dead_letter" | "conflict"> {
  let result: NotificationAdapterResult;
  try {
    const response = await adapter.send({
      idempotencyKey: `notification:${job.deliveryId}:v${job.templateVersion}`,
      destination: job.phoneE164,
      body: renderOrderNotification(job),
    });
    result = validResult(response)
      ? response
      : { outcome: "permanent_failure", code: "invalid_adapter_result" };
  } catch {
    result = { outcome: "temporary_failure", code: "adapter_request_failed" };
  }
  return repository.finish(
    environment.HYPERDRIVE.connectionString,
    job.deliveryId,
    job.lockToken,
    result,
    now().toISOString(),
  );
}

export async function dispatchOrderNotifications(
  environment: NotificationEnvironment,
  repository: NotificationRepository,
  adapter: NotificationAdapter,
  logger: ApiLogger,
  now: () => Date = () => new Date(),
): Promise<void> {
  if (environment.NOTIFICATION_DISPATCH_ENABLED !== "true") return;
  const context = createRequestContext();
  if (!environment.HYPERDRIVE || !adapter.configured) {
    logger.error(context, "notification_dispatch_unavailable");
    return;
  }

  try {
    const jobs = await repository.claim(
      environment.HYPERDRIVE.connectionString,
      crypto.randomUUID(),
      25,
      now().toISOString(),
    );
    for (const job of jobs) {
      const status = await processJob(
        environment as NotificationEnvironment & {
          HYPERDRIVE: { connectionString: string };
        },
        job,
        repository,
        adapter,
        now,
      );
      if (status === "conflict") logger.error(context, "notification_completion_conflict");
    }
  } catch {
    logger.error(context, "notification_dispatch_failed");
  }
}
