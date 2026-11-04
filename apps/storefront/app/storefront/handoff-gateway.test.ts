import { describe, it, expect, vi } from "vitest";
import { handleHandoffGateway } from "./handoff-gateway";
const env = {
  APP_ENV: "preview",
  CHECKOUT_STOREFRONT_ORIGIN: "https://shop.example",
  PUBLIC_API_URL: "https://api.example",
  CHECKOUT_GATEWAY_SECRET: "a".repeat(64),
  CHECKOUT_NETWORK_SECRET: "b".repeat(64),
};
const req = (body: unknown, origin = "https://shop.example", cookie?: string) =>
  new Request("https://shop.example/api/cart-handoff/demo-a", {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
describe("handoff boundary", () => {
  it("uses the Workers-supported redirect mode and rejects upstream redirects", async () => {
    const upstream = vi.fn(() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: "https://unexpected.example" } }),
      ),
    );
    const r = await handleHandoffGateway(
      new Request("https://shop.example/api/cart-handoff/demo-a", {
        headers: { origin: "https://source.example" },
      }),
      "demo-a",
      env,
      upstream,
      () => "203.0.113.1",
    );
    expect(r.status).toBe(503);
    const args = upstream.mock.calls[0] as unknown as [Request, RequestInit];
    expect(args[1].redirect).toBe("manual");
  });

  it("prepares an HttpOnly cookie before claiming, without upstream writes", async () => {
    const upstream = vi.fn();
    const r = await handleHandoffGateway(
      req({ action: "prepare" }),
      "demo-a",
      env,
      upstream,
      () => "203.0.113.1",
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain("Secure; HttpOnly; SameSite=Lax");
    expect(upstream).not.toHaveBeenCalled();
  });
  it("blocks foreign-origin redemption", async () => {
    expect(
      (
        await handleHandoffGateway(
          req({ action: "redeem", token: "a".repeat(64) }, "https://evil.example"),
          "demo-a",
          env,
          vi.fn(),
          () => "203.0.113.1",
        )
      ).status,
    ).toBe(403);
  });
  it("rejects missing browser claim cookie", async () => {
    expect(
      (
        await handleHandoffGateway(
          req({ action: "redeem", token: "a".repeat(64) }),
          "demo-a",
          env,
          vi.fn(),
          () => "203.0.113.1",
        )
      ).status,
    ).toBe(403);
  });
  it("rejects contact-bearing source selection before upstream", async () => {
    const upstream = vi.fn();
    expect(
      (
        await handleHandoffGateway(
          req({ action: "create", selection: { email: "private" } }, "https://source.example"),
          "demo-a",
          env,
          upstream,
          () => "203.0.113.1",
        )
      ).status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("forwards signed import context without raw IP or cookies", async () => {
    const upstream = vi.fn(() => Promise.resolve(Response.json({ data: { selection: {} } })));
    const r = await handleHandoffGateway(
      req(
        {
          action: "redeem",
          token: "a".repeat(64),
          restaurantSlug: "restaurant-a",
          locationSlug: "location-a",
        },
        undefined,
        "__Host-provide-cart-import=" + "b".repeat(64),
      ),
      "demo-a",
      env,
      upstream,
      () => "203.0.113.1",
    );
    expect(r.status).toBe(200);
    const args = upstream.mock.calls[0] as unknown as [Request, RequestInit];
    expect(JSON.stringify(args[1])).not.toContain("203.0.113.1");
    expect((args[1].headers as Headers).get("x-provide-checkout-mac")).toBeTruthy();
    expect((args[1].headers as Headers).get("cookie")).toBeNull();
  });
});
