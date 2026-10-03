import { parseRecoveryRequest, parseRecoveryCase } from "@provide/contracts";
import { dashboardAccessToken } from "@/lib/session.js";
import { dashboardRouteFailure } from "@/lib/route-response.js";
async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return undefined;
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    await reader.cancel().catch(() => undefined);
    return undefined;
  } finally {
    reader.releaseLock();
  }
}
export async function POST(request: Request) {
  if (
    process.env.ACCOUNT_RECOVERY_ENABLED !== "true" ||
    process.env.DASHBOARD_AUTH_ENABLED !== "true"
  )
    return dashboardRouteFailure(503);
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin || new URL(request.url).searchParams.size)
    return dashboardRouteFailure(400);
  const session = await dashboardAccessToken();
  if (session.status !== "authenticated")
    return dashboardRouteFailure(session.status === "unauthorized" ? 401 : 503);
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return dashboardRouteFailure(400);
    const q = parseRecoveryRequest(await boundedJson(request));
    if (!q) return dashboardRouteFailure(400);
    const base = new URL(process.env.DASHBOARD_API_BASE_URL ?? "");
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/" ||
      (base.protocol !== "https:" &&
        !(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname)))
    )
      return dashboardRouteFailure(503);
    const r = await fetch(new URL("/v1/account/recovery", base), {
      method: "POST",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.accessToken}`,
        origin,
      },
      body: JSON.stringify(q),
    });
    if (!r.ok) {
      await r.body?.cancel();
      return Response.json(
        {
          error: {
            code: r.status === 403 ? "forbidden" : r.status === 409 ? "conflict" : "unavailable",
          },
        },
        {
          status: [400, 401, 403, 404, 409, 503].includes(r.status) ? r.status : 503,
          headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" },
        },
      );
    }
    const value: unknown = await r.json();
    const data =
      value && typeof value === "object" && "data" in value
        ? parseRecoveryCase(value.data)
        : undefined;
    if (!data || data.caseId !== q.command.caseId) return dashboardRouteFailure(503);
    return Response.json(
      { data },
      { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } },
    );
  } catch {
    return dashboardRouteFailure(503);
  }
}
