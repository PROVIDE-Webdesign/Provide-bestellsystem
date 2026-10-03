import { parseRecoveryRequest, parseRecoveryCase } from "@provide/contracts";
import { dashboardAccessToken } from "@/lib/session.js";
import { dashboardRouteFailure } from "@/lib/route-response.js";
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
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4096) return dashboardRouteFailure(400);
    const q = parseRecoveryRequest(JSON.parse(raw));
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
    if (!data) return dashboardRouteFailure(503);
    return Response.json(
      { data },
      { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } },
    );
  } catch {
    return dashboardRouteFailure(503);
  }
}
