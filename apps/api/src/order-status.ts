import {
  isStorefrontScope,
  parsePublicOrderStatus,
  parsePublicOrderStatusRequest,
  type StorefrontScope,
} from "@provide/contracts";
import type { RequestContext } from "./context.js";
import { jsonError, jsonSuccess, readJsonBody, RequestBodyError } from "./http.js";
import type { ApiLogger } from "./logger.js";
import type { StorefrontRoute } from "./storefront.js";
import { hasValidStatusSecret, verifyStatusAccessToken } from "./status-token.js";

export interface OrderStatusEnvironment {
  readonly ORDER_STATUS_READ_ENABLED?: string;
  readonly ORDER_STATUS_TOKEN_SECRET?: string;
  readonly ORDER_STATUS_TOKEN_SECRET_PREVIOUS?: string;
  readonly HYPERDRIVE_CACHE_DISABLED?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
}

export interface OrderStatusReader {
  read(connectionString: string, scope: StorefrontScope, orderId: string): Promise<unknown>;
}

export async function handlePublicOrderStatus(
  request: Request,
  route: StorefrontRoute,
  env: OrderStatusEnvironment,
  reader: OrderStatusReader,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
): Promise<Response> {
  const unavailable = () =>
    jsonError(
      "service_unavailable",
      "Order status is temporarily unavailable.",
      context.requestId,
      503,
      cors,
    );
  if (
    route.name !== "orderStatus" ||
    !isStorefrontScope(route) ||
    request.url.length > 2048 ||
    env.ORDER_STATUS_READ_ENABLED !== "true" ||
    !hasValidStatusSecret(env.ORDER_STATUS_TOKEN_SECRET) ||
    !env.HYPERDRIVE ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true"
  )
    return unavailable();

  let body: unknown;
  try {
    body = await readJsonBody(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyError)
      return jsonError(error.code, error.message, context.requestId, error.status, cors);
    return jsonError("bad_request", "Request body is not valid.", context.requestId, 400, cors);
  }
  const parsed = parsePublicOrderStatusRequest(body);
  if (!parsed)
    return jsonError("bad_request", "Status request is not valid.", context.requestId, 400, cors);

  const scope = {
    restaurantSlug: route.restaurantSlug,
    locationSlug: route.locationSlug,
  };
  let verified: boolean;
  try {
    verified = await verifyStatusAccessToken(
      parsed.statusAccessToken,
      [env.ORDER_STATUS_TOKEN_SECRET, env.ORDER_STATUS_TOKEN_SECRET_PREVIOUS],
      scope,
      parsed.orderId,
    );
  } catch {
    logger.error(context, "public_order_status_verification_failed");
    return unavailable();
  }
  if (!verified)
    return jsonError("not_found", "Resource was not found.", context.requestId, 404, cors);

  try {
    const result = await reader.read(env.HYPERDRIVE.connectionString, scope, parsed.orderId);
    if (result === null)
      return jsonError("not_found", "Resource was not found.", context.requestId, 404, cors);
    const data = parsePublicOrderStatus(result);
    if (!data) throw new Error("Invalid public status result");
    return jsonSuccess(data, context.requestId, 200, cors);
  } catch {
    logger.error(context, "public_order_status_read_failed");
    return unavailable();
  }
}
