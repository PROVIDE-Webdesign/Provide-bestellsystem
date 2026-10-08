import { describe, expect, it, vi } from "vitest";
import {
  checkoutCookieName,
  checkoutDigest,
  checkoutMac,
  newCheckoutVerifier,
  verifyCheckoutRequest,
} from "@provide/contracts";
import {
  cloudflareCheckoutNetwork,
  handleCheckoutGateway,
  type CheckoutGatewayEnvironment,
} from "./protected-gateway";
const origin = "https://storefront.test";
const env: CheckoutGatewayEnvironment = {
  APP_ENV: "test",
  PUBLIC_API_URL: "https://api.test",
  CHECKOUT_PROTECTION_ENABLED: "true",
  CHECKOUT_STOREFRONT_ORIGIN: origin,
  CHECKOUT_GATEWAY_SECRET: "synthetic-o3-gateway-secret-at-least-32-bytes",
  CHECKOUT_NETWORK_SECRET: "synthetic-o3-network-secret-at-least-32-bytes",
};
const params = {
  restaurantSlug: "storefront-restaurant-a",
  locationSlug: "storefront-a-mitte",
  resource: "checkout-context",
};
const verifier = newCheckoutVerifier();
async function request(
  resource = "checkout-context",
  body: unknown = {},
  extra: Record<string, string> = {},
  cookie = true,
) {
  const hash = await checkoutDigest(verifier);
  return new Request(
    `${origin}/api/storefront/${params.restaurantSlug}/${params.locationSlug}/${resource}`,
    {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-provide-checkout-bootstrap": "1",
        ...(cookie
          ? {
              cookie: `${checkoutCookieName}=${verifier}`,
              "x-provide-checkout-csrf": await checkoutMac(
                env.CHECKOUT_GATEWAY_SECRET!,
                "csrf-v1",
                hash,
              ),
            }
          : {}),
        ...extra,
      },
      body: JSON.stringify(body),
    },
  );
}
function upstream(data: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json({ data }, { status, headers });
}
const network = () => "192.0.2.1";
describe("O3 production gateway function units", () => {
  it("O3-T01/T08 server-only bootstrap sets the host cookie and never exposes the verifier", async () => {
    let signed: Request | undefined;
    const fetcher: typeof fetch = (input, init) => {
      signed = new Request(input, init);
      return Promise.resolve(
        upstream({
          ready: true,
          contextExpiresAt: new Date(Date.now() + 5400000).toISOString(),
        }),
      );
    };
    const r = await handleCheckoutGateway(
      await request("checkout-context", {}, {}, false),
      params,
      env,
      fetcher,
      network,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(
      /__Host-provide-checkout=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=53\d\d/,
    );
    expect(r.headers.get("set-cookie")).not.toContain("Domain");
    const body = await r.text();
    const cookie = r.headers.get("set-cookie")!.split("=")[1]!.split(";")[0]!;
    expect(body).not.toContain(cookie);
    expect(body).toContain("csrf");
    expect(
      (
        await verifyCheckoutRequest(signed!, await signed!.clone().text(), [
          env.CHECKOUT_GATEWAY_SECRET,
        ])
      )?.freshContext,
    ).toBe(true);
  });
  it.each(["", "null", "https://other.test"])(
    "O3-T17 denies Origin %s before upstream",
    async (bad) => {
      const fetcher = vi.fn<typeof fetch>();
      expect(
        (
          await handleCheckoutGateway(
            await request("checkout-session", {}, { origin: bad }),
            { ...params, resource: "checkout-session" },
            env,
            fetcher,
            network,
          )
        ).status,
      ).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(["", "invalid", "a".repeat(43)])(
    "O3-T17 denies missing/tampered CSRF %s",
    async (bad) => {
      const fetcher = vi.fn<typeof fetch>();
      expect(
        (
          await handleCheckoutGateway(
            await request("cart-quote", {}, { "x-provide-checkout-csrf": bad }),
            { ...params, resource: "cart-quote" },
            env,
            fetcher,
            network,
          )
        ).status,
      ).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("O3-T02/T08 missing, malformed or duplicate host cookie cannot be replaced by a public session ID", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      (
        await handleCheckoutGateway(
          await request("orders", { sessionId: crypto.randomUUID(), command: {} }, {}, false),
          { ...params, resource: "orders" },
          env,
          fetcher,
          network,
        )
      ).status,
    ).toBe(410);
    for (const cookie of [
      `${checkoutCookieName}=short`,
      `${checkoutCookieName}=${verifier}; ${checkoutCookieName}=${verifier}`,
    ])
      expect(
        (
          await handleCheckoutGateway(
            await request("orders", {}, { cookie }),
            { ...params, resource: "orders" },
            env,
            fetcher,
            network,
          )
        ).status,
      ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("O3-T22 filters client credentials, forged signatures and raw IPs", async () => {
    let signed: Request | undefined;
    const fetcher: typeof fetch = (input, init) => {
      signed = new Request(input, init);
      return Promise.resolve(
        upstream({
          ready: true,
          contextExpiresAt: new Date(Date.now() + 5400000).toISOString(),
        }),
      );
    };
    const r = await handleCheckoutGateway(
      await request(
        "checkout-context",
        {},
        {
          authorization: "Bearer privileged",
          "x-provide-checkout": "forged",
          "x-provide-checkout-mac": "forged",
          "x-forwarded-for": "203.0.113.99",
          "cf-connecting-ip": "203.0.113.98",
        },
      ),
      params,
      env,
      fetcher,
      network,
    );
    expect(r.status).toBe(200);
    expect(signed!.headers.has("authorization")).toBe(false);
    expect(signed!.headers.has("cookie")).toBe(false);
    expect(signed!.headers.has("cf-connecting-ip")).toBe(false);
    expect([...signed!.headers.keys()].sort()).toEqual([
      "accept",
      "content-type",
      "x-provide-checkout",
      "x-provide-checkout-mac",
    ]);
    expect(await signed!.clone().text()).toBe("{}");
    expect(JSON.stringify([...signed!.headers])).not.toContain("192.0.2.1");
  });
  it.each(["12", "99999", "0", "https://evil.test"])(
    "O3-T23 strips upstream headers and validates Retry-After %s",
    async (retry) => {
      const fetcher: typeof fetch = () =>
        Promise.resolve(
          Response.json(
            { error: { code: "rate_limited", private: "secret" } },
            {
              status: 429,
              headers: {
                "retry-after": retry,
                "set-cookie": "evil=1",
                location: "https://evil.test",
                "x-internal": "hidden",
              },
            },
          ),
        );
      const r = await handleCheckoutGateway(await request(), params, env, fetcher, network);
      expect(r.status).toBe(429);
      expect(r.headers.get("retry-after")).toBe(retry === "12" ? "12" : null);
      expect(r.headers.has("set-cookie")).toBe(false);
      expect(r.headers.has("location")).toBe(false);
      expect(await r.text()).not.toContain("secret");
      expect(r.headers.get("cache-control")).toBe("no-store");
    },
  );
  it("O3-T24/T32 rotation charges both secret versions and both epochs", async () => {
    let signed: Request | undefined;
    const fetcher: typeof fetch = (input, init) => {
      signed = new Request(input, init);
      return Promise.resolve(
        upstream({
          ready: true,
          contextExpiresAt: new Date(Date.now() + 5400000).toISOString(),
        }),
      );
    };
    await handleCheckoutGateway(
      await request(),
      params,
      { ...env, CHECKOUT_NETWORK_SECRET_PREVIOUS: "synthetic-previous-network-secret-at-least-32" },
      fetcher,
      network,
    );
    expect(
      (
        await verifyCheckoutRequest(signed!, await signed!.clone().text(), [
          env.CHECKOUT_GATEWAY_SECRET,
        ])
      )?.network,
    ).toHaveLength(4);
  });
  it.each([
    { CHECKOUT_PROTECTION_ENABLED: "false" },
    { CHECKOUT_GATEWAY_SECRET: "short" },
    { PUBLIC_API_URL: "http://api.test" },
    { APP_ENV: "production", CHECKOUT_STOREFRONT_ORIGIN: "https://localhost" },
  ])("O3-T24/T38 config %j closes without fallback", async (override) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      (
        await handleCheckoutGateway(
          await request(),
          params,
          { ...env, ...override },
          fetcher,
          network,
        )
      ).status,
    ).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("O3-T29 trusted runtime identity is mandatory; headers alone grant no authority", async () => {
    const r = await request(
      "checkout-context",
      {},
      { "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.1" },
    );
    expect(cloudflareCheckoutNetwork(r)).toBeUndefined();
    const fetcher = vi.fn<typeof fetch>();
    expect((await handleCheckoutGateway(r, params, env, fetcher)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("O3-T18 bounded request failure cannot reach the API", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      (
        await handleCheckoutGateway(
          await request("checkout-context", { padding: "x".repeat(1500) }),
          params,
          env,
          fetcher,
          network,
        )
      ).status,
    ).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("O3-T06/T46 expired context clears its cookie so a new status-only context can be bootstrapped", async () => {
    const fetcher: typeof fetch = () =>
      Promise.resolve(
        Response.json({ error: { code: "checkout_session_expired" } }, { status: 410 }),
      );
    const r = await handleCheckoutGateway(await request(), params, env, fetcher, network);
    expect(r.status).toBe(410);
    expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
