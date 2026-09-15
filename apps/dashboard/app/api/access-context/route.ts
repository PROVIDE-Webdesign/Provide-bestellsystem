import { fetchDashboardAccess } from "@/lib/gateway.js";
import { dashboardRouteFailure } from "@/lib/route-response.js";
import { dashboardAccessToken } from "@/lib/session.js";

export async function GET() {
  if (process.env.DASHBOARD_AUTH_ENABLED !== "true") return dashboardRouteFailure(503);
  const session = await dashboardAccessToken();
  if (session.status !== "authenticated")
    return dashboardRouteFailure(session.status === "unauthorized" ? 401 : 503);
  return fetchDashboardAccess(session.accessToken, process.env.DASHBOARD_API_BASE_URL);
}
