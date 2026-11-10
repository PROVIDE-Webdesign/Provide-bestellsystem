/** Apply transport and framing rules before serving application code or static assets. */
export async function secureHttpResponse(
  request: Request,
  environment: string | undefined,
  next: () => Response | Promise<Response>,
  assets?: { fetch(request: Request): Promise<Response> },
): Promise<Response> {
  const url = new URL(request.url);
  const localPreviewHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && (environment === "production" || !localPreviewHost)) {
    url.protocol = "https:";
    return new Response(null, {
      status: 308,
      headers: {
        location: url.href,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }

  // run_worker_first bypasses Cloudflare's automatic asset serving. Restore that
  // lookup explicitly while keeping redirects and security headers around it.
  const assetResponse =
    assets && (request.method === "GET" || request.method === "HEAD")
      ? await assets.fetch(request)
      : undefined;
  const response = assetResponse && assetResponse.status !== 404 ? assetResponse : await next();
  // Preserve the development websocket upgrade; production routes use HTTP responses.
  if (response.status === 101) return response;
  const secured = new Response(response.body, response);
  secured.headers.set("x-content-type-options", "nosniff");
  secured.headers.set("referrer-policy", "no-referrer");
  secured.headers.set("x-frame-options", "DENY");
  // Multiple CSP policies are enforced together; preserve any stricter existing policy.
  secured.headers.append("content-security-policy", "frame-ancestors 'none'");
  if (url.protocol === "https:")
    secured.headers.set("strict-transport-security", "max-age=31536000");
  return secured;
}
