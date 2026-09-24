import type { StorefrontRoute } from "./storefront.js";

export type DashboardOrderRoute =
  | {
      readonly name: "dashboardOrders";
      readonly restaurantId: string;
      readonly locationId: string;
      readonly orderId?: undefined;
    }
  | {
      readonly name: "dashboardOrder" | "dashboardOrderStatus" | "dashboardRefundRetry";
      readonly restaurantId: string;
      readonly locationId: string;
      readonly orderId: string;
    };

export type MatchedRoute =
  | { readonly name: "databaseHealth" | "health" | "dashboardAccess" | "stripeWebhook" }
  | DashboardOrderRoute
  | StorefrontRoute;

function matchPath(request: Request): MatchedRoute | undefined {
  const path = new URL(request.url).pathname;
  if (path === "/v1/payments/stripe/webhook") return { name: "stripeWebhook" };
  if (path === "/health") return { name: "health" };
  if (path === "/health/database") return { name: "databaseHealth" };
  if (path === "/v1/dashboard/access-context") return { name: "dashboardAccess" };
  const dashboardOrder =
    /^\/v1\/dashboard\/restaurants\/([^/]+)\/locations\/([^/]+)\/orders(?:\/([^/]+)(\/status|\/refund-retry)?)?$/.exec(
      path,
    );
  if (dashboardOrder) {
    const [, restaurantId, locationId, orderId, statusSuffix] = dashboardOrder;
    if (restaurantId && locationId) {
      if (!orderId) return { name: "dashboardOrders", restaurantId, locationId };
      return {
        name:
          statusSuffix === "/refund-retry"
            ? "dashboardRefundRetry"
            : statusSuffix
              ? "dashboardOrderStatus"
              : "dashboardOrder",
        restaurantId,
        locationId,
        orderId,
      };
    }
  }
  const match =
    /^\/v1\/storefront\/([^/]+)\/([^/]+)\/(catalog|availability|orders|order-status|delivery-quote|delivery-orders|online-orders|payment-session)$/.exec(
      path,
    );
  if (match) {
    const [, restaurantSlug, locationSlug, name] = match;
    if (
      restaurantSlug &&
      locationSlug &&
      (name === "catalog" ||
        name === "availability" ||
        name === "orders" ||
        name === "order-status" ||
        name === "delivery-quote" ||
        name === "delivery-orders" ||
        name === "online-orders" ||
        name === "payment-session")
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
  if (
    match.name === "stripeWebhook" ||
    match.name === "online-orders" ||
    match.name === "payment-session"
  )
    return request.method === "POST" ? match : undefined;
  if (
    match.name === "orders" ||
    match.name === "orderStatus" ||
    match.name === "delivery-quote" ||
    match.name === "delivery-orders"
  )
    return request.method === "POST" ? match : undefined;
  if (match.name === "dashboardOrderStatus" || match.name === "dashboardRefundRetry")
    return request.method === "POST" ? match : undefined;
  return request.method === "GET" ? match : undefined;
}
export function isKnownPath(request: Request): boolean {
  return matchPath(request) !== undefined;
}
