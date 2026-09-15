import { parseDashboardAccessContext, type DashboardAccessContext } from "@provide/contracts";

import type { RequestContext } from "./context.js";
import type { ApiLogger } from "./logger.js";
import { jsonError, jsonSuccess } from "./http.js";
import {
  dashboardAuthConfigured,
  InvalidDashboardTokenError,
  readBearerToken,
  type DashboardAuthEnvironment,
  type DashboardIdentity,
  type DashboardTokenVerifier,
} from "./dashboard-auth.js";

export interface DashboardAccessEnvironment extends DashboardAuthEnvironment {
  readonly DASHBOARD_AUTH_ENABLED?: string;
  readonly HYPERDRIVE_CACHE_DISABLED?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
}

export interface DashboardAccessReader {
  read(connectionString: string, userId: string, aal: "aal1" | "aal2"): Promise<unknown>;
}

export async function handleDashboardAccess(
  request: Request,
  environment: DashboardAccessEnvironment,
  verifier: DashboardTokenVerifier,
  reader: DashboardAccessReader,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
): Promise<Response> {
  if (
    environment.DASHBOARD_AUTH_ENABLED !== "true" ||
    !dashboardAuthConfigured(environment) ||
    !environment.HYPERDRIVE ||
    environment.HYPERDRIVE_CACHE_DISABLED !== "true"
  )
    return jsonError(
      "service_unavailable",
      "Dashboard access is temporarily unavailable.",
      context.requestId,
      503,
      cors,
    );
  const token = readBearerToken(request);
  if (!token)
    return jsonError("unauthorized", "Authentication is required.", context.requestId, 401, cors);
  let identity: DashboardIdentity;
  try {
    identity = await verifier.verify(token, environment);
  } catch (error) {
    if (error instanceof InvalidDashboardTokenError)
      return jsonError("unauthorized", "Authentication is required.", context.requestId, 401, cors);
    logger.error(context, "dashboard_authentication_unavailable");
    return jsonError(
      "service_unavailable",
      "Dashboard access is temporarily unavailable.",
      context.requestId,
      503,
      cors,
    );
  }
  try {
    const value = await reader.read(
      environment.HYPERDRIVE.connectionString,
      identity.userId,
      identity.aal,
    );
    const access = parseDashboardAccessContext(value);
    if (!access) throw new Error("Invalid dashboard access response");
    return jsonSuccess<DashboardAccessContext>(access, context.requestId, 200, cors);
  } catch {
    logger.error(context, "dashboard_access_failed");
    return jsonError(
      "service_unavailable",
      "Dashboard access is temporarily unavailable.",
      context.requestId,
      503,
      cors,
    );
  }
}
