import { lockAccountSession } from "./account-session.js";
import { Client } from "pg";
import {
  parseProvideAdminCommand,
  parseProvideAdminState,
  type ProvideAdminCommand,
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
  PROVIDE_ADMIN_ENABLED?: string;
  PROVIDE_ADMIN_LIVE_ENABLED?: string;
  HYPERDRIVE_CACHE_DISABLED?: string;
  HYPERDRIVE?: { connectionString: string };
}
export type ProvideAdminRepository = (
  connection: string,
  identity: DashboardIdentity,
  command: ProvideAdminCommand,
  allowLive: boolean,
) => Promise<unknown>;
export const postgresProvideAdmin: ProvideAdminRepository = async (
  connectionString,
  identity,
  command,
  allowLive,
) => {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
  });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    if (!(await lockAccountSession(client, identity))) {
      await client.query("ROLLBACK");
      return { outcome: "forbidden" };
    }
    await client.query("SET LOCAL statement_timeout='5s'");
    const result = await client.query<{ data: unknown }>(
      command.action === "read"
        ? "select private.read_provide_administration($1::uuid,$2::text,$3::jsonb) as data"
        : "select private.command_provide_administration($1::uuid,$2::text,$3::jsonb,$4::boolean) as data",
      command.action === "read"
        ? [identity.userId, identity.aal, JSON.stringify(command)]
        : [identity.userId, identity.aal, JSON.stringify(command), allowLive],
    );
    await client.query("COMMIT");
    return result.rows[0]?.data;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
};
export async function handleProvideAdmin(
  request: Request,
  env: Environment,
  verifier: DashboardTokenVerifier,
  repository: ProvideAdminRepository,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
) {
  const fail = (status: number, code: Parameters<typeof jsonError>[0]) =>
    jsonError(code, "Administration is not available.", context.requestId, status, cors);
  if (request.method !== "POST" || new URL(request.url).searchParams.size)
    return fail(400, "bad_request");
  if (
    env.DASHBOARD_AUTH_ENABLED !== "true" ||
    env.PROVIDE_ADMIN_ENABLED !== "true" ||
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
  let command: ProvideAdminCommand | undefined;
  try {
    command = parseProvideAdminCommand(await readJsonBody(request, 4096));
  } catch (e) {
    return fail(e instanceof RequestBodyError ? e.status : 400, "bad_request");
  }
  if (!command) return fail(400, "bad_request");
  if (
    command.action === "goLive" &&
    command.status === "live" &&
    env.PROVIDE_ADMIN_LIVE_ENABLED !== "true"
  )
    return fail(503, "service_unavailable");
  try {
    const r = (await repository(
      env.HYPERDRIVE.connectionString,
      identity,
      command,
      env.PROVIDE_ADMIN_LIVE_ENABLED === "true",
    )) as { outcome?: unknown; data?: unknown };
    if (r?.outcome === "forbidden") return fail(403, "forbidden");
    if (r?.outcome === "invalid") return fail(400, "bad_request");
    if (r?.outcome === "not_found") return fail(404, "not_found");
    if (r?.outcome === "conflict") return fail(409, "conflict");
    const data = r?.outcome === "allowed" ? parseProvideAdminState(r.data) : undefined;
    if (
      !data ||
      (command.restaurantId !== undefined &&
        data.selected?.restaurantId !== command.restaurantId) ||
      (command.action !== "read" && data.selected?.locationId !== command.locationId) ||
      (command.action === "read" &&
        command.locationId !== undefined &&
        data.selected?.locationId !== command.locationId)
    )
      throw Error("Invalid administration projection");
    return jsonSuccess(
      { ...data, liveActionsEnabled: env.PROVIDE_ADMIN_LIVE_ENABLED === "true" },
      context.requestId,
      200,
      cors,
    );
  } catch {
    logger.error(context, "provide_administration_failed");
    return fail(503, "service_unavailable");
  }
}
