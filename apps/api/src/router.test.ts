import { describe, expect, it } from "vitest";

import { isKnownPath, routeRequest } from "./router.js";

describe("API router", () => {
  it("routes only declared health endpoints", () => {
    expect(routeRequest(new Request("https://api.example.test/health"))).toEqual({
      name: "health",
    });
    expect(routeRequest(new Request("https://api.example.test/unknown"))).toBeUndefined();
  });

  it("recognizes a known path independently from the method", () => {
    expect(isKnownPath(new Request("https://api.example.test/health", { method: "POST" }))).toBe(
      true,
    );
  });

  it("allows only POST for the pickup order boundary", () => {
    const url = "https://api.example.test/v1/storefront/restaurant-a/location-a/orders";
    expect(routeRequest(new Request(url, { method: "POST" }))).toEqual({
      name: "orders",
      restaurantSlug: "restaurant-a",
      locationSlug: "location-a",
    });
    expect(routeRequest(new Request(url))).toBeUndefined();
    expect(isKnownPath(new Request(url))).toBe(true);
  });

  it("allows only POST for the public order status capability boundary", () => {
    const url = "https://api.example.test/v1/storefront/restaurant-a/location-a/order-status";
    expect(routeRequest(new Request(url, { method: "POST" }))).toEqual({
      name: "orderStatus",
      restaurantSlug: "restaurant-a",
      locationSlug: "location-a",
    });
    expect(routeRequest(new Request(url))).toBeUndefined();
    expect(isKnownPath(new Request(url))).toBe(true);
  });

  it("allows only GET for the dashboard access boundary", () => {
    const url = "https://api.example.test/v1/dashboard/access-context";
    expect(routeRequest(new Request(url))).toEqual({ name: "dashboardAccess" });
    expect(routeRequest(new Request(url, { method: "POST" }))).toBeUndefined();
    expect(isKnownPath(new Request(url, { method: "POST" }))).toBe(true);
  });
});
