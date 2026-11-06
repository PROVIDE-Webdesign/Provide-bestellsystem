import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route.js";

describe("storefront health route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["preview", "production"])("reports the %s runtime", async (environment) => {
    vi.stubEnv("APP_ENV", environment);
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      application: "storefront",
      environment,
      runtime: "cloudflare-workers-vinext",
      status: "ok",
    });
  });
});
