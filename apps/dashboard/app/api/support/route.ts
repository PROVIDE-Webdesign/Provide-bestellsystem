import { dashboardAccessToken } from "@/lib/session.js";
import { fetchSupport, readSupportBody } from "@/lib/gateway.js";
import { dashboardRouteFailure } from "@/lib/route-response.js";
export async function POST(request: Request) {
  if (process.env.DASHBOARD_AUTH_ENABLED !== "true" || process.env.SUPPORT_CASES_ENABLED !== "true")
    return dashboardRouteFailure(503);
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin || url.searchParams.size)
    return dashboardRouteFailure(400);
  const session = await dashboardAccessToken();
  if (session.status !== "authenticated")
    return dashboardRouteFailure(session.status === "unauthorized" ? 401 : 503);
  try {
    const command = await readSupportBody(request);
    if (command.action === "partial_refund" && process.env.SUPPORT_TEST_REFUNDS_ENABLED !== "true")
      return dashboardRouteFailure(503);
    return await fetchSupport(session.accessToken, process.env.DASHBOARD_API_BASE_URL, command);
  } catch {
    return dashboardRouteFailure(400);
  }
}
