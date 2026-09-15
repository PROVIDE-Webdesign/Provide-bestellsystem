import {
  parseDashboardAccessContext,
  parseDashboardOrderCursor,
  parseDashboardOrderDetail,
  parseDashboardOrderList,
  parseDashboardOrderStatusCommand,
  parseDashboardOrderStatusResult,
  publicOrderStatuses,
  type DashboardOrderStatus,
} from "@provide/contracts";

function safeApiBase(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    )
      return undefined;
    return url;
  } catch {
    return undefined;
  }
}

const headers = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function failure(status: 401 | 503) {
  return Response.json(
    { error: { code: status === 401 ? "unauthorized" : "service_unavailable" } },
    { headers, status },
  );
}

export async function fetchDashboardAccess(
  accessToken: string,
  apiBaseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const base = safeApiBase(apiBaseUrl);
  if (!base || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken))
    return failure(503);
  try {
    const response = await fetcher(new URL("/v1/dashboard/access-context", base), {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401) return failure(401);
    if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json"))
      return failure(503);
    const reader = response.body?.getReader();
    if (!reader) return failure(503);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 64 * 1024) {
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
    const envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as {
      data?: unknown;
    };
    const data = parseDashboardAccessContext(envelope.data);
    return data ? Response.json({ data }, { headers }) : failure(503);
  } catch {
    return failure(503);
  }
}

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type OperationalFailureStatus = 400 | 401 | 403 | 404 | 409 | 503;

function operationalFailure(status: OperationalFailureStatus) {
  const codes = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    503: "service_unavailable",
  } as const;
  return Response.json({ error: { code: codes[status] } }, { headers, status });
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.startsWith("application/json")) throw new Error();
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 128 * 1024) {
        await reader.cancel();
        throw new Error();
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
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function operationalRequest(
  accessToken: string,
  apiBaseUrl: string | undefined,
  path: string,
  method: "GET" | "POST",
  body: unknown,
  parse: (value: unknown) => unknown,
  fetcher: typeof fetch,
): Promise<Response> {
  const base = safeApiBase(apiBaseUrl);
  if (!base || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken))
    return operationalFailure(503);
  try {
    const response = await fetcher(new URL(path, base), {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if ([400, 401, 403, 404, 409].includes(response.status))
      return operationalFailure(response.status as Exclude<OperationalFailureStatus, 503>);
    if (!response.ok) return operationalFailure(503);
    const envelope = (await boundedJson(response)) as { data?: unknown };
    const data = parse(envelope.data);
    return data ? Response.json({ data }, { headers }) : operationalFailure(503);
  } catch {
    return operationalFailure(503);
  }
}

export function fetchDashboardOrders(
  accessToken: string,
  apiBaseUrl: string | undefined,
  scope: { restaurantId: string; locationId: string },
  filters: {
    status?: DashboardOrderStatus | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  },
  fetcher: typeof fetch = fetch,
) {
  if (
    !uuidPattern.test(scope.restaurantId) ||
    !uuidPattern.test(scope.locationId) ||
    (filters.status !== undefined && !publicOrderStatuses.includes(filters.status)) ||
    (filters.cursor !== undefined && !parseDashboardOrderCursor(filters.cursor)) ||
    (filters.limit !== undefined &&
      (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 50))
  )
    return Promise.resolve(operationalFailure(400));
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.cursor) query.set("cursor", filters.cursor);
  query.set("limit", String(filters.limit ?? 25));
  return operationalRequest(
    accessToken,
    apiBaseUrl,
    `/v1/dashboard/restaurants/${scope.restaurantId}/locations/${scope.locationId}/orders?${query}`,
    "GET",
    undefined,
    parseDashboardOrderList,
    fetcher,
  );
}

export function fetchDashboardOrderDetail(
  accessToken: string,
  apiBaseUrl: string | undefined,
  scope: { restaurantId: string; locationId: string; orderId: string },
  fetcher: typeof fetch = fetch,
) {
  if (
    ![scope.restaurantId, scope.locationId, scope.orderId].every((value) => uuidPattern.test(value))
  )
    return Promise.resolve(operationalFailure(400));
  return operationalRequest(
    accessToken,
    apiBaseUrl,
    `/v1/dashboard/restaurants/${scope.restaurantId}/locations/${scope.locationId}/orders/${scope.orderId}`,
    "GET",
    undefined,
    parseDashboardOrderDetail,
    fetcher,
  );
}

export function transitionDashboardOrder(
  accessToken: string,
  apiBaseUrl: string | undefined,
  scope: { restaurantId: string; locationId: string; orderId: string },
  command: unknown,
  fetcher: typeof fetch = fetch,
) {
  const parsed = parseDashboardOrderStatusCommand(command);
  if (
    !parsed ||
    ![scope.restaurantId, scope.locationId, scope.orderId].every((value) => uuidPattern.test(value))
  )
    return Promise.resolve(operationalFailure(400));
  return operationalRequest(
    accessToken,
    apiBaseUrl,
    `/v1/dashboard/restaurants/${scope.restaurantId}/locations/${scope.locationId}/orders/${scope.orderId}/status`,
    "POST",
    parsed,
    parseDashboardOrderStatusResult,
    fetcher,
  );
}
