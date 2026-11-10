import { describe, expect, it, vi } from "vitest";

import { createApiWorker } from "./index.js";

const previewEnvironment = {
  APP_ENV: "preview",
} as const;
const healthToken = "synthetic-monitor-token-0123456789-0123456789-0123456789";
const authorizedHealthRequest = () =>
  new Request("https://api-preview.example.test/health/database", {
    headers: { authorization: `Bearer ${healthToken}` },
  });

describe("API worker health endpoints", () => {
  it("reports an unconfigured database without contacting PostgreSQL", async () => {
    const databaseProbe = vi.fn<() => Promise<void>>();
    const worker = createApiWorker(databaseProbe);
    const response = await worker.fetch(
      new Request("https://api-preview.example.test/health"),
      previewEnvironment,
    );

    expect(response.status).toBe(200);
    expect(databaseProbe).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        database: "not-configured",
        environment: "preview",
        status: "ok",
      },
    });
  });

  it("refuses the database probe when Hyperdrive is missing", async () => {
    const worker = createApiWorker();
    const response = await worker.fetch(
      new Request("https://api-preview.example.test/health/database"),
      previewEnvironment,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "service_unavailable",
      },
    });
  });

  it("uses only the Hyperdrive connection string for a successful probe", async () => {
    const databaseProbe = vi.fn<() => Promise<void>>().mockResolvedValue();
    const worker = createApiWorker(databaseProbe);
    const response = await worker.fetch(authorizedHealthRequest(), {
      ...previewEnvironment,
      DATABASE_HEALTH_TOKEN: healthToken,
      HYPERDRIVE: { connectionString: "postgresql://hyperdrive.invalid/provide" },
    });

    expect(response.status).toBe(200);
    expect(databaseProbe).toHaveBeenCalledExactlyOnceWith(
      "postgresql://hyperdrive.invalid/provide",
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { database: "reachable", status: "ok" },
    });
  });

  it("does not expose database errors to the caller", async () => {
    const databaseProbe = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("secret host"));
    const worker = createApiWorker(databaseProbe);
    const response = await worker.fetch(authorizedHealthRequest(), {
      ...previewEnvironment,
      DATABASE_HEALTH_TOKEN: healthToken,
      HYPERDRIVE: { connectionString: "postgresql://hyperdrive.invalid/provide" },
    });

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.not.toContain("secret host");
  });

  it.each([undefined, "Bearer wrong", `Bearer ${"x".repeat(healthToken.length)}`])(
    "rejects an unauthorized database probe before contacting PostgreSQL",
    async (authorization) => {
      const databaseProbe = vi.fn<() => Promise<void>>();
      const worker = createApiWorker(databaseProbe);
      const response = await worker.fetch(
        new Request("https://api-preview.example.test/health/database", {
          headers: authorization ? { authorization } : {},
        }),
        {
          ...previewEnvironment,
          DATABASE_HEALTH_TOKEN: healthToken,
          HYPERDRIVE: { connectionString: "postgresql://hyperdrive.invalid/provide" },
        },
      );
      expect(response.status).toBe(401);
      expect(databaseProbe).not.toHaveBeenCalled();
      expect(await response.text()).not.toContain(healthToken);
    },
  );

  it("fails closed when the monitoring secret is absent", async () => {
    const databaseProbe = vi.fn<() => Promise<void>>();
    const response = await createApiWorker(databaseProbe).fetch(authorizedHealthRequest(), {
      ...previewEnvironment,
      HYPERDRIVE: { connectionString: "postgresql://hyperdrive.invalid/provide" },
    });
    expect(response.status).toBe(503);
    expect(databaseProbe).not.toHaveBeenCalled();
  });

  it("redirects plaintext production traffic before a database probe", async () => {
    const databaseProbe = vi.fn<() => Promise<void>>();
    const response = await createApiWorker(databaseProbe).fetch(
      new Request("http://api.example.test/health/database", {
        headers: { authorization: `Bearer ${healthToken}` },
      }),
      {
        APP_ENV: "production",
        DATABASE_HEALTH_TOKEN: healthToken,
        HYPERDRIVE: { connectionString: "postgresql://hyperdrive.invalid/provide" },
      },
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://api.example.test/health/database");
    expect(databaseProbe).not.toHaveBeenCalled();
  });

  it("returns a consistent 405 response for a known path with the wrong method", async () => {
    const worker = createApiWorker();
    const response = await worker.fetch(
      new Request("https://api-preview.example.test/health", { method: "POST" }),
      previewEnvironment,
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "method_not_allowed" },
    });
  });

  it("allows an explicitly configured CORS origin", async () => {
    const worker = createApiWorker();
    const response = await worker.fetch(
      new Request("https://api-preview.example.test/health", {
        headers: { origin: "https://storefront.example.test" },
      }),
      { ...previewEnvironment, API_ALLOWED_ORIGINS: "https://storefront.example.test" },
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://storefront.example.test",
    );
  });
});
