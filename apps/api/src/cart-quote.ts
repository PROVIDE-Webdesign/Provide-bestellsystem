import { Client } from "pg";
import {
  isStorefrontScope,
  parseCartQuoteRequest,
  parseCartQuote,
  selectionLinesForDatabase,
  type CartQuoteRequest,
  type StorefrontScope,
} from "@provide/contracts";
import { jsonError, jsonSuccess, readJsonBody, RequestBodyError } from "./http.js";
import type { RequestContext } from "./context.js";
import type { ApiLogger } from "./logger.js";

export type CartQuoteReader = (
  connection: string,
  scope: StorefrontScope,
  command: CartQuoteRequest,
) => Promise<unknown>;
export const postgresCartQuoteReader: CartQuoteReader = async (connectionString, scope, v) => {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 9000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout='8s'");
    const result = await client.query<{ data: unknown }>(
      "select private.quote_public_cart($1,$2,$3,$4,$5,$6,$7,$8) as data",
      [
        scope.restaurantSlug,
        scope.locationSlug,
        v.menuId,
        v.menuVersionId,
        v.fulfillmentType,
        v.requestedFor,
        JSON.stringify(selectionLinesForDatabase(v.lines)),
        v.postalCode ?? null,
      ],
    );
    if (result.rows.length !== 1) throw new Error("Invalid cart quote result");
    await client.query("COMMIT");
    return result.rows[0]!.data;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
};
export interface CartQuoteEnvironment {
  readonly CART_QUOTE_ENABLED?: string;
  readonly HYPERDRIVE_CACHE_DISABLED?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
}
export async function handleCartQuote(
  request: Request,
  scope: StorefrontScope,
  env: CartQuoteEnvironment,
  reader: CartQuoteReader,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
): Promise<Response> {
  const unavailable = () =>
    jsonError(
      "service_unavailable",
      "Cart review is temporarily unavailable.",
      context.requestId,
      503,
      cors,
    );
  if (
    !isStorefrontScope(scope) ||
    request.url.length > 2048 ||
    new URL(request.url).searchParams.size
  )
    return jsonError(
      "bad_request",
      "Request parameters are not valid.",
      context.requestId,
      400,
      cors,
    );
  if (
    env.CART_QUOTE_ENABLED !== "true" ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true" ||
    !env.HYPERDRIVE
  )
    return unavailable();
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (e) {
    if (e instanceof RequestBodyError)
      return jsonError(e.code, e.message, context.requestId, e.status, cors);
    return jsonError("bad_request", "Request body is not valid.", context.requestId, 400, cors);
  }
  const command = parseCartQuoteRequest(body);
  if (!command)
    return jsonError("bad_request", "Cart data is not valid.", context.requestId, 400, cors);
  try {
    const result = await reader(env.HYPERDRIVE.connectionString, scope, command);
    if (result === null)
      return jsonError("not_found", "Resource was not found.", context.requestId, 404, cors);
    const data = parseCartQuote(result);
    if (
      !data ||
      new TextEncoder().encode(JSON.stringify(data)).byteLength > 1024 * 1024 ||
      (data.status !== "unavailable" &&
        (command.fulfillmentType === "delivery") !== (data.deliveryQuote !== null))
    )
      throw new Error("Invalid cart quote response");
    return jsonSuccess(data, context.requestId, 200, cors);
  } catch {
    logger.error(context, "cart_quote_failed");
    return unavailable();
  }
}
