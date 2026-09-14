import { describe, expect, it } from "vitest";

import { apiErrorCodes, isAppEnvironment } from "./index.js";

describe("isAppEnvironment", () => {
  it("accepts every supported environment", () => {
    expect(isAppEnvironment("development")).toBe(true);
    expect(isAppEnvironment("test")).toBe(true);
    expect(isAppEnvironment("preview")).toBe(true);
    expect(isAppEnvironment("production")).toBe(true);
  });

  it("rejects unknown environments", () => {
    expect(isAppEnvironment("staging-with-real-data")).toBe(false);
  });
});

describe("API contracts", () => {
  it("keeps error codes explicit and stable", () => {
    expect(apiErrorCodes).toContain("bad_request");
    expect(apiErrorCodes).toContain("payload_too_large");
  });
});
