import { dashboardAccessToken } from "@/lib/session.js";
import { fetchDashboardMenu, readDashboardMenuBody } from "@/lib/gateway.js";
import { dashboardRouteFailure } from "@/lib/route-response.js";
async function handle(request: Request) {
  if (
    process.env.DASHBOARD_AUTH_ENABLED !== "true" ||
    process.env.DASHBOARD_MENU_ENABLED !== "true"
  )
    return dashboardRouteFailure(503);
  const query = new URL(request.url).searchParams;
  if (
    [...query.keys()].some((k) => !["restaurantId", "locationId"].includes(k)) ||
    query.getAll("restaurantId").length !== 1 ||
    query.getAll("locationId").length !== 1
  )
    return dashboardRouteFailure(400);
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin)
    return dashboardRouteFailure(400);
  const session = await dashboardAccessToken();
  if (session.status !== "authenticated")
    return dashboardRouteFailure(session.status === "unauthorized" ? 401 : 503);
  try {
    return fetchDashboardMenu(
      session.accessToken,
      process.env.DASHBOARD_API_BASE_URL,
      { restaurantId: query.get("restaurantId") ?? "", locationId: query.get("locationId") ?? "" },
      request.method === "POST" ? await readDashboardMenuBody(request) : null,
    );
  } catch {
    return dashboardRouteFailure(400);
  }
}
export const GET = handle;
export const POST = handle;
