import type { StorefrontRoute } from "./storefront.js";

export type DashboardOrderRoute =
  | {
      readonly name: "dashboardOrders";
      readonly restaurantId: string;
      readonly locationId: string;
      readonly orderId?: undefined;
    }
  | {
      readonly name: "dashboardOrder" | "dashboardOrderStatus";
      readonly restaurantId: string;
      readonly locationId: string;
      readonly orderId: string;
    };

export type MatchedRoute =
  | { readonly name: "databaseHealth" | "health" | "dashboardAccess" }
  | DashboardOrderRoute
  | StorefrontRoute;

function matchPath(request: Request): MatchedRoute | undefined {
  const path = new URL(request.url).pathname;
  if (path === "/health") return { name: "health" };
  if (path === "/health/database") return { name: "databaseHealth" };
  if (path === "/v1/dashboard/access-context") return { name: "dashboardAccess" };
  const dashboardOrder =
    /^\/v1\/dashboard\/restaurants\/([^/]+)\/locations\/([^/]+)\/orders(?:\/([^/]+)(\/status)?)?$/.exec(
      path,
    );
  if (dashboardOrder) {
    const [, restaurantId, locationId, orderId, statusSuffix] = dashboardOrder;
    if (restaurantId && locationId) {
      if (!orderId) return { name: "dashboardOrders", restaurantId, locationId };
      return {
        name: statusSuffix ? "dashboardOrderStatus" : "dashboardOrder",
        restaurantId,
        locationId,
        orderId,
      };
    }
  }
  const match =
    /^\/v1\/storefront\/([^/]+)\/([^/]+)\/(catalog|availability|orders|order-status)$/.exec(path);
  if (match) {
    const [, restaurantSlug, locationSlug, name] = match;
    if (
      restaurantSlug &&
      locationSlug &&
      (name === "catalog" ||
        name === "availability" ||
        name === "orders" ||
        name === "order-status")
    )
      return {
        name: name === "order-status" ? "orderStatus" : name,
        restaurantSlug,
        locationSlug,
      };
  }
  return undefined;
}
export function routeRequest(request: Request): MatchedRoute | undefined {
  const match = matchPath(request);
  if (!match) return undefined;
  if (match.name === "orders" || match.name === "orderStatus")
    return request.method === "POST" ? match : undefined;
  if (match.name === "dashboardOrderStatus") return request.method === "POST" ? match : undefined;
  return request.method === "GET" ? match : undefined;
}
export function isKnownPath(request: Request): boolean {
  return matchPath(request) !== undefined;
}
