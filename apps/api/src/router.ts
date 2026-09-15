import type { StorefrontRoute } from "./storefront.js";

export type MatchedRoute = { readonly name: "databaseHealth" | "health" } | StorefrontRoute;

function matchPath(request: Request): MatchedRoute | undefined {
  const path = new URL(request.url).pathname;
  if (path === "/health") return { name: "health" };
  if (path === "/health/database") return { name: "databaseHealth" };
  const match = /^\/v1\/storefront\/([^/]+)\/([^/]+)\/(catalog|availability)$/.exec(path);
  if (match) {
    const [, restaurantSlug, locationSlug, name] = match;
    if (restaurantSlug && locationSlug && (name === "catalog" || name === "availability"))
      return { name, restaurantSlug, locationSlug };
  }
  return undefined;
}
export function routeRequest(request: Request): MatchedRoute | undefined {
  return request.method === "GET" ? matchPath(request) : undefined;
}
export function isKnownPath(request: Request): boolean {
  return matchPath(request) !== undefined;
}
