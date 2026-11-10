import { describe, expect, it, vi } from "vitest";
import { secureHttpResponse } from "./http-security.js";

describe("public HTTP security boundary", () => {
  it.each(["GET", "POST", "HEAD"])(
    "redirects production %s before running any handler",
    async (method) => {
      const next = vi.fn(() => new Response("must not run"));
      const response = await secureHttpResponse(
        new Request("http://shop.example.test/checkout?scope=a", { method }),
        "production",
        next,
      );
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe("https://shop.example.test/checkout?scope=a");
      expect(await response.text()).toBe("");
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each([200, 401, 404, 503])("protects HTTPS responses including status %s", async (status) => {
    const response = await secureHttpResponse(
      new Request("https://shop.example.test/"),
      "production",
      () => new Response("unchanged content", { status, headers: { "cache-control": "no-store" } }),
    );
    expect(response.status).toBe(status);
    expect(await response.text()).toBe("unchanged content");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("preserves independent session cookies and an existing CSP", async () => {
    const headers = new Headers({ "content-security-policy": "default-src 'self'" });
    headers.append("set-cookie", "session.0=first; Path=/; Secure; SameSite=Lax");
    headers.append("set-cookie", "session.1=second; Path=/; Secure; SameSite=Lax");
    const response = await secureHttpResponse(
      new Request("https://dashboard.example.test/"),
      "production",
      () => new Response("signed in", { headers }),
    );
    expect(response.headers.getSetCookie()).toEqual([
      "session.0=first; Path=/; Secure; SameSite=Lax",
      "session.1=second; Path=/; Secure; SameSite=Lax",
    ]);
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'self', frame-ancestors 'none'",
    );
  });

  it("allows an isolated local HTTP preview without an HTTPS redirect loop", async () => {
    const response = await secureHttpResponse(
      new Request("http://127.0.0.1:30092/"),
      "preview",
      () => new Response("preview"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.has("strict-transport-security")).toBe(false);
    expect(await response.text()).toBe("preview");
  });
});
