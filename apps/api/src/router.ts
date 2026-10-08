import type { StorefrontRoute } from "./storefront.js";

export type DashboardOrderRoute =
  | {
      readonly name: "dashboardOrders" | "dashboardOrderAlerts";
      readonly restaurantId: string;
      readonly locationId: string;
      readonly orderId?: undefined;
    }
  | {
      readonly name:
        | "dashboardOrder"
        | "dashboardOrderStatus"
        | "dashboardRefundRetry"
        | "dashboardOrderCommunication";
      readonly restaurantId: string;
      readonly locationId: string;
      readonly orderId: string;
    };

export type MatchedRoute =
  | {
      readonly name:
        | "databaseHealth"
        | "health"
        | "dashboardAccess"
        | "stripeWebhook"
        | "provideAdmin"
        | "support"
        | "personnel"
        | "accountRecovery";
    }
  | {
      readonly name: "dashboardMenu" | "dashboardLocationOperations" | "dashboardHistory";
      readonly restaurantId: string;
      readonly locationId: string;
    }
  | DashboardOrderRoute
  | StorefrontRoute;

function matchPath(request: Request): MatchedRoute | undefined {
  const path = new URL(request.url).pathname;
  if (path === "/v1/provide/support") return { name: "support" };
  if (path === "/v1/account/recovery") return { name: "accountRecovery" };
  if (path === "/v1/dashboard/personnel") return { name: "personnel" };
  if (path === "/v1/provide/administration") return { name: "provideAdmin" };
  if (path === "/v1/payments/stripe/webhook") return { name: "stripeWebhook" };
  if (path === "/health") return { name: "health" };
  if (path === "/health/database") return { name: "databaseHealth" };
  if (path === "/v1/dashboard/access-context") return { name: "dashboardAccess" };
  const history = /^\/v1\/dashboard\/restaurants\/([^/]+)\/locations\/([^/]+)\/history$/.exec(path);
  if (history?.[1] && history[2])
    return { name: "dashboardHistory", restaurantId: history[1], locationId: history[2] };
  const operations = /^\/v1\/dashboard\/restaurants\/([^/]+)\/locations\/([^/]+)\/operations$/.exec(
    path,
  );
  if (operations?.[1] && operations[2])
    return {
      name: "dashboardLocationOperations",
      restaurantId: operations[1],
      locationId: operations[2],
    };
  const menu = /^\/v1\/dashboard\/restaurants\/([^/]+)\/locations\/([^/]+)\/menu$/.exec(path);
  if (menu?.[1] && menu[2])
    return { name: "dashboardMenu", restaurantId: menu[1], locationId: menu[2] };
  const alerts = /^\/v1\/dashboard\/restaurants\/([^/]+)\/locations\/([^/]+)\/order-alerts$/.exec(
    path,
  );
  if (alerts?.[1] && alerts[2])
    return { name: "dashboardOrderAlerts", restaurantId: alerts[1], locationId: alerts[2] };
  const dashboardOrder =
    /^\/v1\/dashboard\/restaurants\/([^/]+)\/locations\/([^/]+)\/orders(?:\/([^/]+)(\/status|\/refund-retry|\/communication)?)?$/.exec(
      path,
    );
  if (dashboardOrder) {
    const [, restaurantId, locationId, orderId, statusSuffix] = dashboardOrder;
    if (restaurantId && locationId) {
      if (!orderId) return { name: "dashboardOrders", restaurantId, locationId };
      return {
        name:
          statusSuffix === "/communication"
            ? "dashboardOrderCommunication"
            : statusSuffix === "/refund-retry"
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
    /^\/v1\/storefront\/([^/]+)\/([^/]+)\/(checkout-context|checkout-session|checkout-receipt|cart-quote|catalog|availability|orders|order-status|delivery-quote|delivery-orders|online-orders|payment-session)$/.exec(
      path,
    );
  if (match) {
    const [, restaurantSlug, locationSlug, name] = match;
    if (
      restaurantSlug &&
      locationSlug &&
      (name === "checkout-context" ||
        name === "checkout-session" ||
        name === "checkout-receipt" ||
        name === "cart-quote" ||
        name === "catalog" ||
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
    match.name === "dashboardHistory" ||
    match.name === "provideAdmin" ||
    match.name === "support" ||
    match.name === "personnel" ||
    match.name === "accountRecovery"
  )
    return request.method === "POST" ? match : undefined;
  if (match.name === "dashboardMenu" || match.name === "dashboardLocationOperations")
    return request.method === "GET" || request.method === "POST" ? match : undefined;
  if (
    match.name === "stripeWebhook" ||
    match.name === "online-orders" ||
    match.name === "payment-session"
  )
    return request.method === "POST" ? match : undefined;
  if (
    match.name === "checkout-context" ||
    match.name === "checkout-session" ||
    match.name === "checkout-receipt" ||
    match.name === "cart-quote" ||
    match.name === "orders" ||
    match.name === "orderStatus" ||
    match.name === "delivery-quote" ||
    match.name === "delivery-orders"
  )
    return request.method === "POST" ? match : undefined;
  if (
    match.name === "dashboardOrderStatus" ||
    match.name === "dashboardRefundRetry" ||
    match.name === "dashboardOrderCommunication"
  )
    return request.method === "POST" ? match : undefined;
  return request.method === "GET" ? match : undefined;
}
export function isKnownPath(request: Request): boolean {
  return matchPath(request) !== undefined;
}
