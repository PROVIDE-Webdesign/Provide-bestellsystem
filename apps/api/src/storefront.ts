import {
  isAvailabilityQuery,
  isStorefrontScope,
  parsePublicAvailability,
  parsePublicCatalog,
  type AvailabilityQuery,
  type StorefrontScope,
} from "@provide/contracts";

import { jsonError, jsonSuccess } from "./http.js";
import type { ApiLogger } from "./logger.js";
import type { RequestContext } from "./context.js";

export interface StorefrontReader {
  catalog(connectionString: string, scope: StorefrontScope): Promise<unknown>;
  availability(connectionString: string, query: AvailabilityQuery): Promise<unknown>;
}
export interface StorefrontEnvironment {
  readonly HYPERDRIVE?: { readonly connectionString: string };
  /** Set only after verifying caching.disabled on the actual Hyperdrive configuration. */
  readonly HYPERDRIVE_CACHE_DISABLED?: string;
}
export interface StorefrontRoute extends StorefrontScope {
  readonly name:
    "catalog" | "availability" | "orders" | "orderStatus" | "delivery-quote" | "delivery-orders";
}

export async function handleStorefront(
  request: Request,
  route: StorefrontRoute,
  env: StorefrontEnvironment,
  reader: StorefrontReader,
  context: RequestContext,
  logger: ApiLogger,
  cors: Headers,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const badRequest = () =>
    jsonError("bad_request", "Request parameters are not valid.", context.requestId, 400, cors);
  if (!isStorefrontScope(route) || request.url.length > 2048) return badRequest();
  let query: AvailabilityQuery | undefined;
  if (route.name === "catalog") {
    if (params.size !== 0) return badRequest();
  } else {
    if (
      params.size !== 3 ||
      [...params.keys()].some(
        (key) => !["fulfillmentType", "requestedFor", "itemCount"].includes(key),
      )
    )
      return badRequest();
    const fulfillmentType = params.get("fulfillmentType");
    const count = params.get("itemCount") ?? "";
    if (
      (fulfillmentType !== "pickup" && fulfillmentType !== "delivery") ||
      !/^[1-9]\d{0,3}$/.test(count)
    )
      return badRequest();
    query = {
      ...route,
      fulfillmentType,
      requestedFor: params.get("requestedFor") ?? "",
      itemCount: Number(count),
    };
    if (!isAvailabilityQuery(query)) return badRequest();
  }
  if (!env.HYPERDRIVE || env.HYPERDRIVE_CACHE_DISABLED !== "true")
    return jsonError(
      "service_unavailable",
      "Service is temporarily unavailable.",
      context.requestId,
      503,
      cors,
    );

  try {
    const result = query
      ? await reader.availability(env.HYPERDRIVE.connectionString, query)
      : await reader.catalog(env.HYPERDRIVE.connectionString, route);
    if (result === null)
      return jsonError("not_found", "Resource was not found.", context.requestId, 404, cors);
    const data = query ? parsePublicAvailability(result) : parsePublicCatalog(result);
    // Bound the public payload; never truncate a menu into an apparently complete result.
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 1024 * 1024)
      throw new Error("Public response limit");
    return jsonSuccess(data, context.requestId, 200, cors);
  } catch {
    logger.error(context, "storefront_read_failed");
    return jsonError(
      "service_unavailable",
      "Service is temporarily unavailable.",
      context.requestId,
      503,
      cors,
    );
  }
}
