import {
  parseLocationOperationsCommand,
  parseLocationOperationsState,
  type LocationOperationsCommand,
} from "@provide/contracts";
import {
  parseDashboardAcceptance,
  parseMenuAdminCommand,
  parseMenuAdminState,
  type MenuAdminCommand,
} from "@provide/contracts";
import {
  isOrderNumber,
  parseDashboardAccessContext,
  parseDashboardOrderCursor,
  parseDashboardOrderDetail,
  parseDashboardOrderList,
  parseDashboardOrderStatusCommand,
  parseDashboardOrderStatusResult,
  publicOrderStatuses,
  type DashboardOrderStatus,
  parseOrderCommunicationCommand,
  parseOrderCommunication,
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
      redirect: "manual",
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
    const envelope = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    ) as {
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

async function boundedJson(
  response: Pick<Response, "headers" | "body">,
  maximum = 128 * 1024,
): Promise<unknown> {
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
      if (size > maximum) {
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
  return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
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
      redirect: "manual",
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

export function fetchOrderHistory(
  accessToken: string,
  apiBaseUrl: string | undefined,
  scope: { restaurantId: string; locationId: string },
  query: HistoryQuery,
  fetcher: typeof fetch = fetch,
) {
  const parsed = parseHistoryQuery(query);
  if (!parsed || !uuidPattern.test(scope.restaurantId) || !uuidPattern.test(scope.locationId))
    return Promise.resolve(operationalFailure(400));
  return operationalRequest(
    accessToken,
    apiBaseUrl,
    `/v1/dashboard/restaurants/${scope.restaurantId}/locations/${scope.locationId}/history`,
    "POST",
    parsed,
    (value) => {
      const data = parseOrderHistory(value);
      return data?.restaurantId === scope.restaurantId &&
        data.locationId === scope.locationId &&
        (parsed.orderId === undefined || data.detail?.order.orderId === parsed.orderId)
        ? data
        : undefined;
    },
    fetcher,
  );
}

export async function readHistoryBody(request: Request) {
  const parsed = parseHistoryQuery(await boundedJson(request, 2048));
  if (!parsed) throw Error("Invalid history query");
  return parsed;
}

export function fetchDashboardOrders(
  accessToken: string,
  apiBaseUrl: string | undefined,
  scope: { restaurantId: string; locationId: string },
  filters: {
    orderNumber?: string | undefined;
    status?: DashboardOrderStatus | undefined;
    fulfillmentType?: string | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  },
  fetcher: typeof fetch = fetch,
) {
  if (
    !uuidPattern.test(scope.restaurantId) ||
    !uuidPattern.test(scope.locationId) ||
    (filters.orderNumber !== undefined && !isOrderNumber(filters.orderNumber)) ||
    (filters.fulfillmentType !== undefined &&
      !["pickup", "delivery"].includes(filters.fulfillmentType)) ||
    (filters.status !== undefined && !publicOrderStatuses.includes(filters.status)) ||
    (filters.cursor !== undefined && !parseDashboardOrderCursor(filters.cursor)) ||
    (filters.limit !== undefined &&
      (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 50))
  )
    return Promise.resolve(operationalFailure(400));
  const query = new URLSearchParams();
  if (filters.orderNumber) query.set("orderNumber", filters.orderNumber);
  if (filters.fulfillmentType) query.set("fulfillmentType", filters.fulfillmentType);
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

export function fetchDashboardAcceptance(
  accessToken: string,
  apiBaseUrl: string | undefined,
  scope: { restaurantId: string; locationId: string },
  fetcher: typeof fetch = fetch,
) {
  if (!uuidPattern.test(scope.restaurantId) || !uuidPattern.test(scope.locationId))
    return Promise.resolve(operationalFailure(400));
  return operationalRequest(
    accessToken,
    apiBaseUrl,
    `/v1/dashboard/restaurants/${scope.restaurantId}/locations/${scope.locationId}/order-alerts`,
    "GET",
    undefined,
    parseDashboardAcceptance,
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

export function retryDashboardRefund(
  accessToken: string,
  apiBaseUrl: string | undefined,
  scope: { restaurantId: string; locationId: string; orderId: string },
  fetcher: typeof fetch = fetch,
) {
  if (![scope.restaurantId, scope.locationId, scope.orderId].every((v) => uuidPattern.test(v)))
    return Promise.resolve(operationalFailure(400));
  return operationalRequest(
    accessToken,
    apiBaseUrl,
    `/v1/dashboard/restaurants/${scope.restaurantId}/locations/${scope.locationId}/orders/${scope.orderId}/refund-retry`,
    "POST",
    {},
    (v: unknown) =>
      v !== null && typeof v === "object" && "retryRequested" in v && v.retryRequested === true
        ? { retryRequested: true }
        : undefined,
    fetcher,
  );
}

export function updateDashboardCommunication(
  accessToken: string,
  apiBaseUrl: string | undefined,
  scope: { restaurantId: string; locationId: string; orderId: string },
  command: unknown,
  fetcher: typeof fetch = fetch,
) {
  const parsed = parseOrderCommunicationCommand(command);
  if (
    !parsed ||
    ![scope.restaurantId, scope.locationId, scope.orderId].every((v) => uuidPattern.test(v))
  )
    return Promise.resolve(operationalFailure(400));
  return operationalRequest(
    accessToken,
    apiBaseUrl,
    `/v1/dashboard/restaurants/${scope.restaurantId}/locations/${scope.locationId}/orders/${scope.orderId}/communication`,
    "POST",
    parsed,
    parseOrderCommunication,
    fetcher,
  );
}

export async function readDashboardMenuBody(request: Request): Promise<MenuAdminCommand> {
  const body = await boundedJson(
    new Response(request.body, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }),
    512 * 1024,
  );
  const command = parseMenuAdminCommand(body);
  if (!command) throw Error("Invalid menu command");
  return command;
}
export async function fetchDashboardMenu(
  accessToken: string,
  apiBaseUrl: string | undefined,
  scope: { restaurantId: string; locationId: string },
  command: MenuAdminCommand | null,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const base = safeApiBase(apiBaseUrl);
  if (
    !base ||
    !uuidPattern.test(scope.restaurantId) ||
    !uuidPattern.test(scope.locationId) ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)
  )
    return operationalFailure(400);
  try {
    const r = await fetcher(
      new URL(
        `/v1/dashboard/restaurants/${scope.restaurantId}/locations/${scope.locationId}/menu`,
        base,
      ),
      {
        method: command ? "POST" : "GET",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        ...(command ? { body: JSON.stringify(command) } : {}),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!r.ok)
      return operationalFailure(
        [400, 401, 403, 404, 409].includes(r.status) ? (r.status as OperationalFailureStatus) : 503,
      );
    const envelope = (await boundedJson(r, 1024 * 1024)) as { data?: unknown };
    const data = parseMenuAdminState(envelope.data);
    return data ? Response.json({ data }, { headers }) : operationalFailure(503);
  } catch {
    return operationalFailure(503);
  }
}

export async function readDashboardLocationOperationsBody(
  request: Request,
): Promise<LocationOperationsCommand> {
  const body = await boundedJson(
    new Response(request.body, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }),
    512 * 1024,
  );
  const command = parseLocationOperationsCommand(body);
  if (!command) throw Error("Invalid menu command");
  return command;
}
export async function fetchDashboardLocationOperations(
  accessToken: string,
  apiBaseUrl: string | undefined,
  scope: { restaurantId: string; locationId: string },
  command: LocationOperationsCommand | null,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const base = safeApiBase(apiBaseUrl);
  if (
    !base ||
    !uuidPattern.test(scope.restaurantId) ||
    !uuidPattern.test(scope.locationId) ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)
  )
    return operationalFailure(400);
  try {
    const r = await fetcher(
      new URL(
        `/v1/dashboard/restaurants/${scope.restaurantId}/locations/${scope.locationId}/operations`,
        base,
      ),
      {
        method: command ? "POST" : "GET",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        ...(command ? { body: JSON.stringify(command) } : {}),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!r.ok)
      return operationalFailure(
        [400, 401, 403, 404, 409].includes(r.status) ? (r.status as OperationalFailureStatus) : 503,
      );
    const envelope = (await boundedJson(r, 1024 * 1024)) as { data?: unknown };
    const data = parseLocationOperationsState(envelope.data);
    return data ? Response.json({ data }, { headers }) : operationalFailure(503);
  } catch {
    return operationalFailure(503);
  }
}
import { parseHistoryQuery, parseOrderHistory, type HistoryQuery } from "@provide/contracts";
