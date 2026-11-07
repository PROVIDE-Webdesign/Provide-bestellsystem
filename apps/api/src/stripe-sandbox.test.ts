import { afterEach, describe, expect, it, vi } from "vitest";
import { stripeSandboxProvider, CheckoutCreationRejected } from "./stripe-sandbox.js";
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
const ready = (id = config.account) => ({
  id,
  livemode: false,
  configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } },
});
const response = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
afterEach(() => vi.unstubAllGlobals());
describe("Stripe sandbox HTTP adapter", () => {
  it.each(["acct_restaurantA", "acct_restaurantB"])(
    "keeps all provider operations on %s",
    async (merchantAccount) => {
      const calls: { url: string; init: RequestInit }[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init: RequestInit) => {
          calls.push({ url, init });
          if (url.includes("/v2/core/accounts/"))
            return Promise.resolve(response(ready(merchantAccount)));
          return Promise.resolve(
            response(
              url.endsWith("/account")
                ? { id: new Headers(init.headers).get("stripe-account") ?? config.account }
                : url.includes("/refunds")
                  ? {
                      id: "re_connected",
                      livemode: false,
                      payment_intent: "pi_connected",
                      amount: 2950,
                      currency: "eur",
                      metadata: session.metadata,
                      status: "succeeded",
                    }
                  : session,
            ),
          );
        }),
      );
      const connected = { ...config, merchantAccount };
      await stripeSandboxProvider.session(connected, job);
      await stripeSandboxProvider.session(connected, { ...job, session_id: session.id });
      await stripeSandboxProvider.expire(connected, session.id);
      await stripeSandboxProvider.refund(connected, "pi_connected", job.id, null, 2950, 0);
      await stripeSandboxProvider.refund(
        connected,
        "pi_connected",
        job.id,
        "re_connected",
        2950,
        0,
      );
      expect(calls.length).toBeGreaterThan(5);
      for (const { url, init } of calls) {
        const headers = new Headers(init.headers);
        if (url.includes("/v2/core/accounts/")) expect(headers.get("stripe-account")).toBeNull();
        else if (!url.endsWith("/account"))
          expect(headers.get("stripe-account")).toBe(merchantAccount);
        else expect([null, merchantAccount]).toContain(headers.get("stripe-account"));
        expect(headers.get("stripe-version")).toBe("2026-09-30.endive");
        expect(headers.get("authorization")).toBe("Bearer " + config.key);
      }
    },
  );
  it.each(["pending", "restricted", "inactive"])(
    "rejects new payment when v2 capability is %s",
    async (status) => {
      const calls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          calls.push(url);
          return Promise.resolve(
            response(
              url.endsWith("/account")
                ? { id: config.account, charges_enabled: true }
                : {
                    ...ready(),
                    configuration: { merchant: { capabilities: { card_payments: { status } } } },
                  },
            ),
          );
        }),
      );
      await expect(stripeSandboxProvider.session(config, job)).rejects.toThrow(
        "Merchant cannot accept test payments",
      );
      expect(calls.some((url) => url.includes("/checkout/sessions"))).toBe(false);
    },
  );
  it("keeps an existing payment readable without a new-payment capability check", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        calls.push(url);
        return Promise.resolve(
          response(url.endsWith("/account") ? { id: config.account } : session),
        );
      }),
    );
    await expect(
      stripeSandboxProvider.session(config, { ...job, session_id: session.id }),
    ).resolves.toMatchObject({ paid: false });
    expect(calls.some((url) => url.includes("/v2/"))).toBe(false);
  });
  it("rejects a foreign platform key before touching a connected merchant", async () => {
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(response({ id: "acct_wrongplatform" })),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      stripeSandboxProvider.session({ ...config, merchantAccount: "acct_restaurantA" }, job),
    ).rejects.toThrow("Account mismatch");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("stripe-account")).toBeNull();
  });
  it.each([undefined, "manual"] as const)(
    "uses the exact stored total and identical creation parameters after a lost response (%s)",
    async (captureMethod) => {
      const retryJob = { ...job, ...(captureMethod ? { captureMethod } : {}) };
      const calls: RequestInit[] = [];
      let lose = true;
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init: RequestInit) => {
          if (url.endsWith("/account")) return Promise.resolve(response({ id: config.account }));
          if (url.includes("/v2/core/accounts/")) return Promise.resolve(response(ready()));
          calls.push(init);
          if (lose) {
            lose = false;
            return Promise.reject(new Error("response lost"));
          }
          return Promise.resolve(response(session));
        }),
      );
      await expect(stripeSandboxProvider.session(config, retryJob)).rejects.toThrow();
      await expect(stripeSandboxProvider.session(config, retryJob)).resolves.toMatchObject({
        paid: false,
      });
      expect(calls[0]?.body).toBe(calls[1]?.body);
      const body = calls[1]?.body;
      if (typeof body !== "string") throw new Error("Missing encoded request body");
      const payload = new URLSearchParams(body);
      expect(payload.get("line_items[0][price_data][unit_amount]")).toBe("2950");
      expect(payload.has("payment_method_types[0]")).toBe(false);
      expect(payload.get("payment_intent_data[capture_method]")).toBe(captureMethod ?? null);
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
    },
  );
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
            response(
              url.endsWith("/account")
                ? { id: config.account }
                : url.includes("/v2/core/accounts/")
                  ? ready()
                  : { ...session, ...change },
            ),
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
              : url.includes("/v2/core/accounts/")
                ? ready()
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
        if (url.includes("/v2/core/accounts/")) return Promise.resolve(response(ready()));
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

describe("checkout creation error certainty", () => {
  it.each([
    [400, "invalid_request_error", "parameter_unknown", "false", "req_validation", true],
    [400, "invalid_request_error", undefined, "false", "req_validation", true],
    [400, "idempotency_error", undefined, "false", "req_validation", false],
    [400, "invalid_request_error", "lock_timeout", "false", "req_validation", false],
    [400, "invalid_request_error", "rate_limit", "false", "req_validation", false],
    [409, "invalid_request_error", "idempotency_key_in_use", "true", "req_validation", false],
    [429, "rate_limit_error", undefined, "true", "req_validation", false],
    [500, "api_error", undefined, "false", "req_validation", false],
    [400, "invalid_request_error", undefined, undefined, "req_validation", true],
    [400, "invalid_request_error", "parameter_unknown", undefined, "req_validation", true],
    [400, "invalid_request_error", "unknown_error", undefined, "req_validation", false],
    [400, "invalid_request_error", "parameter_unknown", "true", "req_validation", false],
    [400, "invalid_request_error", "parameter_unknown", "unexpected", "req_validation", false],
    [400, "invalid_request_error", undefined, "false", undefined, false],
  ] as const)(
    "classifies only conclusive parameter rejection (%s/%s/%s)",
    async (status, type, code, retry, requestId, definitive) => {
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (url.endsWith("/account")) return Promise.resolve(response({ id: config.account }));
          if (url.includes("/v2/")) return Promise.resolve(response(ready()));
          const headers = new Headers();
          if (retry) headers.set("stripe-should-retry", retry);
          if (requestId) headers.set("request-id", requestId);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  type,
                  code,
                  param: "payment_method_types",
                  message: "Do not expose raw provider text",
                },
              }),
              { status, headers },
            ),
          );
        }),
      );
      let failure: unknown;
      try {
        await stripeSandboxProvider.session(config, job);
      } catch (error) {
        failure = error;
      }
      expect(failure instanceof CheckoutCreationRejected).toBe(definitive);
      expect(String(failure)).not.toContain("Do not expose");
    },
  );
  it("does not classify a preflight rejection as failed creation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { type: "invalid_request_error", param: "payment_method_types" },
            }),
            {
              status: 400,
              headers: { "request-id": "req_preflight", "stripe-should-retry": "false" },
            },
          ),
        ),
      ),
    );
    await expect(stripeSandboxProvider.session(config, job)).rejects.not.toBeInstanceOf(
      CheckoutCreationRejected,
    );
  });
  it("retains malformed 400 replies as uncertain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith("/account")
            ? response({ id: config.account })
            : url.includes("/v2/")
              ? response(ready())
              : new Response("invalid JSON", {
                  status: 400,
                  headers: { "request-id": "req_invalid", "stripe-should-retry": "false" },
                }),
        ),
      ),
    );
    await expect(stripeSandboxProvider.session(config, job)).rejects.not.toBeInstanceOf(
      CheckoutCreationRejected,
    );
  });
});
