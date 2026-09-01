import { describe, expect, it } from "vitest";

import { loadPublicEnvironment } from "./public.js";
import { loadServerEnvironment } from "./server.js";

const validEnvironment = {
  APP_ENV: "preview",
  AUTH_SESSION_SECRET: "a-safe-example-with-at-least-32-characters",
  DATABASE_URL: "postgresql://user:password@localhost:5432/provide",
  PUBLIC_API_URL: "https://api-preview.example.test",
  PUBLIC_DASHBOARD_URL: "https://dashboard-preview.example.test",
  PUBLIC_STOREFRONT_URL: "https://storefront-preview.example.test",
} as const;

describe("loadPublicEnvironment", () => {
  it("returns only explicitly public values", () => {
    const environment = loadPublicEnvironment(validEnvironment);

    expect(environment).toEqual({
      APP_ENV: "preview",
      PUBLIC_API_URL: validEnvironment.PUBLIC_API_URL,
      PUBLIC_DASHBOARD_URL: validEnvironment.PUBLIC_DASHBOARD_URL,
      PUBLIC_STOREFRONT_URL: validEnvironment.PUBLIC_STOREFRONT_URL,
    });
    expect(environment).not.toHaveProperty("AUTH_SESSION_SECRET");
    expect(environment).not.toHaveProperty("DATABASE_URL");
  });

  it("rejects unknown deployment environments", () => {
    expect(() =>
      loadPublicEnvironment({ ...validEnvironment, APP_ENV: "production-test" }),
    ).toThrow("Unsupported APP_ENV");
  });
});

describe("loadServerEnvironment", () => {
  it("returns validated public and server-only values", () => {
    expect(loadServerEnvironment(validEnvironment)).toEqual(validEnvironment);
  });

  it("rejects missing variables", () => {
    expect(() => loadServerEnvironment({ ...validEnvironment, DATABASE_URL: undefined })).toThrow(
      "Missing required environment variable: DATABASE_URL",
    );
  });

  it("rejects non-PostgreSQL database URLs", () => {
    expect(() =>
      loadServerEnvironment({ ...validEnvironment, DATABASE_URL: "https://example.test" }),
    ).toThrow("DATABASE_URL must use postgres: or postgresql:");
  });

  it("rejects weak session secrets", () => {
    expect(() =>
      loadServerEnvironment({ ...validEnvironment, AUTH_SESSION_SECRET: "too-short" }),
    ).toThrow("AUTH_SESSION_SECRET must contain at least 32 characters");
  });
});
