import { describe, expect, it } from "vitest";

import { corsHeaders, parseAllowedOrigins } from "./cors.js";

describe("CORS boundary", () => {
  it("uses local storefront origin by default", () => {
    expect(parseAllowedOrigins(undefined)).toEqual(["http://localhost:3000"]);
  });

  it("does not reflect an unapproved origin", () => {
    const request = new Request("https://api.example.test/health", {
      headers: { origin: "https://untrusted.example.test" },
    });

    expect(
      corsHeaders(request, ["https://storefront.example.test"]).get("access-control-allow-origin"),
    ).toBeNull();
  });
});
