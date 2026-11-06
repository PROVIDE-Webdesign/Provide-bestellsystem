import { readCheckoutBody, type CheckoutBodyError } from "@provide/contracts";
import { fetchDashboardOrderPush } from "@/lib/gateway.js";
import { dashboardRouteFailure } from "@/lib/route-response.js";
import { dashboardAccessToken } from "@/lib/session.js";

export async function POST(request: Request) {
  if (
    process.env.DASHBOARD_AUTH_ENABLED !== "true" ||
    process.env.DASHBOARD_ORDER_OPERATIONS_ENABLED !== "true" ||
    process.env.DASHBOARD_ORDER_ALERTS_ENABLED !== "true" ||
    process.env.DASHBOARD_ORDER_PUSH_ENABLED !== "true"
  )
    return dashboardRouteFailure(503);
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) return dashboardRouteFailure(400);
  const query = url.searchParams;
  if (
    [...query.keys()].some((key) => !["restaurantId", "locationId"].includes(key)) ||
    ["restaurantId", "locationId"].some((key) => query.getAll(key).length !== 1)
  )
    return dashboardRouteFailure(400);

  const session = await dashboardAccessToken();
  if (session.status !== "authenticated")
    return dashboardRouteFailure(session.status === "unauthorized" ? 401 : 503);
  let body: unknown;
  try {
    body = JSON.parse(await readCheckoutBody(request, 4096));
  } catch (error) {
    const status = (error as CheckoutBodyError | undefined)?.status;
    if (status === 413 || status === 415) return new Response(null, { status });
    return dashboardRouteFailure(400);
  }
  return fetchDashboardOrderPush(
    session.accessToken,
    process.env.DASHBOARD_API_BASE_URL,
    {
      restaurantId: query.get("restaurantId")!,
      locationId: query.get("locationId")!,
    },
    body,
  );
}
