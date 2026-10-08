import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutChallengeConfig, turnstileCheckoutChallenge } from "./checkout-challenge.js";
const secret = "synthetic-challenge-secret-at-least-32-bytes";
const issueId = crypto.randomUUID();
const positive = () => ({
  success: true,
  hostname: "storefront.test",
  action: "checkout_issue",
  cdata: issueId,
  challenge_ts: new Date().toISOString(),
});
afterEach(() => vi.unstubAllGlobals());
describe("O3 server Siteverify adapter (local HTTP response doubles)", () => {
  it("O3-T33/T35 binds hostname/action/context and sends the same provider UUID without raw IP", async () => {
    const bodies: string[] = [];
    const fetcher: typeof fetch = (input, init) => {
      expect(
        input instanceof Request ? input.url : typeof input === "string" ? input : input.href,
      ).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(typeof init?.body).toBe("string");
      bodies.push(typeof init?.body === "string" ? init.body : "");
      return Promise.resolve(Response.json(positive()));
    };
    vi.stubGlobal("fetch", fetcher);
    for (let n = 0; n < 2; n++)
      expect(
        await turnstileCheckoutChallenge.verify(
          { secret, hostname: "storefront.test" },
          "local-token",
          issueId,
        ),
      ).toBe(true);
    expect(bodies[0]).toBe(bodies[1]);
    expect(JSON.parse(bodies[0]!)).toEqual({
      secret,
      response: "local-token",
      idempotency_key: issueId,
    });
  });
  it.each([
    { success: false },
    { hostname: "other.test" },
    { action: "other" },
    { cdata: crypto.randomUUID() },
    { challenge_ts: new Date(Date.now() - 301000).toISOString() },
    { challenge_ts: "invalid" },
  ])("O3-T34 rejects negative or changed provider result %j", async (change) => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ ...positive(), ...change })));
    expect(
      await turnstileCheckoutChallenge.verify(
        { secret, hostname: "storefront.test" },
        "local-token",
        issueId,
      ),
    ).toBe(false);
  });
  it("O3-T18/T36 bounds streamed provider JSON and creates no success on transport uncertainty", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(Response.json({ success: true, padding: "x".repeat(9000) })),
    );
    await expect(
      turnstileCheckoutChallenge.verify(
        { secret, hostname: "storefront.test" },
        "local-token",
        issueId,
      ),
    ).rejects.toThrow();
    vi.stubGlobal("fetch", () => Promise.reject(Error("local transport outage")));
    await expect(
      turnstileCheckoutChallenge.verify(
        { secret, hostname: "storefront.test" },
        "local-token",
        issueId,
      ),
    ).rejects.toThrow();
  });
  it.each([
    "https://localhost",
    "https://127.0.0.2",
    "https://[::1]",
    "https://storefront.test",
    "https://example.com",
    "https://synthetic.invalid",
  ])("O3-T24 production rejects fixture origin %s", (origin) => {
    expect(
      checkoutChallengeConfig({
        APP_ENV: "production",
        CHECKOUT_STOREFRONT_ORIGIN: origin,
        CHECKOUT_TURNSTILE_SECRET: secret,
      }),
    ).toBeUndefined();
  });
  it.each(["1x", "2x", "3x"])(
    "O3-T24 production rejects published provider test-secret class %s",
    (prefix) => {
      expect(
        checkoutChallengeConfig({
          APP_ENV: "production",
          CHECKOUT_STOREFRONT_ORIGIN: "https://orders.providewebdesign.de",
          CHECKOUT_TURNSTILE_SECRET: prefix + "0".repeat(30),
        }),
      ).toBeUndefined();
    },
  );
});
