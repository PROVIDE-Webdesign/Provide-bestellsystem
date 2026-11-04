import {
  isCheckoutTestHostname,
  readCheckoutBody,
  record,
  validCheckoutSecret,
} from "@provide/contracts";
export interface CheckoutChallengeConfig {
  secret: string;
  hostname: string;
}
export interface CheckoutChallengeVerifier {
  verify(config: CheckoutChallengeConfig, token: string, issueId: string): Promise<boolean>;
}
/** Real provider verification is used only when an operator explicitly configures it. */
export const turnstileCheckoutChallenge: CheckoutChallengeVerifier = {
  async verify(config, token, issueId) {
    if (!validCheckoutSecret(config.secret)) throw new Error("Challenge unavailable");
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Workers supports manual redirects; the status check below rejects every redirect.
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ secret: config.secret, response: token, idempotency_key: issueId }),
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
      throw new Error("Challenge unavailable");
    const text = await readCheckoutBody(response, 8192);
    const result = record(JSON.parse(text));
    const timestamp =
      typeof result?.challenge_ts === "string" ? Date.parse(result.challenge_ts) : NaN;
    const valid =
      result?.success === true &&
      result.hostname === config.hostname &&
      result.action === "checkout_issue" &&
      result.cdata === issueId &&
      timestamp <= Date.now() + 2000 &&
      timestamp > Date.now() - 300_000;
    if (!valid) {
      const codes = Array.isArray(result?.["error-codes"])
        ? result["error-codes"].filter(
            (code): code is string =>
              typeof code === "string" &&
              [
                "missing-input-secret",
                "invalid-input-secret",
                "missing-input-response",
                "invalid-input-response",
                "bad-request",
                "timeout-or-duplicate",
                "internal-error",
              ].includes(code),
          )
        : [];
      console.warn(
        JSON.stringify({
          event: "checkout_challenge_rejected",
          codes,
          providerSuccess: result?.success === true,
          hostnameMatches: result?.hostname === config.hostname,
          actionMatches: result?.action === "checkout_issue",
          issueMatches: result?.cdata === issueId,
          timestampValid: timestamp <= Date.now() + 2000 && timestamp > Date.now() - 300_000,
        }),
      );
      // Provider outages are retryable with the SAME token and idempotency key.
      // Never persist them as a definitive rejected claim.
      if (
        codes.includes("internal-error") ||
        codes.includes("missing-input-secret") ||
        codes.includes("invalid-input-secret")
      )
        throw new Error("Challenge unavailable");
    }
    return valid;
  },
};
export function checkoutChallengeConfig(env: {
  APP_ENV: string;
  CHECKOUT_TURNSTILE_SECRET?: string;
  CHECKOUT_STOREFRONT_ORIGIN?: string;
}): CheckoutChallengeConfig | undefined {
  if (!validCheckoutSecret(env.CHECKOUT_TURNSTILE_SECRET)) return;
  // Published test keys cannot be accepted by a production configuration.
  if (env.APP_ENV === "production" && /^[123]x0/.test(env.CHECKOUT_TURNSTILE_SECRET)) return;
  try {
    const u = new URL(env.CHECKOUT_STOREFRONT_ORIGIN ?? "");
    if (
      u.origin !== env.CHECKOUT_STOREFRONT_ORIGIN ||
      u.protocol !== "https:" ||
      u.username ||
      u.password
    )
      return;
    if (env.APP_ENV === "production" && isCheckoutTestHostname(u.hostname)) return;
    return { secret: env.CHECKOUT_TURNSTILE_SECRET, hostname: u.hostname };
  } catch {
    return;
  }
}
