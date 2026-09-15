import { parseDashboardAccessContext } from "@provide/contracts";

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
