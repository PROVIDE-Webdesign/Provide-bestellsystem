import {
  isStorefrontScope,
  parseDeliveryQuote,
  parseDeliveryQuoteRequest,
  parseGuestDeliveryOrderRequest,
  parseGuestDeliveryOrderConfirmation,
  type DeliveryQuoteRequest,
  type GuestDeliveryOrderRequest,
  type StorefrontScope,
} from "@provide/contracts";
import type { CheckoutEnvironment } from "./checkout.js";
import type { RequestContext } from "./context.js";
import type { ApiLogger } from "./logger.js";
import { jsonError, jsonSuccess, readJsonBody, RequestBodyError } from "./http.js";
import {
  createStatusAccessToken,
  hasValidStatusSecret,
  statusAvailableUntil,
} from "./status-token.js";

export interface DeliveryRepository {
  quote(
    this: void,
    connectionString: string,
    scope: StorefrontScope,
    command: DeliveryQuoteRequest,
  ): Promise<unknown>;
  submit(
    this: void,
    connectionString: string,
    scope: StorefrontScope,
    command: GuestDeliveryOrderRequest,
    retentionDays: number,
  ): Promise<unknown>;
}
export async function handleDelivery(
  request: Request,
  scope: StorefrontScope,
  quoteOnly: boolean,
  env: CheckoutEnvironment & { DELIVERY_ORDERING_ENABLED?: string },
  repository: DeliveryRepository,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
): Promise<Response> {
  const failure = (status: number, code: Parameters<typeof jsonError>[0]) =>
    jsonError(code, "Delivery request could not be processed.", context.requestId, status, cors);
  if (!isStorefrontScope(scope) || request.url.length > 2048 || new URL(request.url).search)
    return failure(400, "bad_request");
  if (
    env.DELIVERY_ORDERING_ENABLED !== "true" ||
    !env.HYPERDRIVE ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true"
  )
    return failure(503, "service_unavailable");
  if (
    !quoteOnly &&
    (env.CHECKOUT_WRITE_ENABLED !== "true" ||
      env.ORDER_STATUS_READ_ENABLED !== "true" ||
      !hasValidStatusSecret(env.ORDER_STATUS_TOKEN_SECRET) ||
      !env.CHECKOUT_PRIVACY_NOTICE_VERSION ||
      !/^[1-9][0-9]{0,2}$/.test(env.CHECKOUT_RETENTION_DAYS ?? "") ||
      Number(env.CHECKOUT_RETENTION_DAYS) > 730)
  )
    return failure(503, "service_unavailable");
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return error instanceof RequestBodyError
      ? failure(error.status, error.code)
      : failure(400, "bad_request");
  }
  try {
    if (quoteOnly) {
      const command = parseDeliveryQuoteRequest(body);
      if (!command) return failure(400, "bad_request");
      const quote = parseDeliveryQuote(
        await repository.quote(env.HYPERDRIVE.connectionString, scope, command),
      );
      if (!quote) return failure(503, "service_unavailable");
      return jsonSuccess(quote, context.requestId, 200, cors);
    }
    const command = parseGuestDeliveryOrderRequest(body);
    if (!command || command.privacyNoticeVersion !== env.CHECKOUT_PRIVACY_NOTICE_VERSION)
      return failure(400, "bad_request");
    const raw = await repository.submit(
      env.HYPERDRIVE.connectionString,
      scope,
      command,
      Number(env.CHECKOUT_RETENTION_DAYS),
    );
    if (!raw || typeof raw !== "object" || !("orderId" in raw) || typeof raw.orderId !== "string")
      return failure(503, "service_unavailable");
    const token = await createStatusAccessToken(env.ORDER_STATUS_TOKEN_SECRET!, scope, raw.orderId);
    const confirmation = parseGuestDeliveryOrderConfirmation({
      ...raw,
      statusAccessToken: token,
      statusAvailableUntil: statusAvailableUntil(command.requestedFor),
    });
    if (!confirmation) return failure(503, "service_unavailable");
    return jsonSuccess(confirmation, context.requestId, 201, cors);
  } catch (error) {
    logger.error(context, "delivery_request_unavailable");
    const rejected =
      error !== null && typeof error === "object" && "code" in error && error.code === "P0001";
    return rejected ? failure(409, "order_unavailable") : failure(503, "service_unavailable");
  }
}
