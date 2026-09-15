import { isStorefrontScope, parsePublicAvailability, parsePublicCatalog } from "@provide/contracts";

export interface GatewayParams {
  restaurantSlug: string;
  locationSlug: string;
  resource: string;
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
      return failure(503);
    const upstream = new URL(
      `/v1/storefront/${params.restaurantSlug}/${params.locationSlug}/${params.resource}`,
      base,
    );
    upstream.search = new URL(request.url).search;
    const response = await fetcher(upstream, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      return failure(response.status === 404 || response.status === 400 ? response.status : 503);
    if (!response.headers.get("content-type")?.startsWith("application/json")) return failure(503);
    const reader = response.body?.getReader();
    if (!reader) return failure(503);
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
    const data =
      params.resource === "catalog"
        ? parsePublicCatalog(body.data)
        : parsePublicAvailability(body.data);
    return Response.json({ data }, { headers });
  } catch {
    return failure(503);
  }
}
