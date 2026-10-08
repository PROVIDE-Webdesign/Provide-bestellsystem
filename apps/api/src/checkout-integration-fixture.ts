/** Isolated native integration fixture: production dispatcher + real PG + local challenge double.
 * It provides an attested transport for older domain regression scenarios, never a runtime bypass.
 * Actual browser/gateway/TLS evidence is in checkout-protection.integration.test.ts.
 */
import {
  checkoutDigest,
  parseCheckoutIntent,
  record,
  signCheckoutRequest,
  type CheckoutAttestation,
} from "@provide/contracts";
import { createApiWorker } from "./index.js";
import { routeRequest } from "./router.js";
type Env = Parameters<ReturnType<typeof createApiWorker>["fetch"]>[1];
export const isolatedCheckoutSettings = {
  CHECKOUT_PROTECTION_ENABLED: "true",
  CHECKOUT_GATEWAY_SECRET: "synthetic-isolated-o3-gateway-secret-at-least-32",
  CHECKOUT_FINGERPRINT_SECRET: "synthetic-isolated-o3-fingerprint-secret-at-least-32",
  CHECKOUT_TURNSTILE_SECRET: "synthetic-isolated-o3-challenge-secret-at-least-32",
  CHECKOUT_STOREFRONT_ORIGIN: "https://storefront.test",
};
export function createProtectedIntegrationWorker(
  ...args: Parameters<typeof createApiWorker>
): ReturnType<typeof createApiWorker> {
  args[25] = { verify: () => Promise.resolve(true) };
  const worker = createApiWorker(...args);
  const bindings = new Map<string, { hash: string; session: string }>();
  const network = [crypto.randomUUID(), crypto.randomUUID()];
  async function signed(
    url: string,
    method: string,
    text: string,
    hash: string | null,
    env: Env,
    fresh = false,
    originalHeaders?: Headers,
  ): Promise<Response> {
    const at = Date.now();
    const a: CheckoutAttestation = {
      at,
      nonce: crypto.randomUUID(),
      context: hash,
      freshContext: fresh,
      network: [await checkoutDigest(network[0]!), await checkoutDigest(network[1]!)],
      epoch: Math.floor(at / 600000),
    };
    const request = new Request(url, { method });
    const headers = await signCheckoutRequest(
      request,
      text,
      a,
      isolatedCheckoutSettings.CHECKOUT_GATEWAY_SECRET,
    );
    if (originalHeaders?.has("content-type"))
      headers.set("content-type", originalHeaders.get("content-type")!);
    return worker.fetch(
      new Request(request, { headers, ...(method !== "GET" ? { body: text } : {}) }),
      { ...env, ...isolatedCheckoutSettings },
    );
  }
  return {
    ...worker,
    async fetch(request, env) {
      const route = routeRequest(request);
      if (!route || !("restaurantSlug" in route)) return worker.fetch(request, env);
      const text = request.method === "GET" ? "" : await request.clone().text();
      if (["orders", "delivery-orders", "online-orders"].includes(route.name)) {
        let command: unknown;
        try {
          command = JSON.parse(text);
        } catch {
          return signed(request.url, request.method, text, null, env, false, request.headers);
        }
        const key = record(command)?.submissionKey;
        if (typeof key !== "string")
          return signed(
            request.url,
            request.method,
            JSON.stringify({ sessionId: crypto.randomUUID(), command }),
            await checkoutDigest("invalid-input"),
            env,
            false,
            request.headers,
          );
        const bindingKey = `${route.restaurantSlug}/${route.locationSlug}/${key}`;
        let binding = bindings.get(bindingKey);
        if (!binding) {
          const hash = await checkoutDigest(crypto.randomUUID());
          const base = new URL(
            `/v1/storefront/${route.restaurantSlug}/${route.locationSlug}/`,
            request.url,
          ).toString();
          const issueEnv = { ...env, CHECKOUT_WRITE_ENABLED: "true" };
          const context = await signed(
            base + "checkout-context",
            "POST",
            "{}",
            hash,
            issueEnv,
            true,
          );
          if (context.status !== 200)
            throw new Error(`Isolated context fixture failed: ${context.status}`);
          const response = await signed(
            base + "checkout-session",
            "POST",
            JSON.stringify({
              issueId: crypto.randomUUID(),
              submissionKey: key,
              challenge: `synthetic-${crypto.randomUUID()}`,
            }),
            hash,
            issueEnv,
          );
          const intent = parseCheckoutIntent(record(await response.json())?.data);
          if (!intent) throw new Error(`Isolated intent fixture failed: ${response.status}`);
          binding = { hash, session: intent.sessionId };
          bindings.set(bindingKey, binding);
        }
        return signed(
          request.url,
          request.method,
          JSON.stringify({ sessionId: binding.session, command }),
          binding.hash,
          env,
          false,
          request.headers,
        );
      }
      return signed(request.url, request.method, text, null, env, false, request.headers);
    },
  };
}
