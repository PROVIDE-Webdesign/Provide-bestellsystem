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
});
