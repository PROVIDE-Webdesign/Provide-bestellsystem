import { Client } from "pg";
import {
  menuIdPattern,
  parseLocationOperationsCommand,
  parseLocationOperationsState,
  type LocationOperationsCommand,
} from "@provide/contracts";
import {
  readBearerToken,
  dashboardAuthConfigured,
  InvalidDashboardTokenError,
  type DashboardTokenVerifier,
  type DashboardIdentity,
  type DashboardAuthEnvironment,
} from "./dashboard-auth.js";
import { jsonError, jsonSuccess, readJsonBody, RequestBodyError } from "./http.js";
import type { RequestContext } from "./context.js";
import type { ApiLogger } from "./logger.js";
export type LocationOperationsRepository = (
  connection: string,
  identity: DashboardIdentity,
  restaurant: string,
  location: string,
  command: LocationOperationsCommand | null,
) => Promise<unknown>;
export const postgresLocationOperations: LocationOperationsRepository = async (
  connectionString,
  identity,
  restaurant,
  location,
  command,
) => {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 9000,
  });
  try {
    await client.connect();
    await client.query(command ? "BEGIN" : "BEGIN READ ONLY");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout='8s'");
    const r = await client.query<{ data: unknown }>(
      "select private.location_operations_dashboard($1,$2,$3,$4,$5::jsonb) as data",
      [
        identity.userId,
        identity.aal,
        restaurant,
        location,
        command === null ? null : JSON.stringify(command),
      ],
    );
    await client.query("COMMIT");
    return r.rows[0]?.data;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
};
interface Environment extends DashboardAuthEnvironment {
  DASHBOARD_AUTH_ENABLED?: string;
  DASHBOARD_LOCATION_OPERATIONS_ENABLED?: string;
  HYPERDRIVE_CACHE_DISABLED?: string;
  HYPERDRIVE?: { connectionString: string };
}
export async function handleLocationOperations(
  request: Request,
  scope: { restaurantId: string; locationId: string },
  env: Environment,
  verifier: DashboardTokenVerifier,
  repository: LocationOperationsRepository,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
) {
  const failure = (status: number, code: Parameters<typeof jsonError>[0]) =>
    jsonError(code, "Location operation could not be completed.", context.requestId, status, cors);
  if (
    request.url.length > 2048 ||
    !menuIdPattern.test(scope.restaurantId) ||
    !menuIdPattern.test(scope.locationId) ||
    new URL(request.url).searchParams.size
  )
    return failure(400, "bad_request");
  if (
    env.DASHBOARD_AUTH_ENABLED !== "true" ||
    env.DASHBOARD_LOCATION_OPERATIONS_ENABLED !== "true" ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true" ||
    !env.HYPERDRIVE ||
    !dashboardAuthConfigured(env)
  )
    return failure(503, "service_unavailable");
  const token = readBearerToken(request);
  if (!token) return failure(401, "unauthorized");
  let identity: DashboardIdentity;
  try {
    identity = await verifier.verify(token, env);
  } catch (e) {
    return failure(
      e instanceof InvalidDashboardTokenError ? 401 : 503,
      e instanceof InvalidDashboardTokenError ? "unauthorized" : "service_unavailable",
    );
  }
  if (identity.aal !== "aal2") return failure(403, "forbidden");
  let command: LocationOperationsCommand | null = null;
  if (request.method === "POST") {
    try {
      command = parseLocationOperationsCommand(await readJsonBody(request, 512 * 1024)) ?? null;
    } catch (e) {
      return failure(e instanceof RequestBodyError ? e.status : 400, "bad_request");
    }
    if (!command) return failure(400, "bad_request");
  }
  try {
    const r = (await repository(
      env.HYPERDRIVE.connectionString,
      identity,
      scope.restaurantId,
      scope.locationId,
      command,
    )) as { outcome?: unknown; data?: unknown };
    if (r?.outcome === "forbidden") return failure(403, "forbidden");
    if (r?.outcome === "conflict") return failure(409, "conflict");
    if (r?.outcome === "invalid") return failure(400, "bad_request");
    const data = r?.outcome === "allowed" ? parseLocationOperationsState(r.data) : undefined;
    if (!data) throw Error("Invalid menu projection");
    return jsonSuccess(data, context.requestId, 200, cors);
  } catch {
    logger.error(context, "location_operations_failed");
    return failure(503, "service_unavailable");
  }
}
