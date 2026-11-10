import { timingSafeEqual } from "node:crypto";

export function databaseHealthConfigured(token: string | undefined): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(token);
}

export function databaseHealthAuthorized(request: Request, token: string): boolean {
  const encoder = new TextEncoder();
  const expected = encoder.encode(`Bearer ${token}`);
  const supplied = encoder.encode(request.headers.get("authorization") ?? "");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
