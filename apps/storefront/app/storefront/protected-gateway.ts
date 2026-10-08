import { isIP } from "node:net";
import {
  isStorefrontScope,
  CheckoutBodyError,
  checkoutCookieName,
  checkoutDigest,
  checkoutMac,
  checkoutVerifierPattern,
  newCheckoutVerifier,
  onlyKeys,
  parseCheckoutIssue,
  parseCheckoutIntent,
  readCheckoutBody,
  record,
  signCheckoutRequest,
  validCheckoutSecret,
  verifyCheckoutMac,
  type CheckoutAttestation,
} from "@provide/contracts";
import {
  fetchPublicOrderStatus,
  fetchPublicStorefront,
  submitGuestPickupOrder,
  type GatewayParams,
} from "./gateway";

export interface CheckoutGatewayEnvironment {
  APP_ENV?: string;
  PUBLIC_API_URL?: string;
  CHECKOUT_PROTECTION_ENABLED?: string;
  CHECKOUT_STOREFRONT_ORIGIN?: string;
  CHECKOUT_GATEWAY_SECRET?: string;
  CHECKOUT_NETWORK_SECRET?: string;
  CHECKOUT_NETWORK_SECRET_PREVIOUS?: string;
}
export type TrustedCheckoutNetwork = (request: Request) => string | undefined;
/** Cloudflare overwrites this header; request.cf is runtime metadata, not an HTTP header. */
export const cloudflareCheckoutNetwork: TrustedCheckoutNetwork = (request) => {
  const cf = (request as Request & { cf?: { colo?: unknown } }).cf;
  const ip = request.headers.get("cf-connecting-ip");
  return cf && typeof cf.colo === "string" && ip && isIP(ip) ? ip : undefined;
};
function safeApiBase(raw: string | undefined): URL | undefined {
  try {
    const u = new URL(raw ?? "");
    return u.protocol === "https:" &&
      u.pathname === "/" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
      ? u
      : undefined;
  } catch {
    return;
  }
}
function cookieVerifier(request: Request): string | null | undefined {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(checkoutCookieName + "="));
  if (matches.length === 0) return null;
  if (matches.length !== 1) return;
  const value = matches[0]!.slice(checkoutCookieName.length + 1);
  return checkoutVerifierPattern.test(value) ? value : undefined;
}
const errorCodes = new Set([
  "bad_request",
  "conflict",
  "forbidden",
  "not_found",
  "order_unavailable",
  "payload_too_large",
  "rate_limited",
  "checkout_session_expired",
  "checkout_result_unknown",
  "service_unavailable",
  "unsupported_media_type",
]);
/** This is the sole public route gateway. Dependency injection is for isolated local evidence. */
export async function handleCheckoutGateway(
  request: Request,
  params: GatewayParams,
  env: CheckoutGatewayEnvironment,
  fetcher: typeof fetch = fetch,
  trustedNetwork: TrustedCheckoutNetwork = cloudflareCheckoutNetwork,
): Promise<Response> {
  const headers = new Headers({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  const failure = (status: number, code = "service_unavailable", retry?: string) => {
    const h = new Headers(headers);
    if (retry && /^[1-9][0-9]{0,2}$/.test(retry) && Number(retry) <= 600)
      h.set("retry-after", retry);
    return Response.json({ error: { code } }, { status, headers: h });
  };
  const write = ["orders", "delivery-orders", "online-orders"].includes(params.resource);
  const allowed = [
    "checkout-context",
    "checkout-session",
    "checkout-receipt",
    "cart-quote",
    "catalog",
    "availability",
    "orders",
    "order-status",
    "delivery-quote",
    "delivery-orders",
    "online-orders",
    "payment-session",
  ];
  const base = safeApiBase(env.PUBLIC_API_URL);
  if (
    !base ||
    env.CHECKOUT_PROTECTION_ENABLED !== "true" ||
    !validCheckoutSecret(env.CHECKOUT_GATEWAY_SECRET) ||
    !validCheckoutSecret(env.CHECKOUT_NETWORK_SECRET) ||
    env.CHECKOUT_GATEWAY_SECRET === env.CHECKOUT_NETWORK_SECRET
  )
    return failure(503);
  if (!isStorefrontScope(params) || !allowed.includes(params.resource) || request.url.length > 2048)
    return failure(400, "bad_request");
  try {
    const origin = new URL(env.CHECKOUT_STOREFRONT_ORIGIN ?? "");
    if (
      origin.origin !== env.CHECKOUT_STOREFRONT_ORIGIN ||
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      new URL(request.url).origin !== origin.origin ||
      (env.APP_ENV === "production" && ["localhost", "127.0.0.1"].includes(origin.hostname))
    )
      return failure(503);
    const isRead = request.method === "GET";
    if (isRead && !["catalog", "availability"].includes(params.resource))
      return failure(405, "bad_request");
    if (!isRead && request.method !== "POST") return failure(405, "bad_request");
    if (!isRead && (request.headers.get("origin") !== origin.origin || new URL(request.url).search))
      return failure(403, "forbidden");
    const network = trustedNetwork(request);
    if (!network || !isIP(network)) return failure(503);
    const verifier = cookieVerifier(request);
    if (verifier === undefined) return failure(403, "forbidden");
    const bootstrap = params.resource === "checkout-context";
    if (bootstrap && request.headers.get("x-provide-checkout-bootstrap") !== "1")
      return failure(403, "forbidden");
    if (!isRead && !bootstrap && !verifier) return failure(410, "checkout_session_expired");
    const actualVerifier = verifier ?? (bootstrap ? newCheckoutVerifier() : null);
    const hash = actualVerifier ? await checkoutDigest(actualVerifier) : null;
    if (
      !isRead &&
      !bootstrap &&
      !(await verifyCheckoutMac(
        env.CHECKOUT_GATEWAY_SECRET,
        "csrf-v1",
        hash!,
        request.headers.get("x-provide-checkout-csrf") ?? "",
      ))
    )
      return failure(403, "forbidden");
    const text = isRead ? "" : await readCheckoutBody(request, bootstrap ? 1024 : 64 * 1024);
    let body: unknown = isRead ? undefined : JSON.parse(text);
    if (bootstrap && (!record(body) || !onlyKeys(record(body)!, [])))
      return failure(400, "bad_request");
    if (params.resource === "checkout-session") {
      body = parseCheckoutIssue(body);
      if (!body) return failure(400, "bad_request");
    }
    if (write) {
      const o = record(body);
      if (!o || !onlyKeys(o, ["sessionId", "command"]) || typeof o.sessionId !== "string")
        return failure(400, "bad_request");
    }
    const at = Date.now();
    const epoch = Math.floor(at / 600_000);
    // Both epochs are charged. A boundary, Worker restart or scope change does not reset the shared bucket.
    const networkSecrets = [env.CHECKOUT_NETWORK_SECRET];
    if (env.CHECKOUT_NETWORK_SECRET_PREVIOUS !== undefined) {
      if (!validCheckoutSecret(env.CHECKOUT_NETWORK_SECRET_PREVIOUS)) return failure(503);
      networkSecrets.push(env.CHECKOUT_NETWORK_SECRET_PREVIOUS);
    }
    const net = await Promise.all(
      networkSecrets.flatMap((secret) =>
        [epoch, epoch - 1].map(async (e) =>
          checkoutDigest(await checkoutMac(secret, "network-v1", `${e}\n${network}`)),
        ),
      ),
    );
    const a: CheckoutAttestation = {
      at,
      nonce: crypto.randomUUID(),
      context: hash,
      freshContext: bootstrap && !verifier,
      network: net,
      epoch,
    };
    let upstreamFailure: { status: number; code: string; retry?: string } | undefined;
    const signedFetcher: typeof fetch = async (input, init) => {
      const u = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? "GET";
      let normalizedBody = typeof init?.body === "string" ? init.body : "";
      if (write)
        normalizedBody = JSON.stringify({
          sessionId: record(body)!.sessionId,
          command: JSON.parse(normalizedBody) as unknown,
        });
      const target = new Request(u, { method });
      const signed = await signCheckoutRequest(
        target,
        normalizedBody,
        a,
        env.CHECKOUT_GATEWAY_SECRET!,
      );
      // Whitelist only our own attestation and JSON headers; no browser Authorization/cookies/IP forwarded.
      const response = await fetcher(target, {
        method,
        headers: signed,
        ...(method !== "GET" ? { body: normalizedBody } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        let code = "service_unavailable";
        try {
          const error = record(record(JSON.parse(await readCheckoutBody(response, 4096)))?.error);
          if (typeof error?.code === "string" && errorCodes.has(error.code)) code = error.code;
        } catch {
          /* safe closed default */
        }
        const status = [400, 403, 404, 409, 410, 413, 415, 429, 503].includes(response.status)
          ? response.status
          : 503;
        const retry = response.headers.get("retry-after");
        upstreamFailure = { status, code, ...(status === 429 && retry ? { retry } : {}) };
      }
      return response;
    };
    let result: Response;
    if (["checkout-context", "checkout-session", "checkout-receipt"].includes(params.resource)) {
      const target = new URL(
        `/v1/storefront/${params.restaurantSlug}/${params.locationSlug}/${params.resource}`,
        base,
      );
      const response = await signedFetcher(target, { method: "POST", body: JSON.stringify(body) });
      if (upstreamFailure) {
        if (bootstrap && upstreamFailure.status === 410)
          headers.set(
            "set-cookie",
            `${checkoutCookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
          );
        return failure(upstreamFailure.status, upstreamFailure.code, upstreamFailure.retry);
      }
      const data = record(JSON.parse(await readCheckoutBody(response, 16 * 1024)))?.data;
      if (bootstrap) {
        const info = record(data);
        const expiry =
          typeof info?.contextExpiresAt === "string" ? Date.parse(info.contextExpiresAt) : NaN;
        const remaining = Math.floor((expiry - Date.now()) / 1000);
        if (
          info?.ready !== true ||
          !Number.isInteger(remaining) ||
          remaining < 1 ||
          remaining > 5400
        )
          return failure(503);
        headers.set(
          "set-cookie",
          `${checkoutCookieName}=${actualVerifier}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${remaining}`,
        );
        result = Response.json(
          {
            data: {
              csrf: await checkoutMac(env.CHECKOUT_GATEWAY_SECRET, "csrf-v1", hash!),
              ready: true,
            },
          },
          { headers },
        );
      } else if (params.resource === "checkout-session") {
        const intent = parseCheckoutIntent(data);
        if (!intent) return failure(503);
        headers.set(
          "set-cookie",
          `${checkoutCookieName}=${actualVerifier}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=5400`,
        );
        result = Response.json({ data: intent }, { status: response.status, headers });
      } else {
        const receipt = record(data);
        if (
          !receipt ||
          !["unsubmitted", "committed"].includes(String(receipt.state)) ||
          (receipt.state === "committed" &&
            (!record(receipt.confirmation) ||
              !["orders", "delivery-orders", "online-orders"].includes(String(receipt.mode))))
        )
          return failure(503);
        result = Response.json({ data: receipt }, { headers });
      }
    } else {
      const filteredRequest = isRead
        ? request
        : new Request(request.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(write ? record(body)!.command : body),
          });
      result = isRead
        ? await fetchPublicStorefront(filteredRequest, params, env.PUBLIC_API_URL, signedFetcher)
        : params.resource === "order-status"
          ? await fetchPublicOrderStatus(filteredRequest, params, env.PUBLIC_API_URL, signedFetcher)
          : await submitGuestPickupOrder(
              filteredRequest,
              params,
              env.PUBLIC_API_URL,
              signedFetcher,
            );
      if (upstreamFailure)
        return failure(upstreamFailure.status, upstreamFailure.code, upstreamFailure.retry);
      if (write && result.status >= 500) return failure(503, "checkout_result_unknown");
    }
    return result;
  } catch (error) {
    if (error instanceof CheckoutBodyError)
      return failure(
        error.status,
        error.status === 413
          ? "payload_too_large"
          : error.status === 415
            ? "unsupported_media_type"
            : "bad_request",
      );
    return failure(503, write ? "checkout_result_unknown" : "service_unavailable");
  }
}
