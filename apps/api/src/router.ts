export type RouteName = "databaseHealth" | "health";

export interface MatchedRoute {
  readonly name: RouteName;
}

export function routeRequest(request: Request): MatchedRoute | undefined {
  const path = new URL(request.url).pathname;
  if (request.method !== "GET") {
    return undefined;
  }

  if (path === "/health") {
    return { name: "health" };
  }
  if (path === "/health/database") {
    return { name: "databaseHealth" };
  }
  return undefined;
}

export function isKnownPath(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return path === "/health" || path === "/health/database";
}
