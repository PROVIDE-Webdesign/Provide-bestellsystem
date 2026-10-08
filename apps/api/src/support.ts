import { Client } from "pg";
import { parseSupportCommand, parseSupportState, type SupportCommand } from "@provide/contracts";
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
import type { RequestContext } from "./context.js";
import type { ApiLogger } from "./logger.js";
export interface SupportEnvironment extends DashboardAuthEnvironment {
  SUPPORT_CASES_ENABLED?: string;
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
  env: SupportEnvironment,
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
  let command: SupportCommand | undefined;
  try {
    command = parseSupportCommand(await readJsonBody(request, 4096));
  } catch (error) {
    return fail(error instanceof RequestBodyError ? error.status : 400, "bad_request");
  }
  if (!command) return fail(400, "bad_request");
  try {
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
