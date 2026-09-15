import { describe, expect, it } from "vitest";

import { parseDashboardPublicConfig } from "./config.js";

describe("dashboard public configuration", () => {
  it("accepts a clean HTTPS Supabase origin", () => {
    expect(parseDashboardPublicConfig("https://project.supabase.co", "p".repeat(20))).toEqual({
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "p".repeat(20),
    });
  });

  it("rejects credentials, paths and short keys", () => {
    expect(
      parseDashboardPublicConfig("https://user:secret@project.supabase.co", "p".repeat(20)),
    ).toBeUndefined();
    expect(
      parseDashboardPublicConfig("https://project.supabase.co/auth/v1", "p".repeat(20)),
    ).toBeUndefined();
    expect(parseDashboardPublicConfig("https://project.supabase.co", "short")).toBeUndefined();
  });
});
