import { afterEach, describe, expect, it, vi } from "vitest";
import { stripeSandboxProvider } from "./stripe-sandbox.js";
const config = {
  key: "sk_test_synthetic",
  account: "acct_synthetic",
  webhookSecret: "whsec_synthetic",
  returnOrigin: "https://store.example.test",
};
const job = {
  id: "fa000000-0000-0000-0000-000000000001",
  session_id: null,
  amount: 2950,
  currency: "EUR",
  restaurant_slug: "restaurant-a",
  location_slug: "location-a",
};
const session = {
  id: "cs_test_synthetic",
  livemode: false,
  amount_total: 2950,
  currency: "eur",
  mode: "payment",
  metadata: { provide_job: job.id },
  status: "open",
  payment_status: "unpaid",
  url: "https://checkout.stripe.com/c/pay/cs_test_synthetic",
};
const response = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
afterEach(() => vi.unstubAllGlobals());
describe("Stripe sandbox HTTP adapter", () => {
  it("uses the exact stored total and identical creation parameters after a lost response", async () => {
    const calls: RequestInit[] = [];
    let lose = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        if (url.endsWith("/account")) return Promise.resolve(response({ id: config.account }));
        calls.push(init);
        if (lose) {
          lose = false;
          return Promise.reject(new Error("response lost"));
        }
        return Promise.resolve(response(session));
      }),
    );
    await expect(stripeSandboxProvider.session(config, job)).rejects.toThrow();
    await expect(stripeSandboxProvider.session(config, job)).resolves.toMatchObject({
      paid: false,
    });
    expect(calls[0]?.body).toBe(calls[1]?.body);
    const body = calls[1]?.body;
    if (typeof body !== "string") throw new Error("Missing encoded request body");
    const payload = new URLSearchParams(body);
    expect(payload.get("line_items[0][price_data][unit_amount]")).toBe("2950");
    expect(payload.has("payment_method_types[0]")).toBe(false);
    expect(payload.get("integration_identifier")).toMatch(/^provide_ab39_[a-p]{8}$/);
    expect(payload.get("payment_intent_data[metadata][provide_job]")).toBe(job.id);
    expect(payload.has("customer_email")).toBe(false);
    expect(payload.get("success_url")).toBe(config.returnOrigin + "/r/restaurant-a/location-a");
    expect(new Headers(calls[0]?.headers).get("idempotency-key")).toBe(
      "provide-online-create:" + job.id,
    );
    expect(new Headers(calls[1]?.headers).get("idempotency-key")).toBe(
      "provide-online-create:" + job.id,
    );
  });
  it("rejects live, foreign-account, wrong-amount and foreign-job responses", async () => {
    for (const change of [
      { livemode: true },
      { amount_total: 2500 },
      { metadata: { provide_job: "other" } },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          Promise.resolve(
            response(url.endsWith("/account") ? { id: config.account } : { ...session, ...change }),
          ),
        ),
      );
      await expect(stripeSandboxProvider.session(config, job)).rejects.toThrow();
    }
    const fetcher = vi.fn(() => Promise.resolve(response({ id: "acct_foreign" })));
    vi.stubGlobal("fetch", fetcher);
    await expect(stripeSandboxProvider.session(config, job)).rejects.toThrow("Account mismatch");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requires a matching successful PaymentIntent before reporting paid", async () => {
    let received = 2500;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          response(
            url.endsWith("/account")
              ? { id: config.account }
              : url.includes("/payment_intents/")
                ? {
                    livemode: false,
                    status: "succeeded",
                    amount_received: received,
                    currency: "eur",
                    metadata: session.metadata,
                  }
                : {
                    ...session,
                    status: "complete",
                    payment_status: "paid",
                    payment_intent: "pi_synthetic",
                  },
          ),
        ),
      ),
    );
    await expect(stripeSandboxProvider.session(config, job)).rejects.toThrow("Invalid capture");
    received = 2950;
    await expect(stripeSandboxProvider.session(config, job)).resolves.toMatchObject({
      paid: true,
      intent: "pi_synthetic",
    });
  });
  it("uses one refund key per audited retry and treats requires_action as pending", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        if (url.endsWith("/account")) return Promise.resolve(response({ id: config.account }));
        calls.push(init);
        return Promise.resolve(
          response({
            id: "re_synthetic",
            payment_intent: "pi_synthetic",
            amount: 2950,
            currency: "eur",
            metadata: session.metadata,
            status: "requires_action",
          }),
        );
      }),
    );
    for (const sequence of [0, 0, 1]) {
      await expect(
        stripeSandboxProvider.refund(config, "pi_synthetic", job.id, null, 2950, sequence),
      ).resolves.toMatchObject({ status: "pending" });
    }
    expect(calls.map((c) => new Headers(c.headers).get("idempotency-key"))).toEqual(
      [0, 0, 1].map((n) => "provide-online-refund:" + job.id + ":" + n),
    );
    await stripeSandboxProvider.refund(config, "pi_synthetic", job.id, "re_synthetic", 2950, 1);
    expect(calls[3]?.method).toBe("GET");
  });
});
