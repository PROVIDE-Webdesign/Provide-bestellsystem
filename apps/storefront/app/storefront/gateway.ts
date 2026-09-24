import {
  parseOnlineOrderRequest,
  parseOnlineOrderConfirmation,
  parsePaymentAction,
  parsePaymentSession,
  parseDeliveryQuote,
  parseDeliveryQuoteRequest,
  parseGuestDeliveryOrderRequest,
  parseGuestDeliveryOrderConfirmation,
} from "@provide/contracts";
import {
  isStorefrontScope,
  parseGuestPickupOrderConfirmation,
  parseGuestPickupOrderRequest,
  parsePublicOrderStatus,
  parsePublicOrderStatusRequest,
  parsePublicAvailability,
  parsePublicCatalog,
} from "@provide/contracts";

export interface GatewayParams {
  restaurantSlug: string;
  locationSlug: string;
  resource: string;
}

function reportGatewayFailure(resource: string, stage: string, error?: unknown): void {
  console.warn("storefront_gateway_failure", {
    resource,
    stage,
    errorName: error instanceof Error ? error.name : "none",
  });
}

function safeApiBase(apiUrl: string | undefined): URL | undefined {
  if (!apiUrl) return undefined;
  try {
    const base = new URL(apiUrl);
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/" ||
      (base.protocol !== "https:" &&
        !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))
    )
      return undefined;
    return base;
  } catch {
    return undefined;
  }
}
/** Fixed configured upstream, public GET only; never forwards cookies, tokens or client headers. */
export async function fetchPublicStorefront(
  request: Request,
  params: GatewayParams,
  apiUrl: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  const failure = (status: number) =>
    Response.json(
      {
        error: {
          code:
            status === 404 ? "not_found" : status === 400 ? "bad_request" : "service_unavailable",
        },
      },
      { status, headers },
    );
  if (
    !isStorefrontScope(params) ||
    !["catalog", "availability"].includes(params.resource) ||
    request.url.length > 2048
  )
    return failure(400);
  if (!apiUrl) return failure(503);
  let stage = "configuration";
  try {
    const base = safeApiBase(apiUrl);
    if (!base) return failure(503);
    const upstream = new URL(
      `/v1/storefront/${params.restaurantSlug}/${params.locationSlug}/${params.resource}`,
      base,
    );
    upstream.search = new URL(request.url).search;
    stage = "upstream-fetch";
    const response = await fetcher(upstream, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    stage = "upstream-status";
    if (!response.ok) {
      reportGatewayFailure(params.resource, stage);
      return failure(response.status === 404 || response.status === 400 ? response.status : 503);
    }
    stage = "content-type";
    if (!response.headers.get("content-type")?.startsWith("application/json")) {
      reportGatewayFailure(params.resource, stage);
      return failure(503);
    }
    stage = "response-body";
    const reader = response.body?.getReader();
    if (!reader) {
      reportGatewayFailure(params.resource, stage);
      return failure(503);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 1024 * 1024 + 1024) {
          await reader.cancel();
          return failure(503);
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as {
      data?: unknown;
    };
    stage = "contract-validation";
    const data =
      params.resource === "catalog"
        ? parsePublicCatalog(body.data)
        : parsePublicAvailability(body.data);
    return Response.json({ data }, { headers });
  } catch (error) {
    reportGatewayFailure(params.resource, stage, error);
    return failure(503);
  }
}

export async function submitGuestPickupOrder(
  request: Request,
  params: GatewayParams,
  apiUrl: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  const failure = (status: number) =>
    Response.json(
      {
        error: {
          code:
            status === 400
              ? "bad_request"
              : status === 409
                ? "order_unavailable"
                : status === 413
                  ? "payload_too_large"
                  : status === 415
                    ? "unsupported_media_type"
                    : "service_unavailable",
        },
      },
      { status, headers },
    );
  if (
    !isStorefrontScope(params) ||
    !["orders", "delivery-quote", "delivery-orders", "online-orders", "payment-session"].includes(
      params.resource,
    ) ||
    request.url.length > 2048
  )
    return failure(400);
  const base = safeApiBase(apiUrl);
  if (!base) return failure(503);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return failure(415);
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 64 * 1024) return failure(413);
    const source = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    const body =
      params.resource === "online-orders"
        ? parseOnlineOrderRequest(source)
        : params.resource === "payment-session"
          ? parsePaymentAction(source)
          : params.resource === "delivery-quote"
            ? parseDeliveryQuoteRequest(source)
            : params.resource === "delivery-orders"
              ? parseGuestDeliveryOrderRequest(source)
              : parseGuestPickupOrderRequest(source);
    if (!body) return failure(400);
    const upstream = new URL(
      `/v1/storefront/${params.restaurantSlug}/${params.locationSlug}/${params.resource}`,
      base,
    );
    const response = await fetcher(upstream, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      return failure([400, 409, 413, 415].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.startsWith("application/json")) return failure(503);
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 16 * 1024) return failure(503);
    const payload = JSON.parse(text) as { data?: unknown };
    const confirmation =
      params.resource === "online-orders"
        ? parseOnlineOrderConfirmation(payload.data)
        : params.resource === "payment-session"
          ? parsePaymentSession(payload.data)
          : params.resource === "delivery-quote"
            ? parseDeliveryQuote(payload.data)
            : params.resource === "delivery-orders"
              ? parseGuestDeliveryOrderConfirmation(payload.data)
              : parseGuestPickupOrderConfirmation(payload.data);
    if (!confirmation) return failure(503);
    return Response.json(
      { data: confirmation },
      {
        status: ["delivery-quote", "payment-session"].includes(params.resource) ? 200 : 201,
        headers,
      },
    );
  } catch {
    return failure(503);
  }
}

export async function fetchPublicOrderStatus(
  request: Request,
  params: GatewayParams,
  apiUrl: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  const failure = (status: number) =>
    Response.json(
      {
        error: {
          code:
            status === 400
              ? "bad_request"
              : status === 404
                ? "not_found"
                : status === 413
                  ? "payload_too_large"
                  : status === 415
                    ? "unsupported_media_type"
                    : "service_unavailable",
        },
      },
      { status, headers },
    );
  if (!isStorefrontScope(params) || params.resource !== "order-status" || request.url.length > 2048)
    return failure(400);
  const base = safeApiBase(apiUrl);
  if (!base) return failure(503);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return failure(415);
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 4 * 1024) return failure(413);
    const source = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    const body = parsePublicOrderStatusRequest(source);
    if (!body) return failure(400);
    const upstream = new URL(
      `/v1/storefront/${params.restaurantSlug}/${params.locationSlug}/order-status`,
      base,
    );
    const response = await fetcher(upstream, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      return failure([400, 404, 413, 415].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.startsWith("application/json")) return failure(503);
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 16 * 1024) return failure(503);
    const payload = JSON.parse(text) as { data?: unknown };
    const status = parsePublicOrderStatus(payload.data);
    if (!status || status.orderId !== body.orderId) return failure(503);
    return Response.json({ data: status }, { headers });
  } catch {
    return failure(503);
  }
}
