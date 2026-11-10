/** Apply transport and framing rules before serving application code or static assets. */
export async function secureHttpResponse(
  request: Request,
  environment: string | undefined,
  next: () => Response | Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  if (environment === "production" && url.protocol === "http:") {
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

  const response = await next();
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
