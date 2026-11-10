import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { dashboardAuthCookieOptions } from "./auth-cookie-options.js";

afterEach(() => vi.unstubAllGlobals());

describe("Supabase cookie security", () => {
  it("writes secure browser storage cookies with the installed Supabase adapter", async () => {
    const writes: Array<{ options: { secure?: boolean; sameSite?: unknown } }> = [];
    const client = createBrowserClient(
      "https://synthetic-audit.supabase.co",
      "sb_publishable_synthetic_audit",
      {
        isSingleton: false,
        cookieOptions: dashboardAuthCookieOptions,
        auth: { autoRefreshToken: false, detectSessionInUrl: false },
        cookies: {
          getAll: () => [],
          setAll: (items) => {
            writes.push(...items);
          },
        },
      },
    );
    const storage = client.auth as unknown as {
      storage: { setItem: (name: string, value: string) => Promise<void> };
    };
    await storage.storage.setItem("synthetic-cookie-test", "synthetic-non-session-value");
    expect(writes.length).toBeGreaterThan(0);
    expect(
      writes.every(({ options }) => options.secure === true && options.sameSite === "lax"),
    ).toBe(true);
  });

  it("keeps PKCE server cookie writes secure", async () => {
    const writes: Array<{ options: { secure?: boolean } }> = [];
    const client = createServerClient(
      "https://synthetic-audit.supabase.co",
      "sb_publishable_synthetic_audit",
      {
        cookieOptions: dashboardAuthCookieOptions,
        auth: { autoRefreshToken: false, detectSessionInUrl: false },
        cookies: {
          getAll: () => [],
          setAll: (items) => {
            writes.push(...items);
          },
        },
      },
    );
    const storage = client.auth as unknown as {
      storage: { setItem: (name: string, value: string) => Promise<void> };
    };
    await storage.storage.setItem("synthetic-cookie-test-code-verifier", "synthetic-pkce-value");
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every(({ options }) => options.secure === true)).toBe(true);
  });
});
