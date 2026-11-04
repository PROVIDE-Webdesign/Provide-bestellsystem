import { afterEach, describe, expect, it, vi } from "vitest";
import {
  stripeLiveProvider,
  stripeSandboxProvider,
  type LiveStripeConfig,
} from "./stripe-sandbox.js";

const config: LiveStripeConfig = {
  mode: "live",
  key: ["rk", "live", "fixture"].join("_"),
  account: "acct_platform",
  merchantAccount: "acct_restaurant",
  webhookSecret: "whsec_fixture",
  returnOrigin: "https://store.example",
};
const job = {
  id: "fa000000-0000-0000-0000-000000000001",
  session_id: null,
  captureMethod: "manual",
  amount: 2950,
  currency: "EUR",
  restaurant_slug: "restaurant-a",
  location_slug: "location-a",
} as const;
const checkout = {
  id: "cs_live_fixture",
  livemode: true,
  amount_total: job.amount,
  currency: "eur",
  mode: "payment",
  metadata: { provide_job: job.id },
  status: "open",
  payment_status: "unpaid",
  url: "https://checkout.stripe.com/c/pay/cs_live_fixture#example",
};
const intent = {
  id: "pi_fixture",
  livemode: true,
  capture_method: "manual",
  amount: job.amount,
  currency: "eur",
  metadata: checkout.metadata,
};
const response = (body: unknown) => Promise.resolve(Response.json(body));
type ProviderReply = (url: string, init: RequestInit) => Promise<Response>;

function mockProvider(reply: ProviderReply, status = "active") {
  const fetcher = vi.fn((url: string, init: RequestInit) => {
    if (url.endsWith("/account"))
      return response({ id: new Headers(init.headers).get("stripe-account") ?? config.account });
    if (url.includes("/v2/core/accounts/"))
      return response({
        id: config.merchantAccount,
        livemode: true,
        configuration: { merchant: { capabilities: { card_payments: { status } } } },
      });
    return reply(url, init);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

afterEach(() => vi.unstubAllGlobals());

describe("Stripe live transport with isolated HTTP mocks", () => {
  it("uses a restaurant-owned manual Checkout and stable request data on retries", async () => {
    const fetcher = mockProvider(() => response(checkout));
    await expect(stripeLiveProvider.session(config, job)).resolves.toMatchObject({
      id: checkout.id,
      paid: false,
      authorized: false,
    });
    await stripeLiveProvider.session(config, job);
    const posts = fetcher.mock.calls.filter(([, init]) => init.method === "POST");
    expect(posts).toHaveLength(2);
    const headers = new Headers(posts[0]?.[1].headers);
    expect(headers.get("stripe-account")).toBe(config.merchantAccount);
    expect(headers.get("idempotency-key")).toBe("provide-online-create:" + job.id);
    expect(posts[0]?.[1].body).toBe(posts[1]?.[1].body);
    const requestBody = posts[0]?.[1].body;
    if (typeof requestBody !== "string") throw new Error("Expected form-encoded Stripe request");
    const body = new URLSearchParams(requestBody);
    expect(body.get("payment_intent_data[capture_method]")).toBe("manual");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("2950");
    expect(body.has("payment_intent_data[application_fee_amount]")).toBe(false);
    expect(body.has("payment_intent_data[transfer_data][destination]")).toBe(false);
  });

  it("rejects mixed keys, platform payees and automatic live capture before sending requests", async () => {
    const fetcher = mockProvider(() => response(checkout));
    await expect(
      stripeLiveProvider.session({ ...config, key: "sk_test_fixture" }, job),
    ).rejects.toThrow("Stripe key mode mismatch");
    await expect(
      stripeLiveProvider.session({ ...config, merchantAccount: config.account }, job),
    ).rejects.toThrow("separate connected merchant");
    const automaticJob: Parameters<typeof stripeLiveProvider.session>[1] = { ...job };
    delete automaticJob.captureMethod;
    await expect(stripeLiveProvider.session(config, automaticJob)).rejects.toThrow(
      "manual capture",
    );
    await expect(stripeSandboxProvider.session({ ...config, mode: "test" }, job)).rejects.toThrow(
      "Stripe key mode mismatch",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("checks the live card capability before creating the Checkout", async () => {
    const fetcher = mockProvider(() => response(checkout), "restricted");
    await expect(stripeLiveProvider.session(config, job)).rejects.toThrow(
      "Merchant cannot accept live payments",
    );
    expect(fetcher.mock.calls.some(([, init]) => init.method === "POST")).toBe(false);
  });

  it.each([
    { livemode: false },
    { id: "cs_test_fixture" },
    { amount_total: 50 },
    { metadata: { provide_job: "other" } },
    { url: "https://example.test/c/pay/cs_live_fixture" },
    { url: "https://checkout.stripe.com/c/pay/cs_live_foreign" },
  ])("rejects mismatched live session data %j", async (change) => {
    mockProvider(() => response({ ...checkout, ...change }));
    await expect(stripeLiveProvider.session(config, job)).rejects.toThrow(/Invalid checkout/);
  });

  it("reads a completed session as authorized and captures it once on repeated requests", async () => {
    let captured = false;
    const fetcher = mockProvider((url, init) => {
      if (url.includes("/checkout/sessions/"))
        return response({
          ...checkout,
          status: "complete",
          payment_intent: intent.id,
          url: null,
        });
      if (url.endsWith("/capture")) captured = true;
      return response({
        ...intent,
        status: captured ? "succeeded" : "requires_capture",
        amount_received: captured ? job.amount : 0,
        amount_capturable: captured ? 0 : job.amount,
        ...(init.method === "POST" ? { id: intent.id } : {}),
      });
    });
    await expect(
      stripeLiveProvider.session(config, { ...job, session_id: checkout.id }),
    ).resolves.toMatchObject({ authorized: true, paid: false, intent: intent.id });
    const authorization = { id: job.id, intentId: intent.id, amount: job.amount };
    await stripeLiveProvider.settleAuthorization(config, authorization, "capture");
    await stripeLiveProvider.settleAuthorization(config, authorization, "capture");
    const posts = fetcher.mock.calls.filter(([, init]) => init.method === "POST");
    expect(posts).toHaveLength(1);
    expect(new Headers(posts[0]?.[1].headers).get("stripe-account")).toBe(config.merchantAccount);
    expect(new Headers(posts[0]?.[1].headers).get("idempotency-key")).toBe(
      "provide-online-capture:" + job.id,
    );
  });

  it("rejects a foreign intent before refunding and requires a live refund receipt", async () => {
    let foreign = true;
    let liveRefund = false;
    const fetcher = mockProvider((url) => {
      if (url.includes("/payment_intents/"))
        return response({
          ...intent,
          metadata: foreign ? { provide_job: "other" } : intent.metadata,
          status: "succeeded",
          amount_received: job.amount,
        });
      return response({
        id: "re_fixture",
        livemode: liveRefund,
        payment_intent: intent.id,
        amount: job.amount,
        currency: "eur",
        metadata: intent.metadata,
        status: "succeeded",
      });
    });
    const refund = () => stripeLiveProvider.refund(config, intent.id, job.id, null, job.amount, 0);
    await expect(refund()).rejects.toThrow("Invalid authorization intent");
    expect(fetcher.mock.calls.some(([, init]) => init.method === "POST")).toBe(false);
    foreign = false;
    await expect(refund()).rejects.toThrow("Invalid refund");
    liveRefund = true;
    await expect(refund()).resolves.toEqual({ id: "re_fixture", status: "succeeded" });
  });
});
