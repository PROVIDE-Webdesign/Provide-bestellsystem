import { object } from "@provide/contracts";
export interface SandboxConfig {
  key: string;
  account: string;
  webhookSecret: string;
  returnOrigin: string;
}
export interface ProviderSession {
  id: string;
  status: "open" | "complete" | "expired";
  paid: boolean;
  intent: string | null;
  url: string | null;
}
export interface ProviderRefund {
  id: string;
  status: "pending" | "succeeded" | "failed";
}
export interface SandboxProvider {
  session(
    config: SandboxConfig,
    job: {
      id: string;
      session_id: string | null;
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
  const response = await fetch(api + path, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${c.key}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotency ? { "idempotency-key": idempotency } : {}),
    },
    body: body?.toString() ?? null,
    redirect: "error",
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
  const a = await request(c, "/account");
  if (a.id !== c.account) throw new Error("Account mismatch");
}
export const stripeSandboxProvider: SandboxProvider = {
  async session(c, j) {
    await verifyAccount(c);
    const body = new URLSearchParams({
      mode: "payment",
      "payment_method_types[0]": "card",
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
    if (s.payment_status === "paid") {
      if (typeof s.payment_intent !== "string" || !/^pi_[A-Za-z0-9]+$/.test(s.payment_intent))
        throw new Error("Missing intent");
      const p = await request(c, "/payment_intents/" + encodeURIComponent(s.payment_intent));
      if (
        p.livemode !== false ||
        p.status !== "succeeded" ||
        p.amount_received !== j.amount ||
        p.currency !== "eur" ||
        object(p.metadata)?.provide_job !== j.id
      )
        throw new Error("Invalid capture");
      intent = s.payment_intent;
    }
    return {
      id: s.id,
      status: s.status as ProviderSession["status"],
      paid: s.payment_status === "paid",
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
