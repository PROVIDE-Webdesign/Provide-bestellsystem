import {
  parseGuestPickupOrderConfirmation,
  parseGuestPickupOrderRequest,
  isStorefrontScope,
  type GuestPickupOrderCommand,
} from "@provide/contracts";
import type { RequestContext } from "./context.js";
import { jsonError, jsonSuccess, readJsonBody, RequestBodyError } from "./http.js";
import type { ApiLogger } from "./logger.js";
import type { StorefrontRoute } from "./storefront.js";
import {
  createStatusAccessToken,
  hasValidStatusSecret,
  statusAvailableUntil,
} from "./status-token.js";

export interface CheckoutEnvironment {
  readonly CHECKOUT_WRITE_ENABLED?: string;
  readonly CHECKOUT_PRIVACY_NOTICE_VERSION?: string;
  readonly CHECKOUT_RETENTION_DAYS?: string;
  readonly ORDER_STATUS_READ_ENABLED?: string;
  readonly ORDER_STATUS_TOKEN_SECRET?: string;
  readonly HYPERDRIVE_CACHE_DISABLED?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
}

export interface CheckoutWriter {
  submit(
    connectionString: string,
    command: GuestPickupOrderCommand,
    retentionDays: number,
  ): Promise<unknown>;
}

export async function handleGuestPickupOrder(
  request: Request,
  route: StorefrontRoute,
  env: CheckoutEnvironment,
  writer: CheckoutWriter,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
): Promise<Response> {
  const unavailable = () =>
    jsonError(
      "service_unavailable",
      "Checkout is temporarily unavailable.",
      context.requestId,
      503,
      cors,
    );
  if (
    route.name !== "orders" ||
    !isStorefrontScope(route) ||
    request.url.length > 2048 ||
    env.CHECKOUT_WRITE_ENABLED !== "true" ||
    env.ORDER_STATUS_READ_ENABLED !== "true" ||
    !hasValidStatusSecret(env.ORDER_STATUS_TOKEN_SECRET) ||
    !env.HYPERDRIVE ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true"
  )
    return unavailable();

  const privacyNoticeVersion = env.CHECKOUT_PRIVACY_NOTICE_VERSION;
  const retention = env.CHECKOUT_RETENTION_DAYS ?? "";
  if (!privacyNoticeVersion || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(privacyNoticeVersion))
    return unavailable();
  if (!/^[1-9]\d{0,2}$/.test(retention)) return unavailable();
  const retentionDays = Number(retention);
  if (retentionDays > 730) return unavailable();

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestBodyError)
      return jsonError(error.code, error.message, context.requestId, error.status, cors);
    return jsonError("bad_request", "Request body is not valid.", context.requestId, 400, cors);
  }
  const parsed = parseGuestPickupOrderRequest(body);
  if (!parsed || parsed.privacyNoticeVersion !== privacyNoticeVersion)
    return jsonError("bad_request", "Checkout data is not valid.", context.requestId, 400, cors);

  const command: GuestPickupOrderCommand = {
    ...parsed,
    restaurantSlug: route.restaurantSlug,
    locationSlug: route.locationSlug,
  };
  try {
    const result = await writer.submit(env.HYPERDRIVE.connectionString, command, retentionDays);
    const source =
      result !== null && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : undefined;
    if (!source || typeof source.orderId !== "string" || typeof source.requestedFor !== "string")
      throw new Error("Invalid checkout confirmation");
    const availableUntil = statusAvailableUntil(source.requestedFor);
    if (!availableUntil) throw new Error("Invalid checkout status expiry");
    const statusAccessToken = await createStatusAccessToken(
      env.ORDER_STATUS_TOKEN_SECRET,
      route,
      source.orderId,
    );
    const confirmation = parseGuestPickupOrderConfirmation({
      ...source,
      statusAccessToken,
      statusAvailableUntil: availableUntil,
    });
    if (!confirmation) throw new Error("Invalid checkout confirmation");
    return jsonSuccess(confirmation, context.requestId, 201, cors);
  } catch {
    logger.error(context, "guest_pickup_order_rejected");
    return jsonError(
      "order_unavailable",
      "The order could not be submitted. Please review the cart and pickup time.",
      context.requestId,
      409,
      cors,
    );
  }
}
