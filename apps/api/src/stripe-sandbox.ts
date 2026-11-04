import { object } from "@provide/contracts";
export interface SandboxConfig {
  key: string;
  account: string;
  merchantAccount?: string;
  webhookSecret: string;
  returnOrigin: string;
}
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
export interface SandboxProvider {
  settleAuthorization?(config: SandboxConfig, job: AuthorizationJob, action: "capture" | "cancel"): Promise<void>;
  session(
    config: SandboxConfig,
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
  expire(config: SandboxConfig, id: string): Promise<void>;
  refund(
    config: SandboxConfig,
    intent: string,
    jobId: string,
    refundId: string | null,
    amount: number,
    sequence: number,
  ): Promise<ProviderRefund>;
}
const api = "https://api.stripe.com/v1";
async function request(
  c: SandboxConfig,
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
  if (!response.ok) throw new Error("Provider unavailable");
  const text = await response.text();
  if (text.length > 256 * 1024) throw new Error("Provider response too large");
  const result = object(JSON.parse(text));
  if (!result) throw new Error("Invalid provider response");
  return result;
}
async function verifyAccount(c: SandboxConfig) {
  const platform: SandboxConfig = {
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

function assertAuthorizationIntent(intent: Record<string, unknown>, job: AuthorizationJob) {
  if (
    intent.id !== job.intentId ||
    intent.livemode !== false ||
    intent.capture_method !== "manual" ||
    intent.amount !== job.amount ||
    intent.currency !== "eur" ||
    object(intent.metadata)?.provide_job !== job.id
  )
    throw new Error("Invalid authorization intent");
}

export const stripeSandboxProvider: SandboxProvider & {
  settleAuthorization(config: SandboxConfig, job: AuthorizationJob, action: "capture" | "cancel"): Promise<void>;
} = {
  async settleAuthorization(config: SandboxConfig, job: AuthorizationJob, action: "capture" | "cancel") {
    await verifyAccount(config);
    if (!/^pi_[A-Za-z0-9]+$/.test(job.intentId)) throw new Error("Invalid intent ID");
    const path = "/payment_intents/" + encodeURIComponent(job.intentId);
    const before = await request(config, path);
    assertAuthorizationIntent(before, job);
    const expected = action === "capture" ? "succeeded" : "canceled";
    let result = before;
    if (before.status !== expected) {
      if (before.status !== "requires_capture" || before.amount_capturable !== job.amount)
        throw new Error("Authorization no longer available");
      const body = new URLSearchParams();
      if (action === "capture") body.set("amount_to_capture", String(job.amount));
      result = await request(
        config, path + "/" + action, body, "provide-online-" + action + ":" + job.id,
      );
    }
    assertAuthorizationIntent(result, job);
    if (result.status !== expected || result.amount_received !== (action === "capture" ? job.amount : 0))
      throw new Error("Unexpected authorization outcome");
  },
  async session(c, j) {
    const platform = await verifyAccount(c);
    if (!j.session_id) {
      // Read v2 capability before creating a payment. Existing sessions and refunds must
      // remain reconcilable after a merchant loses the ability to accept new payments.
      const merchant = c.merchantAccount ?? c.account;
      const a = await request(
        platform,
        "/v2/core/accounts/" + encodeURIComponent(merchant) + "?include[0]=configuration.merchant",
      );
      const configuration = object(a.configuration);
      const capabilities = object(object(configuration?.merchant)?.capabilities);
      if (
        a.id !== merchant ||
        a.livemode !== false ||
        object(capabilities?.card_payments)?.status !== "active"
      )
        throw new Error("Merchant cannot accept test payments");
    }
    // Derive a stable eight-letter suffix from the random job UUID so retries keep identical
    // Checkout parameters while each integration identifier remains unique to this payment job.
    const integrationSuffix = j.id
      .replaceAll("-", "")
      .slice(0, 8)
      .replace(/[0-9a-f]/g, (value) => String.fromCharCode(97 + Number.parseInt(value, 16)));
    const body = new URLSearchParams({
      mode: "payment",
      integration_identifier: `provide_ab39_${integrationSuffix}`,
      locale: "de",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": String(j.amount),
      "line_items[0][price_data][product_data][name]": "PROVIDE Testbestellung",
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
      s.livemode !== false ||
      typeof s.id !== "string" ||
      !/^cs_test_[A-Za-z0-9]+$/.test(s.id) ||
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
    if (s.payment_status === "paid" || (j.captureMethod === "manual" && s.status === "complete")) {
      if (typeof s.payment_intent !== "string" || !/^pi_[A-Za-z0-9]+$/.test(s.payment_intent))
        throw new Error("Missing intent");
      const p = await request(c, "/payment_intents/" + encodeURIComponent(s.payment_intent));
      if (j.captureMethod === "manual") {
        assertAuthorizationIntent(p, { id: j.id, intentId: s.payment_intent, amount: j.amount });
        authorizationReleased = p.status === "canceled" && p.amount_received === 0;
        authorized =
          p.status === "requires_capture" && p.amount_capturable === j.amount && p.amount_received === 0;
      }
      if (
        !authorized && !authorizationReleased && (
        p.livemode !== false ||
        p.status !== "succeeded" ||
        p.amount_received !== j.amount ||
        p.currency !== "eur" ||
        object(p.metadata)?.provide_job !== j.id)
      )
        throw new Error("Invalid capture");
      intent = s.payment_intent;
    }
    return {
      id: s.id,
      status: s.status as ProviderSession["status"],
      paid: !authorized && !authorizationReleased && intent !== null,
      ...(j.captureMethod === "manual" ? { authorized, authorizationReleased } : {}),
      intent,
      url: typeof s.url === "string" ? s.url : null,
    };
  },
  async expire(c, id) {
    await request(
      c,
      "/checkout/sessions/" + encodeURIComponent(id) + "/expire",
      new URLSearchParams(),
      "provide-online-expire:" + id,
    );
  },
  async refund(c, intent, jobId, refundId, amount, sequence) {
    await verifyAccount(c);
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
      r.livemode === true ||
      !/^re_[A-Za-z0-9]+$/.test(r.id) ||
      r.payment_intent !== intent ||
      r.amount !== amount ||
      r.currency !== "eur" ||
      object(r.metadata)?.provide_job !== jobId ||
      !["pending", "succeeded", "failed", "canceled", "requires_action"].includes(String(r.status))
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
