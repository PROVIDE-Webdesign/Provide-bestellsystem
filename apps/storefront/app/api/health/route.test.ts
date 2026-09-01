import { describe, expect, it } from "vitest";

import { GET } from "./route.js";

describe("storefront health route", () => {
  it("reports the isolated preview runtime", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      application: "storefront",
      environment: "preview",
      runtime: "cloudflare-workers-vinext",
      status: "ok",
    });
  });
});
