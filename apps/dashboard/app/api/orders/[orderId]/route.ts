import { fetchDashboardOrderDetail } from "@/lib/gateway.js";
import { dashboardRouteFailure } from "@/lib/route-response.js";
import { dashboardAccessToken } from "@/lib/session.js";

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly orderId: string }> },
) {
  if (
    process.env.DASHBOARD_AUTH_ENABLED !== "true" ||
    process.env.DASHBOARD_ORDER_OPERATIONS_ENABLED !== "true"
  )
    return dashboardRouteFailure(503);
  const session = await dashboardAccessToken();
  if (session.status !== "authenticated")
    return dashboardRouteFailure(session.status === "unauthorized" ? 401 : 503);
  const query = new URL(request.url).searchParams;
  const { orderId } = await context.params;
  return fetchDashboardOrderDetail(session.accessToken, process.env.DASHBOARD_API_BASE_URL, {
    restaurantId: query.get("restaurantId") ?? "",
    locationId: query.get("locationId") ?? "",
    orderId,
  });
}
