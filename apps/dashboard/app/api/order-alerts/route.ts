import { fetchDashboardAcceptance } from "@/lib/gateway.js";
import { dashboardRouteFailure } from "@/lib/route-response.js";
import { dashboardAccessToken } from "@/lib/session.js";

export async function GET(request: Request) {
  if (
    process.env.DASHBOARD_AUTH_ENABLED !== "true" ||
    process.env.DASHBOARD_ORDER_OPERATIONS_ENABLED !== "true" ||
    process.env.DASHBOARD_ORDER_ALERTS_ENABLED !== "true"
  )
    return dashboardRouteFailure(503);
  const query = new URL(request.url).searchParams;
  if (
    [...query.keys()].some((k) => !["restaurantId", "locationId"].includes(k)) ||
    ["restaurantId", "locationId"].some((k) => query.getAll(k).length !== 1)
  )
    return dashboardRouteFailure(400);
  const session = await dashboardAccessToken();
  if (session.status !== "authenticated")
    return dashboardRouteFailure(session.status === "unauthorized" ? 401 : 503);
  return fetchDashboardAcceptance(session.accessToken, process.env.DASHBOARD_API_BASE_URL, {
    restaurantId: query.get("restaurantId")!,
    locationId: query.get("locationId")!,
  });
}
