import { dashboardAccessToken } from "@/lib/session.js";
import { fetchProvideAdmin, readProvideAdminBody } from "@/lib/gateway.js";
import { dashboardRouteFailure } from "@/lib/route-response.js";
export async function POST(request: Request) {
  if (process.env.DASHBOARD_AUTH_ENABLED !== "true" || process.env.PROVIDE_ADMIN_ENABLED !== "true")
    return dashboardRouteFailure(503);
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin || url.searchParams.size)
    return dashboardRouteFailure(400);
  const session = await dashboardAccessToken();
  if (session.status !== "authenticated")
    return dashboardRouteFailure(session.status === "unauthorized" ? 401 : 503);
  try {
    return await fetchProvideAdmin(
      session.accessToken,
      process.env.DASHBOARD_API_BASE_URL,
      await readProvideAdminBody(request),
    );
  } catch {
    return dashboardRouteFailure(400);
  }
}
