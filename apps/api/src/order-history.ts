import { lockAccountSession } from "./account-session.js";
import { Client } from "pg";
import {
  menuIdPattern,
  parseHistoryQuery,
  parseOrderHistory,
  type HistoryQuery,
} from "@provide/contracts";
import {
  readBearerToken,
  dashboardAuthConfigured,
  InvalidDashboardTokenError,
  type DashboardAuthEnvironment,
  type DashboardIdentity,
  type DashboardTokenVerifier,
} from "./dashboard-auth.js";
import { jsonError, jsonSuccess, readJsonBody, RequestBodyError } from "./http.js";
import type { RequestContext } from "./context.js";
import type { ApiLogger } from "./logger.js";
interface Environment extends DashboardAuthEnvironment {
  DASHBOARD_AUTH_ENABLED?: string;
  DASHBOARD_HISTORY_ENABLED?: string;
  GUEST_RETENTION_PURGE_ENABLED?: string;
  HYPERDRIVE_CACHE_DISABLED?: string;
  HYPERDRIVE?: { connectionString: string };
}
export type HistoryRepository = (
  connection: string,
  identity: DashboardIdentity,
  restaurant: string,
  location: string,
  query: HistoryQuery,
) => Promise<unknown>;
async function transaction(
  connectionString: string,
  sql: string,
  values: unknown[],
  _readOnly: boolean,
  identity?: DashboardIdentity,
) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
  });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    if (identity && !(await lockAccountSession(client, identity))) {
      await client.query("ROLLBACK");
      return { outcome: "forbidden" };
    }
    await client.query("SET LOCAL statement_timeout='5s'");
    const result = await client.query<{ data: unknown }>(sql, values);
    await client.query("COMMIT");
    return result.rows[0]?.data;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}
export const postgresHistory: HistoryRepository = (connection, identity, restaurant, location, q) =>
  transaction(
    connection,
    "select private.read_order_history($1::uuid,$2::text,$3::uuid,$4::uuid,$5::jsonb) as data",
    [identity.userId, identity.aal, restaurant, location, JSON.stringify(q)],
    true,
    identity,
  );
export const postgresGuestPurge = async (connection: string) => {
  const count = await transaction(
    connection,
    "select private.run_guest_retention_purge() as data",
    [],
    false,
  );
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 500)
    throw Error("Invalid purge result");
  return count;
};
export async function dispatchGuestPurge(
  env: Environment,
  logger: ApiLogger,
  purge = postgresGuestPurge,
) {
  if (
    env.GUEST_RETENTION_PURGE_ENABLED !== "true" ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true" ||
    !env.HYPERDRIVE
  )
    return;
  try {
    await purge(env.HYPERDRIVE.connectionString);
  } catch {
    logger.error({ requestId: crypto.randomUUID() }, "guest_retention_purge_failed");
  }
}
export async function handleOrderHistory(
  request: Request,
  scope: { restaurantId: string; locationId: string },
  env: Environment,
  verifier: DashboardTokenVerifier,
  repository: HistoryRepository,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
) {
  const fail = (status: number, code: Parameters<typeof jsonError>[0]) =>
    jsonError(code, "History is not available.", context.requestId, status, cors);
  if (
    request.method !== "POST" ||
    new URL(request.url).searchParams.size ||
    !menuIdPattern.test(scope.restaurantId) ||
    !menuIdPattern.test(scope.locationId)
  )
    return fail(400, "bad_request");
  if (
    env.DASHBOARD_AUTH_ENABLED !== "true" ||
    env.DASHBOARD_HISTORY_ENABLED !== "true" ||
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
  } catch (e) {
    return e instanceof InvalidDashboardTokenError
      ? fail(401, "unauthorized")
      : fail(503, "service_unavailable");
  }
  if (identity.aal !== "aal2") return fail(403, "forbidden");
  let query: HistoryQuery | undefined;
  try {
    query = parseHistoryQuery(await readJsonBody(request, 2048));
  } catch (e) {
    return fail(e instanceof RequestBodyError ? e.status : 400, "bad_request");
  }
  if (!query) return fail(400, "bad_request");
  try {
    const r = (await repository(
      env.HYPERDRIVE.connectionString,
      identity,
      scope.restaurantId,
      scope.locationId,
      query,
    )) as { outcome?: unknown; data?: unknown };
    if (r?.outcome === "forbidden") return fail(403, "forbidden");
    if (r?.outcome === "invalid") return fail(400, "bad_request");
    if (r?.outcome === "not_found") return fail(404, "not_found");
    const data = r?.outcome === "allowed" ? parseOrderHistory(r.data) : undefined;
    if (
      !data ||
      data.restaurantId !== scope.restaurantId ||
      data.locationId !== scope.locationId ||
      (query.orderId !== undefined && data.detail?.order.orderId !== query.orderId)
    )
      throw Error("Invalid history projection");
    return jsonSuccess(data, context.requestId, 200, cors);
  } catch {
    logger.error(context, "order_history_failed");
    return fail(503, "service_unavailable");
  }
}
