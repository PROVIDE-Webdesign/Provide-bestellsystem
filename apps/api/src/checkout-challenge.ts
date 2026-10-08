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
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ secret: config.secret, response: token, idempotency_key: issueId }),
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
      throw new Error("Challenge unavailable");
    const text = await readCheckoutBody(response, 8192);
    const result = record(JSON.parse(text));
    const timestamp =
      typeof result?.challenge_ts === "string" ? Date.parse(result.challenge_ts) : NaN;
    return (
      result?.success === true &&
      result.hostname === config.hostname &&
      result.action === "checkout_issue" &&
      result.cdata === issueId &&
      timestamp <= Date.now() + 2000 &&
      timestamp > Date.now() - 300_000
    );
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
