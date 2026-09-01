import { describe, expect, it } from "vitest";

import { isAppEnvironment } from "./index.js";

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
