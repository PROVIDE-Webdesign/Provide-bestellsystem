import { describe, expect, it, vi } from "vitest";

import { createApiWorker } from "./index.js";

const previewEnvironment = {
  APP_ENV: "preview",
} as const;

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
      database: "not-configured",
      environment: "preview",
      status: "ok",
    });
  });

  it("refuses the database probe when Hyperdrive is missing", async () => {
    const worker = createApiWorker();
    const response = await worker.fetch(
      new Request("https://api-preview.example.test/health/database"),
      previewEnvironment,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      database: "not-configured",
      status: "unavailable",
    });
  });

  it("uses only the Hyperdrive connection string for a successful probe", async () => {
    const databaseProbe = vi.fn<() => Promise<void>>().mockResolvedValue();
    const worker = createApiWorker(databaseProbe);
    const response = await worker.fetch(
      new Request("https://api-preview.example.test/health/database"),
      {
        ...previewEnvironment,
        HYPERDRIVE: { connectionString: "postgresql://hyperdrive.invalid/provide" },
      },
    );

    expect(response.status).toBe(200);
    expect(databaseProbe).toHaveBeenCalledExactlyOnceWith(
      "postgresql://hyperdrive.invalid/provide",
    );
    await expect(response.json()).resolves.toEqual({ database: "reachable", status: "ok" });
  });

  it("does not expose database errors to the caller", async () => {
    const databaseProbe = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("secret host"));
    const worker = createApiWorker(databaseProbe);
    const response = await worker.fetch(
      new Request("https://api-preview.example.test/health/database"),
      {
        ...previewEnvironment,
        HYPERDRIVE: { connectionString: "postgresql://hyperdrive.invalid/provide" },
      },
    );

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.not.toContain("secret host");
  });
});
