import { retryDashboardRefund } from "@/lib/gateway.js";
import { dashboardRouteFailure } from "@/lib/route-response.js";
import { dashboardAccessToken } from "@/lib/session.js";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly orderId: string }> },
) {
  if (
    process.env.DASHBOARD_AUTH_ENABLED !== "true" ||
    process.env.DASHBOARD_ORDER_OPERATIONS_ENABLED !== "true"
  )
    return dashboardRouteFailure(503);
  const origin = request.headers.get("origin");
  if (
    origin !== new URL(request.url).origin ||
    !request.headers.get("content-type")?.toLowerCase().startsWith("application/json") ||
    Number(request.headers.get("content-length") ?? "0") > 1024
  )
    return dashboardRouteFailure(400);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 1024) return dashboardRouteFailure(400);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return dashboardRouteFailure(400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
    return dashboardRouteFailure(400);
  const session = await dashboardAccessToken();
  if (session.status !== "authenticated")
    return dashboardRouteFailure(session.status === "unauthorized" ? 401 : 503);
  const query = new URL(request.url).searchParams;
  const { orderId } = await context.params;
  return retryDashboardRefund(session.accessToken, process.env.DASHBOARD_API_BASE_URL, {
    restaurantId: query.get("restaurantId") ?? "",
    locationId: query.get("locationId") ?? "",
    orderId,
  });
}
