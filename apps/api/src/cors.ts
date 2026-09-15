const defaultAllowedOrigins = ["http://localhost:3000"];

export function parseAllowedOrigins(value: string | undefined): readonly string[] {
  if (!value) {
    return defaultAllowedOrigins;
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function corsHeaders(request: Request, allowedOrigins: readonly string[]): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin");

  if (origin && allowedOrigins.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }

  headers.set("access-control-allow-headers", "content-type, x-request-id");
  headers.set("access-control-allow-methods", "GET, HEAD, POST, OPTIONS");
  headers.set("access-control-max-age", "600");
  return headers;
}
