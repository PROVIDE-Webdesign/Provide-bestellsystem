import { describe, expect, it, vi } from "vitest";

import { createApiWorker } from "./index.js";
import { InvalidDashboardTokenError } from "./dashboard-auth.js";

const url = "https://api.example.test/v1/dashboard/access-context";
const token = "header.payload.signature";
const env = {
  APP_ENV: "test",
  DASHBOARD_AUTH_ENABLED: "true",
  SUPABASE_AUTH_ISSUER: "https://project.supabase.co/auth/v1",
  SUPABASE_AUTH_AUDIENCE: "authenticated",
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "postgresql://synthetic.invalid/db" },
};
const context = {
  aal: "aal2",
  memberships: [
    {
      restaurantId: "f2000000-0000-0000-0000-000000000001",
      role: "owner",
      status: "active",
      access: "allowed",
      restaurant: { slug: "restaurant-a", displayName: "Restaurant A" },
      locations: [],
    },
  ],
};

function request(value = token) {
  return new Request(url, { headers: { authorization: `Bearer ${value}` } });
}

describe("dashboard access API", () => {
  it("verifies identity before reading a minimal access context", async () => {
    const verifier = {
      verify: vi
        .fn()
        .mockResolvedValue({ userId: "f1000000-0000-0000-0000-000000000001", aal: "aal2" }),
    };
    const reader = { read: vi.fn().mockResolvedValue(context) };
    const worker = createApiWorker(
      vi.fn(),
      { error: vi.fn() },
      undefined,
      undefined,
      undefined,
      verifier,
      reader,
    );
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(verifier.verify).toHaveBeenCalledWith(token, env);
    expect(reader.read).toHaveBeenCalledWith(
      env.HYPERDRIVE.connectionString,
      "f1000000-0000-0000-0000-000000000001",
      "aal2",
    );
  });

  it("fails closed before SQL when disabled or unauthenticated", async () => {
    const verifier = { verify: vi.fn() };
    const reader = { read: vi.fn() };
    const worker = createApiWorker(
      vi.fn(),
      { error: vi.fn() },
      undefined,
      undefined,
      undefined,
      verifier,
      reader,
    );
    expect(
      (await worker.fetch(request(), { ...env, DASHBOARD_AUTH_ENABLED: "false" })).status,
    ).toBe(503);
    expect((await worker.fetch(new Request(url), env)).status).toBe(401);
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("returns a generic unauthorized response for rejected identity", async () => {
    const verifier = { verify: vi.fn().mockRejectedValue(new InvalidDashboardTokenError()) };
    const reader = { read: vi.fn() };
    const worker = createApiWorker(
      vi.fn(),
      { error: vi.fn() },
      undefined,
      undefined,
      undefined,
      verifier,
      reader,
    );
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(token);
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("uses a service error when the identity provider is unavailable", async () => {
    const logger = { error: vi.fn() };
    const verifier = { verify: vi.fn().mockRejectedValue(new Error(token)) };
    const reader = { read: vi.fn() };
    const worker = createApiWorker(
      vi.fn(),
      logger,
      undefined,
      undefined,
      undefined,
      verifier,
      reader,
    );
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(503);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(token);
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("hides database and token details", async () => {
    const logger = { error: vi.fn() };
    const verifier = {
      verify: vi
        .fn()
        .mockResolvedValue({ userId: "f1000000-0000-0000-0000-000000000001", aal: "aal1" }),
    };
    const reader = { read: vi.fn().mockRejectedValue(new Error(token)) };
    const worker = createApiWorker(
      vi.fn(),
      logger,
      undefined,
      undefined,
      undefined,
      verifier,
      reader,
    );
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(token);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(token);
  });
});
