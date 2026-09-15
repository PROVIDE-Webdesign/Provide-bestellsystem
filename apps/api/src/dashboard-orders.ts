import {
  parseDashboardOrderCursor,
  parseDashboardOrderDetail,
  parseDashboardOrderList,
  parseDashboardOrderStatusCommand,
  parseDashboardOrderStatusResult,
  publicOrderStatuses,
  type DashboardOrderStatus,
} from "@provide/contracts";

import type { RequestContext } from "./context.js";
import {
  dashboardAuthConfigured,
  InvalidDashboardTokenError,
  readBearerToken,
  type DashboardAuthEnvironment,
  type DashboardIdentity,
  type DashboardTokenVerifier,
} from "./dashboard-auth.js";
import { jsonError, jsonSuccess, readJsonBody, RequestBodyError } from "./http.js";
import type { ApiLogger } from "./logger.js";
import type { DashboardOrderRoute } from "./router.js";

export interface DashboardOrdersEnvironment extends DashboardAuthEnvironment {
  readonly DASHBOARD_AUTH_ENABLED?: string;
  readonly DASHBOARD_ORDER_OPERATIONS_ENABLED?: string;
  readonly HYPERDRIVE_CACHE_DISABLED?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
}

export interface DashboardOrdersReader {
  list(
    connectionString: string,
    identity: DashboardIdentity,
    scope: { restaurantId: string; locationId: string },
    filters: {
      status: DashboardOrderStatus | undefined;
      fulfillmentType?: "pickup" | "delivery";
      cursor: { requestedFor: string; orderId: string } | undefined;
      limit: number;
    },
  ): Promise<unknown>;
  detail(
    connectionString: string,
    identity: DashboardIdentity,
    scope: { restaurantId: string; locationId: string; orderId: string },
  ): Promise<unknown>;
  transition(
    connectionString: string,
    identity: DashboardIdentity,
    scope: { restaurantId: string; locationId: string; orderId: string },
    command: { expectedStatus: DashboardOrderStatus; targetStatus: DashboardOrderStatus },
  ): Promise<unknown>;
}

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorResponse(
  outcome: unknown,
  context: RequestContext,
  cors: Headers,
): Response | undefined {
  if (outcome === "forbidden")
    return jsonError("forbidden", "Access is not permitted.", context.requestId, 403, cors);
  if (outcome === "not_found")
    return jsonError("not_found", "Order was not found.", context.requestId, 404, cors);
  if (outcome === "conflict")
    return jsonError(
      "conflict",
      "Order status changed. Refresh before trying again.",
      context.requestId,
      409,
      cors,
    );
  return undefined;
}

async function authenticate(
  request: Request,
  environment: DashboardOrdersEnvironment,
  verifier: DashboardTokenVerifier,
): Promise<DashboardIdentity | "unauthorized" | "unavailable"> {
  if (
    environment.DASHBOARD_AUTH_ENABLED !== "true" ||
    environment.DASHBOARD_ORDER_OPERATIONS_ENABLED !== "true" ||
    !dashboardAuthConfigured(environment) ||
    !environment.HYPERDRIVE ||
    environment.HYPERDRIVE_CACHE_DISABLED !== "true"
  )
    return "unavailable";
  const token = readBearerToken(request);
  if (!token) return "unauthorized";
  try {
    return await verifier.verify(token, environment);
  } catch (error) {
    return error instanceof InvalidDashboardTokenError ? "unauthorized" : "unavailable";
  }
}

function parseFilters(request: Request): Parameters<DashboardOrdersReader["list"]>[3] | undefined {
  const parameters = new URL(request.url).searchParams;
  if (
    [...parameters.keys()].some(
      (key) => !["status", "cursor", "limit", "fulfillmentType"].includes(key),
    ) ||
    ["status", "cursor", "limit", "fulfillmentType"].some(
      (key) => parameters.getAll(key).length > 1,
    )
  )
    return undefined;
  const statusValue = parameters.get("status");
  const status = statusValue
    ? publicOrderStatuses.find((candidate) => candidate === statusValue)
    : undefined;
  if (statusValue && !status) return undefined;
  const cursorValue = parameters.get("cursor");
  const cursor = cursorValue ? parseDashboardOrderCursor(cursorValue) : undefined;
  if (cursorValue && !cursor) return undefined;
  const limitValue = parameters.get("limit");
  const limit =
    limitValue === null ? 25 : /^[1-9][0-9]?$/.test(limitValue) ? Number(limitValue) : 0;
  if (limit < 1 || limit > 50) return undefined;
  const fulfillmentType = parameters.get("fulfillmentType");
  if (fulfillmentType !== null && fulfillmentType !== "pickup" && fulfillmentType !== "delivery")
    return undefined;
  return {
    status,
    cursor,
    limit,
    ...(fulfillmentType ? { fulfillmentType } : {}),
  };
}

export async function handleDashboardOrders(
  request: Request,
  route: DashboardOrderRoute,
  environment: DashboardOrdersEnvironment,
  verifier: DashboardTokenVerifier,
  reader: DashboardOrdersReader,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
): Promise<Response> {
  const identity = await authenticate(request, environment, verifier);
  if (identity === "unauthorized")
    return jsonError("unauthorized", "Authentication is required.", context.requestId, 401, cors);
  if (identity === "unavailable") {
    logger.error(context, "dashboard_order_authentication_unavailable");
    return jsonError(
      "service_unavailable",
      "Dashboard orders are temporarily unavailable.",
      context.requestId,
      503,
      cors,
    );
  }
  if (
    !uuidPattern.test(route.restaurantId) ||
    !uuidPattern.test(route.locationId) ||
    (route.orderId !== undefined && !uuidPattern.test(route.orderId))
  )
    return jsonError("bad_request", "Dashboard scope is invalid.", context.requestId, 400, cors);

  const connectionString = environment.HYPERDRIVE!.connectionString;
  try {
    if (route.name === "dashboardOrders") {
      const filters = parseFilters(request);
      if (!filters)
        return jsonError("bad_request", "Order filters are invalid.", context.requestId, 400, cors);
      const result = record(
        await reader.list(
          connectionString,
          identity,
          {
            restaurantId: route.restaurantId,
            locationId: route.locationId,
          },
          filters,
        ),
      );
      const mappedError = errorResponse(result?.outcome, context, cors);
      if (mappedError) return mappedError;
      const data = result?.outcome === "allowed" ? parseDashboardOrderList(result.data) : undefined;
      if (!data) throw new Error("Invalid dashboard order list");
      return jsonSuccess(data, context.requestId, 200, cors);
    }

    const scope = {
      restaurantId: route.restaurantId,
      locationId: route.locationId,
      orderId: route.orderId,
    };
    if (route.name === "dashboardOrder") {
      const result = record(await reader.detail(connectionString, identity, scope));
      const mappedError = errorResponse(result?.outcome, context, cors);
      if (mappedError) return mappedError;
      const data =
        result?.outcome === "allowed" ? parseDashboardOrderDetail(result.data) : undefined;
      if (!data) throw new Error("Invalid dashboard order detail");
      return jsonSuccess(data, context.requestId, 200, cors);
    }

    let body: unknown;
    try {
      body = await readJsonBody(request, 1024);
    } catch (error) {
      if (error instanceof RequestBodyError)
        return jsonError(error.code, error.message, context.requestId, error.status, cors);
      throw error;
    }
    const command = parseDashboardOrderStatusCommand(body);
    if (!command)
      return jsonError("bad_request", "Status command is invalid.", context.requestId, 400, cors);
    const result = record(await reader.transition(connectionString, identity, scope, command));
    const mappedError = errorResponse(result?.outcome, context, cors);
    if (mappedError) return mappedError;
    const data =
      result?.outcome === "updated" ? parseDashboardOrderStatusResult(result.data) : undefined;
    if (!data) throw new Error("Invalid dashboard status result");
    return jsonSuccess(data, context.requestId, 200, cors);
  } catch {
    logger.error(context, "dashboard_order_operation_failed");
    return jsonError(
      "service_unavailable",
      "Dashboard orders are temporarily unavailable.",
      context.requestId,
      503,
      cors,
    );
  }
}
