import { Client } from "pg";
import { parseRecoveryRequest, parseRecoveryCase, type RecoveryCommand } from "@provide/contracts";
import {
  dashboardAuthConfigured,
  readBearerToken,
  InvalidDashboardTokenError,
  type DashboardAuthEnvironment,
  type DashboardIdentity,
  type DashboardTokenVerifier,
} from "./dashboard-auth.js";
import { jsonError, jsonSuccess, readJsonBody, RequestBodyError } from "./http.js";
import type { RequestContext } from "./context.js";
import type { ApiLogger } from "./logger.js";
export interface RecoveryEnvironment extends DashboardAuthEnvironment {
  DASHBOARD_AUTH_ENABLED?: string;
  ACCOUNT_RECOVERY_ENABLED?: string;
  ACCOUNT_RECOVERY_ORIGIN?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  HYPERDRIVE_CACHE_DISABLED?: string;
  HYPERDRIVE?: { connectionString: string };
}
export interface RecoveryPlan {
  targetUserId: string;
  kind: string;
  factorIds: string[];
}
export interface RecoveryRepository {
  command(
    this: void,
    connection: string,
    identity: DashboardIdentity,
    q: RecoveryCommand,
  ): Promise<unknown>;
  plan(
    this: void,
    connection: string,
    identity: DashboardIdentity,
    caseId: string,
  ): Promise<RecoveryPlan | null>;
  finish(
    this: void,
    connection: string,
    identity: DashboardIdentity,
    q: RecoveryCommand,
    attemptFinished?: boolean,
  ): Promise<unknown>;
}
async function query(connectionString: string, sql: string, values: unknown[]) {
  const db = new Client({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 6000 });
  try {
    await db.connect();
    await db.query("BEGIN");
    await db.query("SET LOCAL ROLE service_role");
    await db.query("SET LOCAL statement_timeout='5s'");
    const result = await db.query<{ data: unknown }>(sql, values);
    await db.query("COMMIT");
    return result.rows[0]?.data;
  } catch (e) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await db.end();
  }
}
const identityArgs = (i: DashboardIdentity) => [i.userId, i.sessionId ?? null, i.aal];
export const postgresRecovery: RecoveryRepository = {
  command: (c, i, q) =>
    query(c, "select private.account_recovery_command($1,$2,$3,$4::jsonb) data", [
      ...identityArgs(i),
      JSON.stringify(q),
    ]),
  async plan(c, i, id) {
    const v = await query(c, "select private.account_recovery_effect_plan($1,$2,$3,$4) data", [
      ...identityArgs(i),
      id,
    ]);
    if (v === null) return null;
    if (
      !v ||
      typeof v !== "object" ||
      !("targetUserId" in v) ||
      !("kind" in v) ||
      !("factorIds" in v) ||
      typeof v.targetUserId !== "string" ||
      typeof v.kind !== "string" ||
      !Array.isArray(v.factorIds) ||
      v.factorIds.some((f) => typeof f !== "string")
    )
      throw Error("Invalid recovery plan");
    return v as RecoveryPlan;
  },
  finish: (c, i, q, attemptFinished = false) =>
    query(c, "select private.finish_account_recovery_effect($1,$2,$3,$4,$5,$6) data", [
      ...identityArgs(i),
      q.caseId,
      q.commandId,
      attemptFinished,
    ]),
};
export type RecoveryProvider = (
  env: RecoveryEnvironment,
  token: string,
  plan: RecoveryPlan,
  factorId: string | null,
  password?: string,
) => Promise<void>;
/** No token, password, provider body or TOTP secret is persisted or logged. */
export const supabaseRecoveryEffect: RecoveryProvider = async (
  env,
  token,
  plan,
  factorId,
  password,
) => {
  const base = env.SUPABASE_AUTH_ISSUER!.replace(/\/$/, "");
  const administrative = plan.kind === "lost_factor";
  const endpoint =
    plan.kind === "password"
      ? `${base}/user`
      : administrative
        ? `${base}/admin/users/${plan.targetUserId}/factors/${factorId}`
        : `${base}/factors/${factorId}`;
  const response = await fetch(endpoint, {
    method: plan.kind === "password" ? "PUT" : "DELETE",
    headers: {
      "content-type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
      authorization: `Bearer ${administrative ? env.SUPABASE_SERVICE_ROLE_KEY! : token}`,
    },
    ...(plan.kind === "password" ? { body: JSON.stringify({ password }) } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  await response.body?.cancel();
  if (!response.ok) throw Error("Provider effect requires reconciliation");
};
export async function handleAccountRecovery(
  request: Request,
  env: RecoveryEnvironment,
  verifier: DashboardTokenVerifier,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
  repository: RecoveryRepository = postgresRecovery,
  provider: RecoveryProvider = supabaseRecoveryEffect,
) {
  const fail = (status: number, code: Parameters<typeof jsonError>[0]) =>
    jsonError(code, "Recovery operation could not be completed.", context.requestId, status, cors);
  if (
    env.ACCOUNT_RECOVERY_ENABLED !== "true" ||
    env.DASHBOARD_AUTH_ENABLED !== "true" ||
    !dashboardAuthConfigured(env) ||
    !env.HYPERDRIVE ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true" ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  )
    return fail(503, "service_unavailable");
  if (
    request.method !== "POST" ||
    new URL(request.url).searchParams.size ||
    !env.ACCOUNT_RECOVERY_ORIGIN ||
    request.headers.get("origin") !== env.ACCOUNT_RECOVERY_ORIGIN
  )
    return fail(400, "bad_request");
  const token = readBearerToken(request);
  if (!token) return fail(401, "unauthorized");
  let identity: DashboardIdentity;
  try {
    identity = await verifier.verify(token, env);
  } catch (e) {
    return fail(
      e instanceof InvalidDashboardTokenError ? 401 : 503,
      e instanceof InvalidDashboardTokenError ? "unauthorized" : "service_unavailable",
    );
  }
  if (!identity.sessionId) return fail(401, "unauthorized");
  let body: ReturnType<typeof parseRecoveryRequest>;
  try {
    body = parseRecoveryRequest(await readJsonBody(request, 4096));
  } catch (e) {
    return fail(e instanceof RequestBodyError ? e.status : 400, "bad_request");
  }
  if (!body) return fail(400, "bad_request");
  try {
    let result = (await repository.command(
      env.HYPERDRIVE.connectionString,
      identity,
      body.command,
    )) as { outcome?: unknown; data?: unknown; effectClaimed?: unknown };
    const projection = parseRecoveryCase(result?.data);
    if (
      result?.outcome === "allowed" &&
      projection?.state === "executing" &&
      ["execute", "begin_password", "begin_replacement", "reconcile"].includes(body.command.action)
    ) {
      // A replay only reconciles actual state. It never sends the Auth mutation again.
      if (result.effectClaimed === true) {
        try {
          const plan = await repository.plan(
            env.HYPERDRIVE.connectionString,
            identity,
            body.command.caseId,
          );
          if (plan) {
            if (plan.kind === "password") await provider(env, token, plan, null, body.password);
            else
              for (const factorId of plan.factorIds) {
                const current = await repository.plan(
                  env.HYPERDRIVE.connectionString,
                  identity,
                  body.command.caseId,
                );
                if (!current) break;
                await provider(env, token, current, factorId);
              }
          }
        } catch {
          /* Lost response is reconciled against Auth rows, with no blind retry. */
        }
      }
      result = (await repository.finish(
        env.HYPERDRIVE.connectionString,
        identity,
        body.command,
        result.effectClaimed === true,
      )) as typeof result;
    }
    if (result?.outcome === "forbidden") return fail(403, "forbidden");
    if (result?.outcome === "conflict") return fail(409, "conflict");
    if (result?.outcome === "not_found") return fail(404, "not_found");
    if (result?.outcome === "invalid") return fail(400, "bad_request");
    const data = result?.outcome === "allowed" ? parseRecoveryCase(result.data) : undefined;
    if (!data || data.caseId !== body.command.caseId) throw Error("Invalid recovery projection");
    return jsonSuccess(data, context.requestId, 200, cors);
  } catch {
    logger.error(context, "account_recovery_failed");
    return fail(503, "service_unavailable");
  }
}
