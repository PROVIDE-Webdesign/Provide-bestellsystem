import { Client } from "pg";
import {
  parsePersonnelCommand,
  parsePersonnelState,
  personnelEmail,
  type PersonnelCommand,
} from "@provide/contracts";
import {
  dashboardAuthConfigured,
  InvalidDashboardTokenError,
  readBearerToken,
  type DashboardAuthEnvironment,
  type DashboardIdentity,
  type DashboardTokenVerifier,
} from "./dashboard-auth.js";
import { jsonError, jsonSuccess, readJsonBody, RequestBodyError } from "./http.js";
import type { RequestContext } from "./context.js";
import type { ApiLogger } from "./logger.js";
export interface PersonnelEnvironment extends DashboardAuthEnvironment {
  DASHBOARD_AUTH_ENABLED?: string;
  DASHBOARD_PERSONNEL_ENABLED?: string;
  PERSONNEL_INVITATIONS_ENABLED?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  PERSONNEL_DASHBOARD_ORIGIN?: string;
  HYPERDRIVE_CACHE_DISABLED?: string;
  HYPERDRIVE?: { connectionString: string };
}
export type PersonnelStage = "read" | "command" | "accept" | "claim" | "finish";
export type PersonnelRepository = (
  connection: string,
  identity: DashboardIdentity,
  command: PersonnelCommand,
  stage: PersonnelStage,
  result?: string,
) => Promise<unknown>;
export const postgresPersonnel: PersonnelRepository = async (
  connectionString,
  identity,
  q,
  stage,
  result,
) => {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
  });
  try {
    await client.connect();
    await client.query(stage === "read" ? "BEGIN READ ONLY" : "BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout='5s'");
    let sql: string, values: unknown[];
    if (stage === "accept" && q.action === "accept") {
      sql = "select private.accept_personnel($1::uuid,$2::text,$3::uuid) data";
      values = [identity.userId, identity.aal, q.invitationId];
    } else if ((stage === "claim" || stage === "finish") && q.action === "invite") {
      sql =
        stage === "claim"
          ? "select private.claim_personnel_dispatch($1::uuid,$2::text,$3::uuid,$4::uuid) data"
          : "select private.finish_personnel_dispatch($1::uuid,$2::text,$3::uuid,$4::uuid,$5::text) data";
      values = [identity.userId, identity.aal, q.restaurantId, q.requestId];
      if (stage === "finish") values.push(result);
    } else {
      sql =
        stage === "read"
          ? "select private.read_personnel($1::uuid,$2::text,$3::jsonb) data"
          : "select private.command_personnel($1::uuid,$2::text,$3::jsonb) data";
      values = [identity.userId, identity.aal, JSON.stringify(q)];
    }
    const r = await client.query<{ data: unknown }>(sql, values);
    await client.query("COMMIT");
    return r.rows[0]?.data;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
};
function dashboardOrigin(value: string | undefined) {
  try {
    const u = new URL(value ?? "");
    return !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === "/" &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname)))
      ? u
      : undefined;
  } catch {
    return undefined;
  }
}
export function personnelDeliveryConfigured(env: PersonnelEnvironment) {
  return (
    env.PERSONNEL_INVITATIONS_ENABLED === "true" &&
    dashboardAuthConfigured(env) &&
    !!env.SUPABASE_SERVICE_ROLE_KEY &&
    env.SUPABASE_SERVICE_ROLE_KEY.length <= 8192 &&
    !/\s/.test(env.SUPABASE_SERVICE_ROLE_KEY) &&
    !!dashboardOrigin(env.PERSONNEL_DASHBOARD_ORIGIN)
  );
}
export type PersonnelInviteProvider = (
  env: PersonnelEnvironment,
  email: string,
  existing: boolean,
) => Promise<"sent" | "failed" | "uncertain">;
/** Auth owns and sends links. No invitation/session secret enters application storage or logs. */
export const supabasePersonnelInvite: PersonnelInviteProvider = async (env, email, existing) => {
  if (!personnelDeliveryConfigured(env) || !personnelEmail(email)) return "failed";
  const endpoint = new URL(
    env.SUPABASE_AUTH_ISSUER!.replace(/\/$/, "") + (existing ? "/otp" : "/invite"),
  );
  endpoint.searchParams.set(
    "redirect_to",
    new URL("/invitations", dashboardOrigin(env.PERSONNEL_DASHBOARD_ORIGIN)).href,
  );
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
      body: JSON.stringify(existing ? { email, create_user: false } : { email }),
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    // A timeout or server error may have delivered mail; never automatically resend.
    const status = r.ok ? "sent" : r.status >= 400 && r.status < 500 ? "failed" : "uncertain";
    await r.body?.cancel();
    return status;
  } catch {
    return "uncertain";
  }
};
export async function handlePersonnel(
  request: Request,
  env: PersonnelEnvironment,
  verifier: DashboardTokenVerifier,
  repository: PersonnelRepository,
  provider: PersonnelInviteProvider,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
) {
  const fail = (status: number, code: Parameters<typeof jsonError>[0]) =>
    jsonError(code, "Personnel operation unavailable.", context.requestId, status, cors);
  if (request.method !== "POST" || new URL(request.url).searchParams.size)
    return fail(400, "bad_request");
  if (
    env.DASHBOARD_AUTH_ENABLED !== "true" ||
    env.DASHBOARD_PERSONNEL_ENABLED !== "true" ||
    !dashboardAuthConfigured(env) ||
    !env.HYPERDRIVE ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true"
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
  let q: PersonnelCommand | undefined;
  try {
    q = parsePersonnelCommand(await readJsonBody(request, 4096));
  } catch (e) {
    return fail(e instanceof RequestBodyError ? e.status : 400, "bad_request");
  }
  if (!q) return fail(400, "bad_request");
  if (q.action !== "inbox" && q.action !== "accept" && identity.aal !== "aal2")
    return fail(403, "forbidden");
  if (q.action === "invite" && !personnelDeliveryConfigured(env))
    return fail(503, "service_unavailable");
  try {
    let raw = (await repository(
      env.HYPERDRIVE.connectionString,
      identity,
      q,
      q.action === "read" || q.action === "inbox"
        ? "read"
        : q.action === "accept"
          ? "accept"
          : "command",
    )) as { outcome?: unknown; data?: unknown };
    if (q.action === "invite" && raw?.outcome === "allowed") {
      const claim = (await repository(env.HYPERDRIVE.connectionString, identity, q, "claim")) as {
        email?: unknown;
        existingUserId?: unknown;
      } | null;
      if (claim && personnelEmail(claim.email)) {
        const result = await provider(env, claim.email, typeof claim.existingUserId === "string");
        raw = (await repository(
          env.HYPERDRIVE.connectionString,
          identity,
          q,
          "finish",
          result,
        )) as typeof raw;
      } else
        raw = (await repository(
          env.HYPERDRIVE.connectionString,
          identity,
          { action: "read", restaurantId: q.restaurantId },
          "read",
        )) as typeof raw;
    }
    if (raw?.outcome === "forbidden") return fail(403, "forbidden");
    if (raw?.outcome === "conflict") return fail(409, "conflict");
    if (raw?.outcome === "invalid") return fail(400, "bad_request");
    if (raw?.outcome === "not_found") return fail(404, "not_found");
    const data = raw?.outcome === "allowed" ? parsePersonnelState(raw.data) : undefined;
    if (
      !data ||
      (q.action === "inbox" || q.action === "accept"
        ? data.mode !== "inbox"
        : data.mode !== "management" || data.restaurantId !== q.restaurantId)
    )
      throw Error("Invalid personnel projection");
    return jsonSuccess(
      data.mode === "management"
        ? { ...data, inviteDeliveryEnabled: personnelDeliveryConfigured(env) }
        : data,
      context.requestId,
      200,
      cors,
    );
  } catch {
    logger.error(context, "personnel_operation_failed");
    return fail(503, "service_unavailable");
  }
}
