import { dashboardAccessToken } from "@/lib/session.js";
import { fetchOrderHistory, readHistoryBody } from "@/lib/gateway.js";
import { dashboardRouteFailure } from "@/lib/route-response.js";
export async function POST(request: Request) {
  if (
    process.env.DASHBOARD_AUTH_ENABLED !== "true" ||
    process.env.DASHBOARD_HISTORY_ENABLED !== "true"
  )
    return dashboardRouteFailure(503);
  const url = new URL(request.url),
    q = url.searchParams;
  if (
    request.headers.get("origin") !== url.origin ||
    [...q.keys()].some((k) => !["restaurantId", "locationId"].includes(k)) ||
    q.getAll("restaurantId").length !== 1 ||
    q.getAll("locationId").length !== 1
  )
    return dashboardRouteFailure(400);
  const session = await dashboardAccessToken();
  if (session.status !== "authenticated")
    return dashboardRouteFailure(session.status === "unauthorized" ? 401 : 503);
  try {
    return await fetchOrderHistory(
      session.accessToken,
      process.env.DASHBOARD_API_BASE_URL,
      { restaurantId: q.get("restaurantId") ?? "", locationId: q.get("locationId") ?? "" },
      await readHistoryBody(request),
    );
  } catch {
    return dashboardRouteFailure(400);
  }
}
