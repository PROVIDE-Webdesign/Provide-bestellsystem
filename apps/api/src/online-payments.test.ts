import { describe, it, expect, vi } from "vitest";
import {
  sandboxConfig,
  createPaymentToken,
  verifyPaymentToken,
  processOnlinePayment,
} from "./online-payments.js";
import { createStatusAccessToken } from "./status-token.js";
import { verifyStripeWebhook, type SandboxProvider } from "./stripe-sandbox.js";
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
    for (const change of [
      { APP_ENV: "production" },
      { STRIPE_TEST_SECRET_KEY: "sk_live_fake" },
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
      sync,
      fail: vi.fn(),
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
