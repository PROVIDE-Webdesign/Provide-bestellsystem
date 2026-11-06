import { Client } from "pg";
import webpush from "web-push";
import { createRequestContext, type RequestContext } from "./context.js";
import type { DashboardTokenVerifier } from "./dashboard-auth.js";
import {
  authenticateDashboardOrders,
  type DashboardOrdersEnvironment,
} from "./dashboard-orders.js";
import { jsonError, jsonSuccess, readJsonBody, RequestBodyError } from "./http.js";
import type { ApiLogger } from "./logger.js";

export interface OrderPushEnvironment extends DashboardOrdersEnvironment {
  readonly DASHBOARD_ORDER_PUSH_ENABLED?: string;
  readonly ORDER_PUSH_VAPID_PUBLIC_KEY?: string;
  readonly ORDER_PUSH_VAPID_PRIVATE_KEY?: string;
  readonly ORDER_PUSH_VAPID_SUBJECT?: string;
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const publicKeyPattern = /^B[A-Za-z0-9_-]{86}$/;
const authPattern = /^[A-Za-z0-9_-]{22}$/;
const privateKeyPattern = /^[A-Za-z0-9_-]{43}$/;

export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1500) return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.pathname === "/" ||
      url.href !== value
    )
      return false;
    return (
      (url.hostname === "fcm.googleapis.com" && url.pathname.startsWith("/fcm/send/")) ||
      url.hostname === "updates.push.services.mozilla.com" ||
      url.hostname === "push.apple.com" ||
      /^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname) ||
      /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

type Command = {
  action: "status" | "subscribe" | "remove";
  endpoint: string;
  p256dh?: string;
  auth?: string;
};

export function parsePushCommand(value: unknown): Command | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["action", "endpoint", "p256dh", "auth"].includes(key)))
    return undefined;
  const { action, endpoint, p256dh, auth } = body;
  if (action === "status" || action === "remove") {
    if (p256dh !== undefined || auth !== undefined) return undefined;
    if (action === "status" && endpoint === undefined) return { action, endpoint: "" };
    if (validPushEndpoint(endpoint)) return { action, endpoint };
  }
  if (
    action === "subscribe" &&
    validPushEndpoint(endpoint) &&
    typeof p256dh === "string" &&
    publicKeyPattern.test(p256dh) &&
    typeof auth === "string" &&
    authPattern.test(auth)
  )
    return { action, endpoint, p256dh, auth };
  return undefined;
}

function vapid(env: OrderPushEnvironment) {
  const {
    ORDER_PUSH_VAPID_PUBLIC_KEY: publicKey,
    ORDER_PUSH_VAPID_PRIVATE_KEY: privateKey,
    ORDER_PUSH_VAPID_SUBJECT: subject,
  } = env;
  if (
    env.DASHBOARD_ORDER_PUSH_ENABLED !== "true" ||
    env.DASHBOARD_ORDER_ALERTS_ENABLED !== "true" ||
    env.DASHBOARD_AUTH_ENABLED !== "true" ||
    env.DASHBOARD_ORDER_OPERATIONS_ENABLED !== "true" ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true" ||
    !env.HYPERDRIVE ||
    !publicKey ||
    !publicKeyPattern.test(publicKey) ||
    !privateKey ||
    !privateKeyPattern.test(privateKey) ||
    !subject ||
    !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)
  )
    return undefined;
  return { publicKey, privateKey, subject };
}

async function database<T>(connectionString: string, work: (client: Client) => Promise<T>) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
  });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } finally {
    await client.end();
  }
}

export async function handleOrderPush(
  request: Request,
  scope: { restaurantId: string; locationId: string },
  env: OrderPushEnvironment,
  verifier: DashboardTokenVerifier,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
): Promise<Response> {
  const config = vapid(env);
  const unavailable = () =>
    jsonError("service_unavailable", "Push unavailable.", context.requestId, 503, cors);
  if (!config || !env.HYPERDRIVE) return unavailable();
  const identity = await authenticateDashboardOrders(request, env, verifier);
  if (identity === "unavailable") return unavailable();
  if (identity === "unauthorized" || !identity.sessionId)
    return jsonError("unauthorized", "Sign in first.", context.requestId, 401, cors);

  const invalid = () =>
    jsonError("bad_request", "Invalid push command.", context.requestId, 400, cors);
  if (!uuid.test(scope.restaurantId) || !uuid.test(scope.locationId)) return invalid();
  try {
    const command = parsePushCommand(await readJsonBody(request, 4096));
    if (!command) return invalid();
    // Reject invalid EC points during registration instead of retrying unusable jobs.
    if (command.p256dh) {
      try {
        await crypto.subtle.importKey(
          "raw",
          Uint8Array.from(atob(command.p256dh.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
            char.charCodeAt(0),
          ),
          { name: "ECDH", namedCurve: "P-256" },
          false,
          [],
        );
      } catch {
        return invalid();
      }
    }
    const result = await database(
      env.HYPERDRIVE.connectionString,
      async (client) =>
        (
          await client.query<{ data: { outcome: string; active?: boolean } }>(
            "select private.manage_order_push($1,$2,$3,$4,$5,$6,$7,$8,$9) as data",
            [
              identity.userId,
              identity.sessionId,
              identity.aal,
              command.action,
              scope.restaurantId,
              scope.locationId,
              command.endpoint,
              command.p256dh ?? null,
              command.auth ?? null,
            ],
          )
        ).rows[0]?.data,
    );
    if (result?.outcome === "forbidden")
      return jsonError("forbidden", "Access is not permitted.", context.requestId, 403, cors);
    if (result?.outcome === "conflict")
      return jsonError("conflict", "Device limit reached.", context.requestId, 409, cors);
    if (result?.outcome !== "allowed" || typeof result.active !== "boolean") return unavailable();
    return jsonSuccess(
      { active: result.active, publicKey: config.publicKey },
      context.requestId,
      200,
      cors,
    );
  } catch (error) {
    if (error instanceof RequestBodyError)
      return jsonError(error.code, error.message, context.requestId, error.status, cors);
    logger.error(context, "order_push_configuration_failed");
    return unavailable();
  }
}

type Delivery = {
  eventId: string;
  subscriptionId: string;
  lease: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};
type PushOutcome = "sent" | "gone" | "retry";

export async function sendOrderPush(
  delivery: Delivery,
  config: NonNullable<ReturnType<typeof vapid>>,
  fetcher: typeof fetch = fetch,
): Promise<PushOutcome> {
  if (!validPushEndpoint(delivery.endpoint)) return "gone";
  try {
    // The encrypted message carries only a deduplication key, never order or guest data.
    const message = webpush.generateRequestDetails(
      { endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } },
      JSON.stringify({ eventId: delivery.eventId }),
      {
        vapidDetails: config,
        TTL: 60,
        urgency: "high",
        topic: btoa(
          String.fromCharCode(
            ...delivery.eventId
              .replaceAll("-", "")
              .match(/../g)!
              .map((pair) => parseInt(pair, 16)),
          ),
        )
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", ""),
      },
    );
    const response = await fetcher(message.endpoint, {
      method: "POST",
      headers: message.headers,
      body: message.body ? new Uint8Array(message.body) : null,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel().catch(() => {});
    if (response.ok) return "sent";
    return response.status === 404 || response.status === 410 ? "gone" : "retry";
  } catch {
    return "retry";
  }
}

export async function dispatchOrderPush(
  env: OrderPushEnvironment,
  logger: ApiLogger,
  cleanup = false,
): Promise<void> {
  const config = vapid(env);
  if (!config || !env.HYPERDRIVE) return;
  const connectionString = env.HYPERDRIVE.connectionString;
  try {
    const deliveries = await database(
      connectionString,
      async (client) =>
        (await client.query<{ data: Delivery[] }>("select private.claim_order_push(4) as data"))
          .rows[0]?.data ?? [],
    );
    const outcomes = await Promise.all(
      deliveries.map((delivery) => sendOrderPush(delivery, config)),
    );
    if (outcomes.includes("retry"))
      logger.error(createRequestContext(), "order_push_provider_retry");
    if (!deliveries.length && !cleanup) return;
    await database(connectionString, async (client) => {
      for (const [index, delivery] of deliveries.entries()) {
        await client.query("select private.finish_order_push($1,$2,$3,$4,$5,$6,$7)", [
          delivery.eventId,
          delivery.subscriptionId,
          delivery.lease,
          outcomes[index],
          delivery.endpoint,
          delivery.p256dh,
          delivery.auth,
        ]);
      }
      if (cleanup) await client.query("select private.cleanup_order_push()");
    });
  } catch {
    logger.error(createRequestContext(), "order_push_dispatch_failed");
  }
}
