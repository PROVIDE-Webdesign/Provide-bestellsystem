import type { DomainWebhookEnvironment } from "./domain-webhooks.js";
import {
  requestSupportPartialRefund,
  type SupportRefundEnvironment,
} from "./support-partial-refunds.js";
import { Client } from "pg";
import {
  parseSupportCommand,
  parseSupportState,
  parseSupportRefundCommand,
  parseSupportRefundState,
  type SupportCommand,
} from "@provide/contracts";
import { lockAccountSession } from "./account-session.js";
import {
  readBearerToken,
  dashboardAuthConfigured,
  InvalidDashboardTokenError,
  type DashboardAuthEnvironment,
  type DashboardIdentity,
  type DashboardTokenVerifier,
} from "./dashboard-auth.js";
import { jsonError, jsonSuccess, readJsonBody, RequestBodyError } from "./http.js";
import { createRequestContext, type RequestContext } from "./context.js";
import type { ApiLogger } from "./logger.js";
export interface SupportEnvironment extends DashboardAuthEnvironment {
  SUPPORT_CASES_ENABLED?: string;
  SUPPORT_RECONCILIATION_RESTAURANT_ID?: string;
  SUPPORT_MONITOR_PING_URL?: string;
  DASHBOARD_AUTH_ENABLED?: string;
  HYPERDRIVE_CACHE_DISABLED?: string;
  HYPERDRIVE?: { connectionString: string };
}
export type SupportRepository = (
  connection: string,
  identity: DashboardIdentity,
  command: SupportCommand,
) => Promise<unknown>;
export const postgresSupport: SupportRepository = async (connectionString, identity, command) => {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
  });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout='5s'");
    if (!(await lockAccountSession(client, identity))) {
      await client.query("ROLLBACK");
      return { outcome: "forbidden" };
    }
    const result = await client.query<{ data: unknown }>(
      "select private.support_command($1::uuid,$2::text,$3::text,$4::jsonb) as data",
      [identity.userId, identity.sessionId, identity.aal, JSON.stringify(command)],
    );
    await client.query("COMMIT");
    return result.rows[0]?.data;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};
export async function handleSupport(
  request: Request,
  env: SupportEnvironment & SupportRefundEnvironment,
  verifier: DashboardTokenVerifier,
  repository: SupportRepository,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
) {
  const fail = (status: number, code: Parameters<typeof jsonError>[0]) =>
    jsonError(code, "Support is not available.", context.requestId, status, cors);
  if (request.method !== "POST" || new URL(request.url).searchParams.size)
    return fail(400, "bad_request");
  if (
    env.SUPPORT_CASES_ENABLED !== "true" ||
    env.DASHBOARD_AUTH_ENABLED !== "true" ||
    !dashboardAuthConfigured(env) ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true" ||
    !env.HYPERDRIVE
  )
    return fail(503, "service_unavailable");
  const token = readBearerToken(request);
  if (!token) return fail(401, "unauthorized");
  let identity: DashboardIdentity;
  try {
    identity = await verifier.verify(token, env);
  } catch (error) {
    return error instanceof InvalidDashboardTokenError
      ? fail(401, "unauthorized")
      : fail(503, "service_unavailable");
  }
  if (identity.aal !== "aal2" || !identity.sessionId) return fail(403, "forbidden");
  let body: unknown;
  try {
    body = await readJsonBody(request, 4096);
  } catch (error) {
    return fail(error instanceof RequestBodyError ? error.status : 400, "bad_request");
  }
  const refund = parseSupportRefundCommand(body);
  const command = parseSupportCommand(body);
  if (!refund && !command) return fail(400, "bad_request");
  try {
    if (refund) {
      const r = await requestSupportPartialRefund(env, identity, refund);
      if (r?.outcome === "forbidden") return fail(403, "forbidden");
      if (r?.outcome === "not_found") return fail(404, "not_found");
      if (r?.outcome === "invalid") return fail(400, "bad_request");
      if (r?.outcome === "conflict") return fail(409, "conflict");
      const data = r?.outcome === "allowed" ? parseSupportRefundState(r.data, refund) : undefined;
      return data
        ? jsonSuccess(data, context.requestId, 200, cors)
        : fail(503, "service_unavailable");
    }
    if (!command) return fail(400, "bad_request");
    const r = (await repository(env.HYPERDRIVE.connectionString, identity, command)) as {
      outcome?: unknown;
      data?: unknown;
    };
    if (r?.outcome === "forbidden") return fail(403, "forbidden");
    if (r?.outcome === "invalid") return fail(400, "bad_request");
    if (r?.outcome === "not_found") return fail(404, "not_found");
    if (r?.outcome === "conflict") return fail(409, "conflict");
    const data = r?.outcome === "allowed" ? parseSupportState(r.data) : undefined;
    if (
      !data ||
      data.restaurantId !== command.restaurantId ||
      data.locationId !== command.locationId ||
      (command.action === "update" &&
        (data.cases.length !== 1 || data.cases[0]?.caseId !== command.caseId)) ||
      (command.action === "read" &&
        command.caseId !== null &&
        (data.cases.length !== 1 || data.cases[0]?.caseId !== command.caseId))
    )
      throw Error("Invalid support projection");
    return jsonSuccess(data, context.requestId, 200, cors);
  } catch {
    logger.error(context, "support_failed");
    return fail(503, "service_unavailable");
  }
}

export async function reconcileSupportSources(env: SupportEnvironment, logger: ApiLogger) {
  const restaurant = env.SUPPORT_RECONCILIATION_RESTAURANT_ID;
  if (env.SUPPORT_CASES_ENABLED !== "true" || !restaurant) return;
  const context = createRequestContext();
  if (
    !env.HYPERDRIVE ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(restaurant)
  ) {
    logger.error(context, "support_reconciliation_unavailable");
    return;
  }
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 7000,
  });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout='5s'");
    const result = await client.query<{ opened: number }>(
      "select private.reconcile_support_sources($1::uuid) as opened",
      [restaurant],
    );
    await client.query("COMMIT");
    if ((result.rows[0]?.opened ?? 0) > 0)
      logger.error(context, "support_reconciliation_cases_opened");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.error(context, "support_reconciliation_failed");
  } finally {
    await client.end().catch(() => undefined);
  }
}

type SupportMonitorEnvironment = SupportEnvironment &
  Pick<
    DomainWebhookEnvironment,
    "DOMAIN_WEBHOOK_ENABLED" | "DOMAIN_WEBHOOK_RESTAURANT_ID" | "DOMAIN_WEBHOOK_ACTIVE_SINCE"
  >;

export async function pingSupportMonitor(
  env: SupportMonitorEnvironment,
  logger: ApiLogger,
  fetcher: typeof fetch = fetch,
) {
  const raw = env.SUPPORT_MONITOR_PING_URL;
  if (!raw) return;
  const context = createRequestContext();
  if (!/^https:\/\/hc-ping\.com\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(raw)) {
    logger.error(context, "support_monitor_invalid_endpoint");
    return;
  }
  let needsAttention = true;
  const restaurant = env.SUPPORT_RECONCILIATION_RESTAURANT_ID;
  const checkWebhooks = env.DOMAIN_WEBHOOK_ENABLED === "true";
  if (
    env.SUPPORT_CASES_ENABLED === "true" &&
    env.HYPERDRIVE &&
    env.HYPERDRIVE_CACHE_DISABLED === "true" &&
    restaurant &&
    (!checkWebhooks ||
      (env.DOMAIN_WEBHOOK_RESTAURANT_ID === restaurant && env.DOMAIN_WEBHOOK_ACTIVE_SINCE))
  ) {
    const client = new Client({
      connectionString: env.HYPERDRIVE.connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 7000,
    });
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL ROLE service_role");
      await client.query("SET LOCAL statement_timeout='5s'");
      const result = await client.query<{ attention: boolean }>(
        "select private.support_jobs_need_attention($1::uuid,$2::timestamptz) as attention",
        [restaurant, checkWebhooks ? env.DOMAIN_WEBHOOK_ACTIVE_SINCE : null],
      );
      await client.query("COMMIT");
      needsAttention = result.rows[0]?.attention !== false;
    } catch {
      logger.error(context, "support_monitor_probe_failed");
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  try {
    const response = await fetcher(raw + (needsAttention ? "/fail" : ""), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) logger.error(context, "support_monitor_ping_rejected");
  } catch {
    logger.error(context, "support_monitor_ping_failed");
  }
}
