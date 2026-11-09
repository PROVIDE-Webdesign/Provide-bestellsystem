import { describe, it, expect, vi } from "vitest";
import {
  sandboxConfig,
  createPaymentToken,
  verifyPaymentToken,
  processOnlinePayment,
  handleStripeWebhook,
  handleOnlinePayment,
} from "./online-payments.js";
import { createStatusAccessToken } from "./status-token.js";
import {
  verifyStripeWebhook,
  CheckoutCreationRejected,
  type SandboxProvider,
} from "./stripe-sandbox.js";
import type { OnlineRepository, OnlineJob } from "./online-payments-database.js";
const scope = { restaurantSlug: "restaurant-a", locationSlug: "location-a" },
  id = "fa000000-0000-0000-0000-000000000001",
  secret = "synthetic-secret-at-least-thirty-two-bytes";
const config = {
  key: "sk_test_synthetic",
  account: "acct_synthetic",
  webhookSecret: "whsec_synthetic",
  returnOrigin: "https://store.example.test",
};
describe("online payment boundaries", () => {
  it("acknowledges a signed event only after storage and rejects modified raw bytes", async () => {
    const env = {
      APP_ENV: "test",
      ONLINE_PAYMENT_PROCESSING_ENABLED: "true",
      STRIPE_TEST_SECRET_KEY: config.key,
      STRIPE_TEST_ACCOUNT_ID: config.account,
      STRIPE_TEST_WEBHOOK_SECRET: config.webhookSecret,
      PAYMENT_ACCESS_SECRET: secret,
      PAYMENT_RETURN_ORIGIN: config.returnOrigin,
      HYPERDRIVE: { connectionString: "synthetic" },
      HYPERDRIVE_CACHE_DISABLED: "true",
    };
    const event = vi
      .fn()
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValue(undefined);
    const repo: OnlineRepository = {
      submit: vi.fn(),
      read: vi.fn(),
      resume: vi.fn(),
      claim: vi.fn(),
      bind: vi.fn(),
      reserveRefund: vi.fn().mockResolvedValue(true),
      sync: vi.fn(),
      fail: vi.fn(),
      rejectCreation: vi.fn(),
      event,
    };
    const raw = JSON.stringify({
      id: "evt_synthetic",
      livemode: false,
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: "cs_test_synthetic" } },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(config.webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bytes = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(timestamp + "." + raw),
    );
    const signature =
      "t=" +
      timestamp +
      ",v1=" +
      Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
    const send = (body: string) =>
      handleStripeWebhook(
        new Request("https://api.test/v1/payments/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": signature },
          body,
        }),
        env,
        repo,
        { requestId: id },
        { session: vi.fn(), expire: vi.fn(), refund: vi.fn() },
      );
    expect((await send(raw)).status).toBe(503);
    expect((await send(raw)).status).toBe(204);
    expect((await send("\uFEFF" + raw)).status).toBe(400);
    expect((await send(raw + " ")).status).toBe(400);
    expect((await send("x".repeat(256 * 1024 + 1))).status).toBe(413);
    expect(event).toHaveBeenCalledTimes(2);
    expect(event.mock.calls[1]?.slice(1, 5)).toEqual([
      "acct_synthetic",
      "evt_synthetic",
      "checkout.session.completed",
      "cs_test_synthetic",
    ]);
    expect(event.mock.calls[1]?.[6]).toBe(new Date(timestamp * 1000).toISOString());
    expect(JSON.stringify(event.mock.calls)).not.toContain(raw);
  });
  it("rejects live keys and production while accepting an explicit sandbox configuration", () => {
    const env = {
      APP_ENV: "test",
      ONLINE_PAYMENT_ENABLED: "true",
      ONLINE_PAYMENT_PROCESSING_ENABLED: "true",
      STRIPE_TEST_SECRET_KEY: config.key,
      STRIPE_TEST_ACCOUNT_ID: config.account,
      STRIPE_TEST_WEBHOOK_SECRET: config.webhookSecret,
      PAYMENT_ACCESS_SECRET: secret,
      PAYMENT_RETURN_ORIGIN: config.returnOrigin,
      HYPERDRIVE: { connectionString: "synthetic" },
      HYPERDRIVE_CACHE_DISABLED: "true",
    };
    expect(sandboxConfig(env)).toEqual(config);
    expect(
      sandboxConfig({ ...env, STRIPE_TEST_SECRET_KEY: "rk_test_synthetic_restricted" }),
    ).toEqual({ ...config, key: "rk_test_synthetic_restricted" });
    for (const change of [
      { APP_ENV: "production" },
      { STRIPE_TEST_SECRET_KEY: "sk_live_fake" },
      { STRIPE_TEST_SECRET_KEY: "rk_live_fake" },
      { ONLINE_PAYMENT_PROCESSING_ENABLED: "false" },
      { PAYMENT_RETURN_ORIGIN: "https://store.example.test/path" },
      { HYPERDRIVE_CACHE_DISABLED: "false" },
    ])
      expect(sandboxConfig({ ...env, ...change })).toBeUndefined();
    expect(sandboxConfig({ ...env, ONLINE_PAYMENT_ENABLED: "false" })).toEqual(config);
  });
  it("separates read and write capabilities and binds scope, order and expiry", async () => {
    const deadline = new Date(Date.now() + 300000).toISOString();
    const token = await createPaymentToken(secret, scope, id, deadline);
    expect(await verifyPaymentToken(secret, scope, id, deadline, token)).toBe(true);
    expect(
      await verifyPaymentToken(
        secret,
        { ...scope, locationSlug: "elsewhere" },
        id,
        deadline,
        token,
      ),
    ).toBe(false);
    expect(
      await verifyPaymentToken(secret, scope, id, new Date(Date.now() - 1).toISOString(), token),
    ).toBe(false);
    expect(
      await verifyPaymentToken(
        secret,
        scope,
        id,
        deadline,
        await createStatusAccessToken(secret, scope, id),
      ),
    ).toBe(false);
  });
  it("verifies the original webhook bytes, rejects stale timestamps and accepts rotation signatures", async () => {
    const raw = '{"id":"evt_synthetic","livemode":false}',
      timestamp = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bytes = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(timestamp + "." + raw),
    );
    const hex = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
    const header = `t=${timestamp},v1=${"0".repeat(64)},v1=${hex}`;
    expect(await verifyStripeWebhook(raw, header, secret)).toBe(true);
    expect(await verifyStripeWebhook(raw + " ", header, secret)).toBe(false);
    expect(await verifyStripeWebhook(raw, header, secret, Date.now() + 301000)).toBe(false);
    expect(await verifyStripeWebhook(raw, header + ",t=" + timestamp, secret)).toBe(false);
  });
  it("keeps an uncertain expiration open and never frees capacity on an HTTP failure", async () => {
    const job = {
      id,
      order_id: id,
      account_id: "acct_restaurantA",
      session_id: "cs_test_synthetic",
      created_at: new Date().toISOString(),
      deadline: new Date(Date.now() - 1000).toISOString(),
      amount: 2500,
      currency: "EUR",
      close_requested: null,
      refund_state: "none",
      refund_id: null,
      order_status: "submitted",
      refund_sequence: 0,
    } as OnlineJob;
    const sync = vi.fn();
    const refund = vi.fn();
    const repo: OnlineRepository = {
      submit: vi.fn(),
      read: vi.fn().mockResolvedValue(job),
      resume: vi.fn().mockResolvedValue(true),
      claim: vi.fn().mockResolvedValue(job),
      bind: vi.fn(),
      reserveRefund: vi.fn().mockResolvedValue(true),
      sync,
      fail: vi.fn(),
      rejectCreation: vi.fn(),
      event: vi.fn(),
    };
    const provider: SandboxProvider = {
      session: vi.fn().mockResolvedValue({
        id: job.session_id,
        status: "open",
        paid: false,
        intent: null,
        url: null,
      }),
      expire: vi.fn().mockRejectedValue(new Error("timeout")),
      refund,
    };
    await processOnlinePayment("synthetic", config, repo, provider);
    expect(sync.mock.calls[0]?.[3]).toBe("open");
    expect(refund.mock.calls).toHaveLength(0);
  });
});

describe("connected restaurant reconciliation", () => {
  const jobFor = (account: string, deadline = Date.now() + 300000): OnlineJob => ({
    id,
    order_id: id,
    account_id: account,
    session_id: "cs_test_connected",
    intent_id: null,
    refund_id: null,
    refund_state: "none",
    refund_sequence: 0,
    close_requested: null,
    provider_terminal: false,
    deadline: new Date(deadline).toISOString(),
    created_at: new Date().toISOString(),
    amount: 2500,
    currency: "EUR",
    payment_status: "pending_customer",
    order_status: "submitted",
    restaurant_slug: "restaurant-a",
    location_slug: "location-a",
    last_error: null,
  });
  const repository = (job: OnlineJob) => ({
    submit: vi.fn(),
    read: vi.fn().mockResolvedValue(job),
    resume: vi.fn(),
    claim: vi.fn().mockResolvedValue(job),
    bind: vi.fn(),
    reserveRefund: vi.fn().mockResolvedValue(true),
    sync: vi.fn(),
    fail: vi.fn(),
    rejectCreation: vi.fn(),
    event: vi.fn(),
  });
  it.each(
    ["acct_restaurantA", "acct_restaurantB"].flatMap((account) =>
      (["wait", "accept", "reject", "expire"] as const).map(
        (decision) => [account, decision] as const,
      ),
    ),
  )("reconciles manual payment for %s after %s", async (account, decision) => {
    const now = Date.now();
    const job: OnlineJob = {
      ...jobFor(account),
      capture_method: "manual",
      acceptance_deadline: new Date(now + (decision === "expire" ? -1000 : 60000)).toISOString(),
      capture_requested_at: decision === "accept" ? new Date(now - 1000).toISOString() : null,
      close_requested: decision === "reject" ? "rejected" : null,
    };
    const repo = repository(job);
    const held = {
      id: job.session_id,
      status: "complete",
      paid: false,
      authorized: true,
      intent: "pi_connected",
      url: null,
    };
    const provider = {
      session: vi
        .fn()
        .mockResolvedValueOnce(held)
        .mockResolvedValue({
          ...held,
          authorized: false,
          paid: decision === "accept",
          authorizationReleased: decision !== "accept",
        }),
      expire: vi.fn(),
      refund: vi.fn(),
      settleAuthorization: vi.fn(),
    };
    await processOnlinePayment("synthetic", config, repo, provider, id);
    if (decision === "wait") expect(provider.settleAuthorization).not.toHaveBeenCalled();
    else {
      expect(provider.settleAuthorization).toHaveBeenCalledExactlyOnceWith(
        { ...config, merchantAccount: account },
        { id, intentId: "pi_connected", amount: 2500 },
        decision === "accept" ? "capture" : "cancel",
      );
    }
    expect(repo.sync).toHaveBeenCalledExactlyOnceWith(
      "synthetic",
      id,
      expect.any(String),
      decision === "wait" ? "authorized" : decision === "accept" ? "paid" : "expired",
      "pi_connected",
      null,
      expect.any(String),
    );
    expect(repo.fail).not.toHaveBeenCalled();
    expect(provider.refund).not.toHaveBeenCalled();
  });
  it.each(["acct_restaurantA", "acct_restaurantB"])(
    "refunds using the job's immutable payee %s",
    async (account) => {
      const job = { ...jobFor(account), close_requested: "cancelled", order_status: "cancelled" };
      const repo = repository(job);
      const provider = {
        session: vi.fn().mockResolvedValue({
          id: job.session_id,
          status: "complete",
          paid: true,
          intent: "pi_connected",
          url: null,
        }),
        expire: vi.fn(),
        refund: vi.fn().mockResolvedValue({ id: "re_connected", status: "succeeded" }),
      };
      await processOnlinePayment("synthetic", config, repo, provider, id);
      expect(provider.session).toHaveBeenCalledWith({ ...config, merchantAccount: account }, job);
      expect(provider.refund).toHaveBeenCalledWith(
        { ...config, merchantAccount: account },
        "pi_connected",
        id,
        null,
        2500,
        0,
      );
      expect(repo.sync).toHaveBeenCalledWith(
        "synthetic",
        id,
        expect.any(String),
        "refunded",
        "pi_connected",
        "re_connected",
        expect.any(String),
      );
      expect(repo.fail).not.toHaveBeenCalled();
    },
  );
  it("leaves a restaurant cancellation of an accepted payment to the till", async () => {
    const job: OnlineJob = { ...jobFor("acct_restaurantA"), payment_status: "captured" };
    const repo = repository(job);
    repo.read.mockResolvedValue({
      ...job,
      order_status: "cancelled",
      close_requested: "cancelled",
      refund_at_till: true,
    });
    const provider = {
      session: vi.fn().mockResolvedValue({
        id: job.session_id,
        status: "complete",
        paid: true,
        intent: "pi_connected",
        url: null,
      }),
      expire: vi.fn(),
      refund: vi.fn(),
    };
    await processOnlinePayment("synthetic", config, repo, provider, id);
    expect(repo.reserveRefund).not.toHaveBeenCalled();
    expect(provider.refund).not.toHaveBeenCalled();
    expect(repo.sync).toHaveBeenCalledWith(
      "synthetic",
      id,
      expect.any(String),
      "paid",
      "pi_connected",
      null,
      expect.any(String),
    );
  });

  it("stops a new refund when an earlier uncertain attempt is outside the replay window", async () => {
    const job: OnlineJob = {
      ...jobFor("acct_restaurantA"),
      close_requested: "cancelled",
      order_status: "cancelled",
      refund_sequence: 2,
    };
    const repo = repository(job);
    repo.reserveRefund.mockResolvedValue(false);
    const provider = {
      session: vi.fn().mockResolvedValue({
        id: job.session_id,
        status: "complete",
        paid: true,
        intent: "pi_connected",
        url: null,
      }),
      expire: vi.fn(),
      refund: vi.fn(),
    };
    await processOnlinePayment("synthetic", config, repo, provider, id);
    expect(repo.reserveRefund).toHaveBeenCalledWith("synthetic", id, expect.any(String), 2);
    expect(provider.refund).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledWith("synthetic", id, expect.any(String), true);
    expect(repo.sync).not.toHaveBeenCalled();

    const known = repository({ ...job, refund_id: "re_previous" });
    provider.refund.mockResolvedValue({ id: "re_previous", status: "succeeded" });
    await processOnlinePayment("synthetic", config, known, provider, id);
    expect(known.reserveRefund).not.toHaveBeenCalled();
    expect(provider.refund).toHaveBeenCalledWith(
      { ...config, merchantAccount: job.account_id },
      "pi_connected",
      id,
      "re_previous",
      2500,
      2,
    );
  });

  it.each([null, "rejected"])("finishes a conclusive creation rejection (%s)", async (close) => {
    const job = {
      ...jobFor("acct_restaurantA"),
      session_id: null,
      payment_status: "created",
      close_requested: close,
    };
    const repo = repository(job);
    const provider = {
      session: vi
        .fn()
        .mockRejectedValue(new CheckoutCreationRejected("req_synthetic", "a".repeat(64))),
      expire: vi.fn(),
      refund: vi.fn(),
    };
    await processOnlinePayment("synthetic", config, repo, provider);
    expect(repo.rejectCreation).toHaveBeenCalledExactlyOnceWith(
      "synthetic",
      job.id,
      expect.any(String),
      "req_synthetic",
      "a".repeat(64),
      "test",
    );
    expect(repo.fail).not.toHaveBeenCalled();
    expect(provider.refund).not.toHaveBeenCalled();
  });
  it.each(["timeout", "server_error", "idempotency_conflict"])(
    "retains uncertain creation after %s",
    async (message) => {
      const job = { ...jobFor("acct_restaurantA"), session_id: null, payment_status: "created" };
      const repo = repository(job);
      await processOnlinePayment("synthetic", config, repo, {
        session: vi.fn().mockRejectedValue(new Error(message)),
        expire: vi.fn(),
        refund: vi.fn(),
      });
      expect(repo.rejectCreation).not.toHaveBeenCalled();
      expect(repo.fail).toHaveBeenCalledWith("synthetic", job.id, expect.any(String), false);
    },
  );
  it("retains a changed database state when rejection closure fails", async () => {
    const job = { ...jobFor("acct_restaurantA"), session_id: null, payment_status: "created" };
    const repo = repository(job);
    repo.rejectCreation.mockRejectedValue(new Error("state changed"));
    await processOnlinePayment("synthetic", config, repo, {
      session: vi
        .fn()
        .mockRejectedValue(new CheckoutCreationRejected("req_synthetic", "a".repeat(64))),
      expire: vi.fn(),
      refund: vi.fn(),
    });
    expect(repo.fail).toHaveBeenCalledWith("synthetic", job.id, expect.any(String), false);
  });
  it("never closes an existing checkout from a creation rejection", async () => {
    const job = jobFor("acct_restaurantA"),
      repo = repository(job);
    await processOnlinePayment("synthetic", config, repo, {
      session: vi
        .fn()
        .mockRejectedValue(new CheckoutCreationRejected("req_synthetic", "a".repeat(64))),
      expire: vi.fn(),
      refund: vi.fn(),
    });
    expect(repo.rejectCreation).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalled();
  });
  it("releases a completed but unpaid asynchronous reservation at the local deadline", async () => {
    const job = jobFor("acct_restaurantA", Date.now() - 1000),
      repo = repository(job);
    const provider = {
      session: vi.fn().mockResolvedValue({
        id: job.session_id,
        status: "complete",
        paid: false,
        intent: null,
        url: null,
      }),
      expire: vi.fn(),
      refund: vi.fn(),
    };
    await processOnlinePayment("synthetic", config, repo, provider);
    expect(repo.sync).toHaveBeenCalledWith(
      "synthetic",
      id,
      expect.any(String),
      "expired",
      null,
      null,
      expect.any(String),
    );
    expect(provider.expire).not.toHaveBeenCalled();
    expect(provider.refund).not.toHaveBeenCalled();
  });
  it.each([
    ["checkout.session.completed", "unpaid", false],
    ["checkout.session.completed", "paid", true],
    ["checkout.session.async_payment_succeeded", "paid", true],
    ["checkout.session.async_payment_failed", "unpaid", false],
  ])(
    "records account and actual payment evidence for %s (%s)",
    async (type, paymentStatus, succeeded) => {
      const env = {
        APP_ENV: "test",
        ONLINE_PAYMENT_PROCESSING_ENABLED: "true",
        STRIPE_TEST_SECRET_KEY: config.key,
        STRIPE_TEST_ACCOUNT_ID: config.account,
        STRIPE_TEST_WEBHOOK_SECRET: config.webhookSecret,
        PAYMENT_ACCESS_SECRET: secret,
        PAYMENT_RETURN_ORIGIN: config.returnOrigin,
        HYPERDRIVE: { connectionString: "synthetic" },
        HYPERDRIVE_CACHE_DISABLED: "true",
      };
      const repo = repository(jobFor("acct_restaurantA"));
      const timestamp = Math.floor(Date.now() / 1000);
      const raw = JSON.stringify({
        id: "evt_connected",
        livemode: false,
        account: "acct_restaurantA",
        type,
        created: timestamp,
        data: { object: { id: "cs_test_connected", payment_status: paymentStatus } },
      });
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(config.webhookSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signed = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(timestamp + "." + raw),
      );
      const signature = Array.from(new Uint8Array(signed), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const response = await handleStripeWebhook(
        new Request("https://api.test/v1/payments/stripe/webhook", {
          method: "POST",
          body: raw,
          headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
        }),
        env,
        repo,
        { requestId: id },
        { session: vi.fn(), expire: vi.fn(), refund: vi.fn() },
      );
      expect(response.status).toBe(204);
      expect(repo.event).toHaveBeenCalledWith(
        "synthetic",
        config.account,
        "evt_connected",
        type,
        "cs_test_connected",
        expect.any(String),
        new Date(timestamp * 1000).toISOString(),
        "acct_restaurantA",
        succeeded,
        "test",
      );
    },
  );
  it("shows checking when completed Checkout is still unpaid", async () => {
    const job = jobFor("acct_restaurantA"),
      repo = repository(job);
    repo.claim.mockResolvedValue(null);
    repo.resume.mockResolvedValue(true);
    const env = {
      APP_ENV: "test",
      ONLINE_PAYMENT_PROCESSING_ENABLED: "true",
      STRIPE_TEST_SECRET_KEY: config.key,
      STRIPE_TEST_ACCOUNT_ID: config.account,
      STRIPE_TEST_WEBHOOK_SECRET: config.webhookSecret,
      PAYMENT_ACCESS_SECRET: secret,
      PAYMENT_RETURN_ORIGIN: config.returnOrigin,
      HYPERDRIVE: { connectionString: "synthetic" },
      HYPERDRIVE_CACHE_DISABLED: "true",
    };
    const provider = {
      session: vi.fn().mockResolvedValue({
        id: job.session_id,
        status: "complete",
        paid: false,
        intent: null,
        url: null,
      }),
      expire: vi.fn(),
      refund: vi.fn(),
    };
    const response = await handleOnlinePayment(
      new Request("https://api.test/v1/storefront/restaurant-a/location-a/payment-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: id,
          paymentDeadline: job.deadline,
          paymentAccessToken: await createPaymentToken(secret, scope, id, job.deadline),
        }),
      }),
      scope,
      false,
      env,
      repo,
      provider,
      { requestId: id },
      new Headers(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { checkoutUrl: null, paymentState: "checking" },
    });
  });
});
