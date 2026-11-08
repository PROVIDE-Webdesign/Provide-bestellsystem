import { object } from "@provide/contracts";
export interface SandboxConfig {
  mode?: "test";
  key: string;
  account: string;
  merchantAccount?: string;
  webhookSecret: string;
  returnOrigin: string;
}
export type LiveStripeConfig = Omit<SandboxConfig, "mode" | "merchantAccount"> & {
  mode: "live";
  merchantAccount: string;
};

export type StripeConfig = SandboxConfig | LiveStripeConfig;
type RequestConfig = Omit<SandboxConfig, "mode">;

export interface ProviderSession {
  id: string;
  status: "open" | "complete" | "expired";
  paid: boolean;
  authorized?: boolean;
  authorizationReleased?: boolean;
  intent: string | null;
  url: string | null;
}
export interface ProviderRefund {
  id: string;
  status: "pending" | "succeeded" | "failed";
}
export interface SandboxProvider<Config extends StripeConfig = SandboxConfig> {
  settleAuthorization?(
    config: Config,
    job: AuthorizationJob,
    action: "capture" | "cancel",
  ): Promise<void>;
  session(
    config: Config,
    job: {
      id: string;
      session_id: string | null;
      captureMethod?: "manual";
      amount: number;
      currency: string;
      restaurant_slug: string;
      location_slug: string;
    },
  ): Promise<ProviderSession>;
  expire(config: Config, id: string): Promise<void>;
  refund(
    config: Config,
    intent: string,
    jobId: string,
    refundId: string | null,
    amount: number,
    sequence: number,
  ): Promise<ProviderRefund>;
}
export class CheckoutCreationRejected extends Error {
  constructor(
    readonly requestId: string,
    readonly payloadSha256: string,
  ) {
    super("Checkout creation was definitively rejected");
    this.name = "CheckoutCreationRejected";
  }
}
const api = "https://api.stripe.com/v1";
async function request(
  c: RequestConfig,
  path: string,
  body?: URLSearchParams,
  idempotency?: string,
) {
  const response = await fetch((path.startsWith("/v2/") ? "https://api.stripe.com" : api) + path, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${c.key}`,
      "stripe-version": "2026-09-30.endive",
      ...(c.merchantAccount ? { "stripe-account": c.merchantAccount } : {}),
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotency ? { "idempotency-key": idempotency } : {}),
    },
    body: body?.toString() ?? null,
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  if (text.length > 256 * 1024) throw new Error("Provider response too large");
  if (!response.ok) {
    // Only conclusive parameter rejection on creation may close an unbound job.
    // Timeouts, 5xx, conflicts, preflight errors and unknown replies remain uncertain.
    let error: Record<string, unknown> | undefined;
    try {
      error = object(object(JSON.parse(text))?.error);
    } catch {
      /* untrusted reply */
    }
    const requestId = response.headers.get("request-id");
    const invalidParameter =
      (error?.code === undefined && error?.param === "payment_method_types") ||
      [
        "parameter_unknown",
        "parameter_missing",
        "parameter_invalid_empty",
        "parameter_invalid_integer",
        "parameter_invalid_string_blank",
      ].includes(String(error?.code));
    if (
      path === "/checkout/sessions" &&
      body &&
      idempotency?.startsWith("provide-online-create:") &&
      response.status === 400 &&
      [null, "false"].includes(response.headers.get("stripe-should-retry")) &&
      requestId &&
      /^req_[A-Za-z0-9]+$/.test(requestId) &&
      error?.type === "invalid_request_error" &&
      invalidParameter &&
      error.code !== "idempotency_key_in_use" &&
      error.code !== "idempotency_error" &&
      error.param !== "idempotency_key" &&
      !error.payment_intent
    )
      throw new CheckoutCreationRejected(requestId, await digest(text));
    throw new Error("Provider unavailable");
  }
  const result = object(JSON.parse(text));
  if (!result) throw new Error("Invalid provider response");
  return result;
}
async function verifyAccount(c: RequestConfig) {
  const platform: RequestConfig = {
    key: c.key,
    account: c.account,
    webhookSecret: c.webhookSecret,
    returnOrigin: c.returnOrigin,
  };
  const a = await request(platform, "/account");
  if (a.id !== c.account) throw new Error("Account mismatch");
  if (c.merchantAccount) {
    const merchant = await request(c, "/account");
    if (merchant.id !== c.merchantAccount) throw new Error("Account mismatch");
  }
  return platform;
}
interface AuthorizationJob {
  id: string;
  intentId: string;
  amount: number;
}

function assertAuthorizationIntent(
  intent: Record<string, unknown>,
  job: AuthorizationJob,
  live: boolean,
) {
  if (
    intent.id !== job.intentId ||
    intent.livemode !== live ||
    intent.capture_method !== "manual" ||
    intent.amount !== job.amount ||
    intent.currency !== "eur" ||
    object(intent.metadata)?.provide_job !== job.id
  )
    throw new Error("Invalid authorization intent");
}

function createStripeProvider<Config extends StripeConfig>(
  mode: "test" | "live",
): Required<SandboxProvider<Config>> {
  const live = mode === "live";
  const sessionId = live ? /^cs_live_[A-Za-z0-9]+$/ : /^cs_test_[A-Za-z0-9]+$/;
  function assertConfig(config: Config) {
    if ((config.mode ?? "test") !== mode) throw new Error("Stripe mode mismatch");
    const keyFormat = live ? /^rk_live_[A-Za-z0-9_]+$/ : /^(?:sk|rk)_test_[A-Za-z0-9_]+$/;
    if (!keyFormat.test(config.key)) throw new Error("Stripe key mode mismatch");
    if (live) {
      if (
        !/^acct_[A-Za-z0-9]+$/.test(config.account) ||
        !/^acct_[A-Za-z0-9]+$/.test(config.merchantAccount ?? "") ||
        config.merchantAccount === config.account
      )
        throw new Error("Live payments require a separate connected merchant");
      const origin = new URL(config.returnOrigin);
      if (origin.protocol !== "https:" || origin.origin !== config.returnOrigin)
        throw new Error("Invalid live return origin");
    }
  }
  return {
    async settleAuthorization(config, job, action) {
      assertConfig(config);
      await verifyAccount(config);
      if (!/^pi_[A-Za-z0-9]+$/.test(job.intentId)) throw new Error("Invalid intent ID");
      const path = "/payment_intents/" + encodeURIComponent(job.intentId);
      const before = await request(config, path);
      assertAuthorizationIntent(before, job, live);
      const expected = action === "capture" ? "succeeded" : "canceled";
      let result = before;
      if (before.status !== expected) {
        if (before.status !== "requires_capture" || before.amount_capturable !== job.amount)
          throw new Error("Authorization no longer available");
        const body = new URLSearchParams();
        if (action === "capture") body.set("amount_to_capture", String(job.amount));
        result = await request(
          config,
          path + "/" + action,
          body,
          "provide-online-" + action + ":" + job.id,
        );
      }
      assertAuthorizationIntent(result, job, live);
      if (
        result.status !== expected ||
        result.amount_received !== (action === "capture" ? job.amount : 0)
      )
        throw new Error("Unexpected authorization outcome");
    },
    async session(c, j) {
      assertConfig(c);
      if (live && j.captureMethod !== "manual")
        throw new Error("Live checkout requires manual capture");
      if (j.session_id && !sessionId.test(j.session_id))
        throw new Error("Invalid checkout session ID");
      const platform = await verifyAccount(c);
      if (!j.session_id) {
        // Read v2 capability before creating a payment. Existing sessions and refunds must
        // remain reconcilable after a merchant loses the ability to accept new payments.
        const merchant = c.merchantAccount ?? c.account;
        const a = await request(
          platform,
          "/v2/core/accounts/" +
            encodeURIComponent(merchant) +
            "?include[0]=configuration.merchant",
        );
        const configuration = object(a.configuration);
        const capabilities = object(object(configuration?.merchant)?.capabilities);
        if (
          a.id !== merchant ||
          a.livemode !== live ||
          object(capabilities?.card_payments)?.status !== "active"
        )
          throw new Error(
            live ? "Merchant cannot accept live payments" : "Merchant cannot accept test payments",
          );
      }
      // Derive a stable eight-letter suffix from the random job UUID so retries keep identical
      // Checkout parameters while each integration identifier remains unique to this payment job.
      const integrationSuffix = j.id
        .replaceAll("-", "")
        .slice(0, 8)
        .replace(/[0-9a-f]/g, (value) => String.fromCharCode(97 + Number.parseInt(value, 16)));
      const body = new URLSearchParams({
        mode: "payment",
        integration_identifier: `provide_${live ? "live" : "ab39"}_${integrationSuffix}`,
        locale: "de",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(j.amount),
        "line_items[0][price_data][product_data][name]": live
          ? "Bestellung"
          : "PROVIDE Testbestellung",
        "line_items[0][quantity]": "1",
        "metadata[provide_job]": j.id,
        "payment_intent_data[metadata][provide_job]": j.id,
        success_url: `${c.returnOrigin}/r/${j.restaurant_slug}/${j.location_slug}`,
        cancel_url: `${c.returnOrigin}/r/${j.restaurant_slug}/${j.location_slug}`,
      });
      if (j.captureMethod === "manual") {
        // Stripe filters out methods that cannot reserve funds for manual capture.
        body.set("payment_intent_data[capture_method]", "manual");
      }
      // Do not include a relative expiry in the idempotent request: all retry parameters stay identical.
      const s = j.session_id
        ? await request(c, "/checkout/sessions/" + encodeURIComponent(j.session_id))
        : await request(c, "/checkout/sessions", body, "provide-online-create:" + j.id);
      if (
        s.livemode !== live ||
        typeof s.id !== "string" ||
        !sessionId.test(s.id) ||
        (j.session_id !== null && s.id !== j.session_id) ||
        s.amount_total !== j.amount ||
        s.currency !== "eur" ||
        s.mode !== "payment" ||
        object(s.metadata)?.provide_job !== j.id ||
        !["open", "complete", "expired"].includes(String(s.status)) ||
        !["paid", "unpaid", "no_payment_required"].includes(String(s.payment_status))
      )
        throw new Error("Invalid checkout session");
      let intent: string | null = null;
      let authorized = false;
      let authorizationReleased = false;
      if (
        s.payment_status === "paid" ||
        (j.captureMethod === "manual" && s.status === "complete")
      ) {
        if (typeof s.payment_intent !== "string" || !/^pi_[A-Za-z0-9]+$/.test(s.payment_intent))
          throw new Error("Missing intent");
        const p = await request(c, "/payment_intents/" + encodeURIComponent(s.payment_intent));
        if (j.captureMethod === "manual") {
          assertAuthorizationIntent(
            p,
            { id: j.id, intentId: s.payment_intent, amount: j.amount },
            live,
          );
          authorizationReleased = p.status === "canceled" && p.amount_received === 0;
          authorized =
            p.status === "requires_capture" &&
            p.amount_capturable === j.amount &&
            p.amount_received === 0;
        }
        if (
          !authorized &&
          !authorizationReleased &&
          (p.livemode !== live ||
            p.status !== "succeeded" ||
            p.amount_received !== j.amount ||
            p.currency !== "eur" ||
            object(p.metadata)?.provide_job !== j.id)
        )
          throw new Error("Invalid capture");
        intent = s.payment_intent;
      }
      const url = typeof s.url === "string" ? s.url : null;
      if (live && s.status === "open") {
        if (!url || url.length > 4096 || !url.startsWith("https://checkout.stripe.com/"))
          throw new Error("Invalid checkout URL");
        const target = new URL(url);
        if (target.origin !== "https://checkout.stripe.com" || target.pathname !== "/c/pay/" + s.id)
          throw new Error("Invalid checkout URL");
      }
      return {
        id: s.id,
        status: s.status as ProviderSession["status"],
        paid: !authorized && !authorizationReleased && intent !== null,
        ...(j.captureMethod === "manual" ? { authorized, authorizationReleased } : {}),
        intent,
        url,
      };
    },
    async expire(c, id) {
      assertConfig(c);
      if (!sessionId.test(id)) throw new Error("Invalid checkout session ID");
      if (live) await verifyAccount(c);
      const expired = await request(
        c,
        "/checkout/sessions/" + encodeURIComponent(id) + "/expire",
        new URLSearchParams(),
        "provide-online-expire:" + id,
      );
      if (live && (expired.id !== id || expired.livemode !== true || expired.status !== "expired"))
        throw new Error("Invalid checkout expiration");
    },
    async refund(c, intent, jobId, refundId, amount, sequence) {
      assertConfig(c);
      if (
        live &&
        (!/^pi_[A-Za-z0-9]+$/.test(intent) || (refundId && !/^re_[A-Za-z0-9]+$/.test(refundId)))
      )
        throw new Error("Invalid refund reference");
      await verifyAccount(c);
      if (live && refundId === null) {
        const payment = await request(c, "/payment_intents/" + encodeURIComponent(intent));
        assertAuthorizationIntent(payment, { id: jobId, intentId: intent, amount }, true);
        if (payment.status !== "succeeded" || payment.amount_received !== amount)
          throw new Error("Refund requires the verified captured payment");
      }
      const r = refundId
        ? await request(c, "/refunds/" + encodeURIComponent(refundId))
        : await request(
            c,
            "/refunds",
            new URLSearchParams({
              payment_intent: intent,
              amount: String(amount),
              "metadata[provide_job]": jobId,
            }),
            "provide-online-refund:" + jobId + ":" + sequence,
          );
      if (
        typeof r.id !== "string" ||
        (live ? r.livemode !== true : r.livemode === true) ||
        (refundId !== null && r.id !== refundId) ||
        !/^re_[A-Za-z0-9]+$/.test(r.id) ||
        r.payment_intent !== intent ||
        r.amount !== amount ||
        r.currency !== "eur" ||
        object(r.metadata)?.provide_job !== jobId ||
        !["pending", "succeeded", "failed", "canceled", "requires_action"].includes(
          String(r.status),
        )
      )
        throw new Error("Invalid refund");
      return {
        id: r.id,
        status:
          r.status === "succeeded"
            ? "succeeded"
            : r.status === "failed" || r.status === "canceled"
              ? "failed"
              : "pending",
      };
    },
  };
}

export const stripeSandboxProvider = createStripeProvider<SandboxConfig>("test");
export const stripeLiveProvider = createStripeProvider<LiveStripeConfig>("live");

export interface SupportRefundJob {
  id: string;
  jobId: string;
  merchantAccount: string;
  intent: string;
  providerRefund: string | null;
  amount: number;
  capturedAmount: number;
}

export async function stripeTestPartialRefund(
  platform: SandboxConfig,
  job: SupportRefundJob,
): Promise<ProviderRefund> {
  if (
    (platform.mode ?? "test") !== "test" ||
    !/^(sk|rk)_test_/.test(platform.key) ||
    !/^acct_[A-Za-z0-9]+$/.test(job.merchantAccount) ||
    !/^pi_[A-Za-z0-9]+$/.test(job.intent) ||
    (job.providerRefund !== null && !/^re_[A-Za-z0-9]+$/.test(job.providerRefund)) ||
    !Number.isSafeInteger(job.amount) ||
    !Number.isSafeInteger(job.capturedAmount) ||
    job.amount < 1 ||
    job.amount >= job.capturedAmount
  )
    throw new Error("Invalid test refund job");
  const config =
    job.merchantAccount === platform.account
      ? platform
      : { ...platform, merchantAccount: job.merchantAccount };
  await verifyAccount(config);
  if (job.providerRefund === null) {
    const payment = await request(config, "/payment_intents/" + encodeURIComponent(job.intent));
    if (
      payment.id !== job.intent ||
      payment.livemode !== false ||
      payment.status !== "succeeded" ||
      payment.currency !== "eur" ||
      payment.amount_received !== job.capturedAmount ||
      object(payment.metadata)?.provide_job !== job.jobId
    )
      throw new Error("Captured payment mismatch");
  }
  const refund = job.providerRefund
    ? await request(config, "/refunds/" + encodeURIComponent(job.providerRefund))
    : await request(
        config,
        "/refunds",
        new URLSearchParams({
          payment_intent: job.intent,
          amount: String(job.amount),
          "metadata[provide_job]": job.jobId,
          "metadata[provide_support_refund]": job.id,
        }),
        "provide-support-refund:" + job.id,
      );
  const metadata = object(refund.metadata);
  if (
    refund.livemode !== false ||
    typeof refund.id !== "string" ||
    !/^re_[A-Za-z0-9]+$/.test(refund.id) ||
    (job.providerRefund !== null && job.providerRefund !== refund.id) ||
    refund.payment_intent !== job.intent ||
    refund.amount !== job.amount ||
    refund.currency !== "eur" ||
    metadata?.provide_job !== job.jobId ||
    metadata.provide_support_refund !== job.id ||
    !["pending", "requires_action", "succeeded", "failed", "canceled"].includes(
      String(refund.status),
    )
  )
    throw new Error("Test refund reply mismatch");
  return {
    id: refund.id,
    status:
      refund.status === "succeeded"
        ? "succeeded"
        : refund.status === "failed" || refund.status === "canceled"
          ? "failed"
          : "pending",
  };
}

// The production entry point selects the transport from the server-validated config.
export const stripePaymentProvider: Required<SandboxProvider<StripeConfig>> = {
  settleAuthorization: (c, j, a) =>
    c.mode === "live"
      ? stripeLiveProvider.settleAuthorization(c, j, a)
      : stripeSandboxProvider.settleAuthorization(c, j, a),
  session: (c, j) =>
    c.mode === "live" ? stripeLiveProvider.session(c, j) : stripeSandboxProvider.session(c, j),
  expire: (c, id) =>
    c.mode === "live" ? stripeLiveProvider.expire(c, id) : stripeSandboxProvider.expire(c, id),
  refund: (c, i, j, r, a, s) =>
    c.mode === "live"
      ? stripeLiveProvider.refund(c, i, j, r, a, s)
      : stripeSandboxProvider.refund(c, i, j, r, a, s),
};

export async function digest(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function verifyStripeWebhook(
  raw: string,
  header: string | null,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!header || header.length > 2048) return false;
  const fields = header.split(",");
  const times = fields.filter((x) => x.startsWith("t="));
  if (times.length !== 1 || !/^t=[0-9]{10}$/.test(times[0]!)) return false;
  const timestamp = times[0]!.slice(2);
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  for (const part of fields.filter((x) => /^v1=[a-f0-9]{64}$/.test(x))) {
    const bytes = Uint8Array.from(part.slice(3).match(/../g)!, (x) => parseInt(x, 16));
    if (
      await crypto.subtle.verify(
        "HMAC",
        key,
        bytes,
        new TextEncoder().encode(timestamp + "." + raw),
      )
    )
      return true;
  }
  return false;
}
