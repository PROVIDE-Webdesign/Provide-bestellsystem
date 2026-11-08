import { isExplicitInstant, publicOrderStatuses, record } from "@provide/contracts";
import { Client } from "pg";
import { createRequestContext } from "./context.js";
import type { ApiLogger } from "./logger.js";

export interface DomainWebhookEnvironment {
  DOMAIN_WEBHOOK_ENABLED?: string;
  DOMAIN_WEBHOOK_URL?: string;
  DOMAIN_WEBHOOK_SIGNING_SECRET?: string;
  DOMAIN_WEBHOOK_RESTAURANT_ID?: string;
  DOMAIN_WEBHOOK_ACTIVE_SINCE?: string;
  HYPERDRIVE?: { connectionString: string };
  HYPERDRIVE_CACHE_DISABLED?: string;
}

type Outcome =
  "accepted" | "temporary_failure" | "confirmation_unknown" | "request_rejected" | "invalid_event";

interface DomainWebhookRepository {
  claim(
    connection: string,
    restaurant: string,
    activation: string,
    lease: string,
  ): Promise<unknown[]>;
  finish(connection: string, id: string, lease: string, outcome: Outcome): Promise<string>;
}

async function query<T>(connectionString: string, sql: string, values: string[]): Promise<T[]> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 7000,
  });
  try {
    await client.connect();
    await client.query("begin");
    await client.query("set local role service_role");
    await client.query("set local statement_timeout='5s'");
    const result = await client.query<{ data: T }>(sql, values);
    await client.query("commit");
    return result.rows.map((row) => row.data);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

const postgresDomainWebhooks: DomainWebhookRepository = {
  claim: (c, restaurant, activation, lease) =>
    query(
      c,
      "select to_jsonb(e) as data from private.claim_domain_webhooks_with_activations($1,$2,$3) e",
      [restaurant, activation, lease],
    ),
  finish: async (c, id, lease, outcome) =>
    (
      await query<string>(c, "select private.domain_webhook_finish($1,$2,$3) as data", [
        id,
        lease,
        outcome,
      ])
    )[0] ?? "conflict",
};

const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const instant = (v: unknown): v is string => typeof v === "string" && isExplicitInstant(v);
// PostgreSQL JSON retains up to six fractional digits; the wire contract uses milliseconds.
function databaseInstant(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/(\.\d{3})\d{1,3}(?=Z$|[+-]\d{2}:\d{2}$)/, "$1");
  return instant(normalized) ? new Date(normalized).toISOString() : undefined;
}

const statuses = new Set<string>(publicOrderStatuses);
const paymentStates = new Set<string>([
  "created",
  "pending_customer",
  "authorized",
  "captured",
  "failed",
  "cancelled",
  "expired",
  "partially_refunded",
  "refunded",
]);

export function domainWebhookEvents(raw: unknown) {
  const event = record(raw),
    payload = record(event?.payload);
  const occurredAt = databaseInstant(event?.created_at);
  if (
    !event ||
    !payload ||
    event.event_version !== 1 ||
    !uuid(event.id) ||
    !uuid(event.restaurant_id) ||
    !uuid(event.aggregate_id) ||
    !occurredAt ||
    !uuid(payload.location_id)
  )
    return undefined;
  const envelope = {
    eventId: event.id,
    schemaVersion: 1,
    restaurantId: event.restaurant_id,
    locationId: payload.location_id,
    occurredAt,
    objectId: event.aggregate_id,
    correlationId: event.aggregate_id,
  };
  if (event.aggregate_type === "order" && payload.order_id === event.aggregate_id) {
    if (
      event.event_type === "order.submitted" &&
      payload.status === "submitted" &&
      (payload.fulfillment_type === "pickup" || payload.fulfillment_type === "delivery")
    )
      return [
        {
          ...envelope,
          eventType: "order.submitted.v1",
          data: { fulfillmentType: payload.fulfillment_type },
        },
      ];
    if (
      event.event_type === "order.status_changed" &&
      uuid(payload.event_id) &&
      typeof payload.from_status === "string" &&
      statuses.has(payload.from_status) &&
      typeof payload.to_status === "string" &&
      statuses.has(payload.to_status)
    ) {
      const data = { from: payload.from_status, to: payload.to_status };
      const transition = { ...envelope, eventType: "order.status_changed.v1", data };
      return data.to === "accepted" || data.to === "rejected"
        ? [
            transition,
            { ...transition, eventId: payload.event_id, eventType: `order.${data.to}.v1` },
          ]
        : [transition];
    }
  }
  if (
    event.event_type === "payment.status_changed" &&
    event.aggregate_type === "payment" &&
    payload.payment_id === event.aggregate_id &&
    uuid(payload.order_id) &&
    typeof payload.from_status === "string" &&
    paymentStates.has(payload.from_status) &&
    typeof payload.to_status === "string" &&
    paymentStates.has(payload.to_status)
  )
    return [
      {
        ...envelope,
        correlationId: payload.order_id,
        eventType: "payment.status_changed.v1",
        data: { from: payload.from_status, to: payload.to_status },
      },
    ];
  const effectiveAt = databaseInstant(payload.effective_at);
  if (
    event.event_type === "menu.version.published" &&
    event.aggregate_type === "menu" &&
    uuid(payload.menu_version_id) &&
    effectiveAt
  )
    return [
      {
        ...envelope,
        eventType: "menu.published.v1",
        data: { menuVersionId: payload.menu_version_id, effectiveAt },
      },
    ];
  return undefined;
}

function configuration(env: DomainWebhookEnvironment) {
  if (
    !env.HYPERDRIVE ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true" ||
    !uuid(env.DOMAIN_WEBHOOK_RESTAURANT_ID) ||
    !instant(env.DOMAIN_WEBHOOK_ACTIVE_SINCE) ||
    !env.DOMAIN_WEBHOOK_SIGNING_SECRET ||
    new TextEncoder().encode(env.DOMAIN_WEBHOOK_SIGNING_SECRET).length < 32
  )
    return;
  try {
    const url = new URL(env.DOMAIN_WEBHOOK_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return;
    return {
      url,
      restaurant: env.DOMAIN_WEBHOOK_RESTAURANT_ID,
      activation: env.DOMAIN_WEBHOOK_ACTIVE_SINCE,
      secret: env.DOMAIN_WEBHOOK_SIGNING_SECRET,
      connection: env.HYPERDRIVE.connectionString,
    };
  } catch {
    return undefined;
  }
}

async function deliver(
  url: URL,
  secret: CryptoKey,
  event: NonNullable<ReturnType<typeof domainWebhookEvents>>[number],
  fetcher: typeof fetch,
): Promise<Outcome> {
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = await crypto.subtle.sign(
    "HMAC",
    secret,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const hex = Array.from(new Uint8Array(sig), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": event.eventId,
        "x-provide-signature": `t=${timestamp},v1=${hex}`,
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return "accepted";
    return response.status >= 500 || response.status === 408 || response.status === 429
      ? "temporary_failure"
      : "request_rejected";
  } catch {
    return "confirmation_unknown";
  }
}

export async function dispatchDomainWebhooks(
  env: DomainWebhookEnvironment,
  logger: ApiLogger,
  repository = postgresDomainWebhooks,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (env.DOMAIN_WEBHOOK_ENABLED !== "true") return;
  const config = configuration(env),
    context = createRequestContext();
  if (!config) {
    logger.error(context, "domain_webhook_dispatch_unavailable");
    return;
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(config.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const started = Date.now(),
      lease = crypto.randomUUID();
    const jobs = await repository.claim(
      config.connection,
      config.restaurant,
      config.activation,
      lease,
    );
    for (const job of jobs) {
      // Allow two signed calls per claimed row and leave headroom before lease expiry.
      if (Date.now() - started >= 110_000) break;
      const id = record(job)?.id;
      if (!uuid(id)) continue;
      const events = domainWebhookEvents(job);
      let outcome: Outcome = "invalid_event";
      if (events?.every((event) => event.restaurantId === config.restaurant)) {
        for (const event of events) {
          outcome = await deliver(config.url, key, event, fetcher);
          if (outcome !== "accepted") break;
        }
      }
      try {
        const status = await repository.finish(config.connection, id, lease, outcome);
        if (status === "dead_letter" || status === "conflict")
          logger.error(
            context,
            status === "dead_letter"
              ? "domain_webhook_dead_letter"
              : "domain_webhook_completion_conflict",
          );
      } catch {
        logger.error(context, "domain_webhook_completion_failed");
      }
    }
  } catch {
    logger.error(context, "domain_webhook_dispatch_failed");
  }
}
