import {
  checkoutDigest,
  checkoutMac,
  signCheckoutRequest,
  readCheckoutBody,
  record,
  onlyKeys,
  handoffIdPattern,
  handoffTokenPattern,
  parseCartHandoffSelection,
  validCheckoutSecret,
} from "@provide/contracts";
import {
  cloudflareCheckoutNetwork,
  type CheckoutGatewayEnvironment,
  type TrustedCheckoutNetwork,
} from "./protected-gateway";
export async function handleHandoffGateway(
  request: Request,
  integrationId: string,
  env: CheckoutGatewayEnvironment,
  fetcher: typeof fetch = fetch,
  network: TrustedCheckoutNetwork = cloudflareCheckoutNetwork,
): Promise<Response> {
  const h = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    vary: "Origin",
  });
  const origin = request.headers.get("origin");
  const own = env.CHECKOUT_STOREFRONT_ORIGIN;
  const fail = (status: number, code: string) =>
    Response.json({ error: { code } }, { status, headers: h });
  if (!handoffIdPattern.test(integrationId) || new URL(request.url).search)
    return fail(400, "bad_request");
  if (origin && /^https:\/\/[^/]+$/.test(origin)) {
    h.set("access-control-allow-origin", origin);
    h.set("access-control-allow-methods", "GET, POST, OPTIONS");
    h.set("access-control-allow-headers", "content-type");
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  try {
    if (
      !own ||
      new URL(request.url).origin !== own ||
      !validCheckoutSecret(env.CHECKOUT_GATEWAY_SECRET) ||
      !validCheckoutSecret(env.CHECKOUT_NETWORK_SECRET) ||
      !env.PUBLIC_API_URL ||
      new URL(env.PUBLIC_API_URL).protocol !== "https:"
    )
      return fail(503, "service_unavailable");
    let body: Record<string, unknown> = { action: "catalog", integrationId, sourceOrigin: origin };
    let context: string | null = null;
    if (request.method === "POST") {
      const b = record(JSON.parse(await readCheckoutBody(request)));
      if (!b) return fail(400, "bad_request");
      if (b.action === "prepare" || b.action === "redeem") {
        if (
          origin !== own ||
          !onlyKeys(
            b,
            b.action === "prepare"
              ? ["action"]
              : ["action", "token", "restaurantSlug", "locationSlug"],
          )
        )
          return fail(403, "forbidden");
        const cookies = (request.headers.get("cookie") ?? "")
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s.startsWith("__Host-provide-cart-import="));
        let verifier = cookies.length === 1 ? cookies[0]!.split("=")[1] : undefined;
        if (b.action === "prepare") {
          if (!verifier || !handoffTokenPattern.test(verifier)) {
            verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("");
          }
          h.set(
            "set-cookie",
            `__Host-provide-cart-import=${verifier}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
          );
          return Response.json({ data: { ready: true } }, { headers: h });
        }
        if (
          !verifier ||
          !handoffTokenPattern.test(verifier) ||
          !handoffTokenPattern.test(String(b.token))
        )
          return fail(403, "forbidden");
        context = await checkoutDigest(verifier);
        body = { ...b, integrationId };
      } else {
        if (
          !origin ||
          !onlyKeys(b, ["action", "selection"]) ||
          b.action !== "create" ||
          !parseCartHandoffSelection(b.selection)
        )
          return fail(400, "bad_request");
        body = { action: "create", integrationId, sourceOrigin: origin, selection: b.selection };
      }
    } else if (request.method !== "GET") return fail(405, "bad_request");
    const ip = network(request);
    if (!ip) return fail(503, "service_unavailable");
    const at = Date.now(),
      epoch = Math.floor(at / 600000);
    const keys = await Promise.all(
      [epoch, epoch - 1].map(async (e) =>
        checkoutDigest(
          await checkoutMac(env.CHECKOUT_NETWORK_SECRET!, "handoff-network-v1", `${e}\n${ip}`),
        ),
      ),
    );
    const target = new Request(new URL("/v1/cart-handoff", env.PUBLIC_API_URL), { method: "POST" }),
      text = JSON.stringify(body);
    const signed = await signCheckoutRequest(
      target,
      text,
      { at, nonce: crypto.randomUUID(), context, freshContext: false, network: keys, epoch },
      env.CHECKOUT_GATEWAY_SECRET,
    );
    const response = await fetcher(target, {
      method: "POST",
      headers: signed,
      body: text,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status >= 300 && response.status < 400) return fail(503, "service_unavailable");
    const data: unknown = JSON.parse(await readCheckoutBody(response));
    return Response.json(data, { status: response.status, headers: h });
  } catch {
    return fail(503, "service_unavailable");
  }
}
