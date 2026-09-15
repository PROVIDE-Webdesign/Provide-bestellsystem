import type { StorefrontRoute } from "./storefront.js";

export type MatchedRoute = { readonly name: "databaseHealth" | "health" } | StorefrontRoute;

function matchPath(request: Request): MatchedRoute | undefined {
  const path = new URL(request.url).pathname;
  if (path === "/health") return { name: "health" };
  if (path === "/health/database") return { name: "databaseHealth" };
  const match = /^\/v1\/storefront\/([^/]+)\/([^/]+)\/(catalog|availability|orders)$/.exec(path);
  if (match) {
    const [, restaurantSlug, locationSlug, name] = match;
    if (
      restaurantSlug &&
      locationSlug &&
      (name === "catalog" || name === "availability" || name === "orders")
    )
      return { name, restaurantSlug, locationSlug };
  }
  return undefined;
}
export function routeRequest(request: Request): MatchedRoute | undefined {
  const match = matchPath(request);
  if (!match) return undefined;
  if (match.name === "orders") return request.method === "POST" ? match : undefined;
  return request.method === "GET" ? match : undefined;
}
export function isKnownPath(request: Request): boolean {
  return matchPath(request) !== undefined;
}
