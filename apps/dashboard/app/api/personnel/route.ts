import { dashboardAccessToken } from "@/lib/session.js";
import { fetchPersonnel, readPersonnelBody } from "@/lib/gateway.js";
import { dashboardRouteFailure } from "@/lib/route-response.js";
export async function POST(request: Request) {
  if (
    process.env.DASHBOARD_AUTH_ENABLED !== "true" ||
    process.env.DASHBOARD_PERSONNEL_ENABLED !== "true"
  )
    return dashboardRouteFailure(503);
  const u = new URL(request.url);
  if (request.headers.get("origin") !== u.origin || u.searchParams.size)
    return dashboardRouteFailure(400);
  const session = await dashboardAccessToken();
  if (session.status !== "authenticated")
    return dashboardRouteFailure(session.status === "unauthorized" ? 401 : 503);
  try {
    return await fetchPersonnel(
      session.accessToken,
      process.env.DASHBOARD_API_BASE_URL,
      await readPersonnelBody(request),
    );
  } catch {
    return dashboardRouteFailure(400);
  }
}
