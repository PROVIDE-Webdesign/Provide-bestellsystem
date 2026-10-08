/** O3 transport primitives. Secrets are supplied by server bindings, never public props. */
export const checkoutCookieName = "__Host-provide-checkout";
export const checkoutWriteMinutes = 30;
export const checkoutReceiptMinutes = 90;
export const checkoutHashPattern = /^[a-f0-9]{64}$/;
export const checkoutVerifierPattern = /^[A-Za-z0-9_-]{43}$/;
export const checkoutUuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const checkoutSubmissionPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export interface CheckoutIntent {
  readonly sessionId: string;
  readonly submissionKey: string;
  readonly writeExpiresAt: string;
  readonly receiptExpiresAt: string;
}
export interface CheckoutIssueRequest {
  readonly issueId: string;
  readonly submissionKey: string;
  readonly challenge: string;
  readonly renewSessionId?: string;
}
export function parseCheckoutIssue(value: unknown): CheckoutIssueRequest | undefined {
  const o = record(value);
  if (
    !o ||
    Object.keys(o).some(
      (k) => !["issueId", "submissionKey", "challenge", "renewSessionId"].includes(k),
    ) ||
    typeof o.issueId !== "string" ||
    !checkoutUuidPattern.test(o.issueId) ||
    typeof o.submissionKey !== "string" ||
    !checkoutSubmissionPattern.test(o.submissionKey) ||
    typeof o.challenge !== "string" ||
    !o.challenge.trim() ||
    o.challenge.length > 2048 ||
    (o.renewSessionId !== undefined &&
      (typeof o.renewSessionId !== "string" || !checkoutUuidPattern.test(o.renewSessionId)))
  )
    return;
  return o as unknown as CheckoutIssueRequest;
}
export function parseCheckoutIntent(value: unknown): CheckoutIntent | undefined {
  const o = record(value);
  if (
    !o ||
    Object.keys(o).sort().join() !==
      ["receiptExpiresAt", "sessionId", "submissionKey", "writeExpiresAt"].sort().join() ||
    typeof o.sessionId !== "string" ||
    !checkoutUuidPattern.test(o.sessionId) ||
    typeof o.submissionKey !== "string" ||
    !checkoutSubmissionPattern.test(o.submissionKey) ||
    typeof o.writeExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(o.writeExpiresAt)) ||
    typeof o.receiptExpiresAt !== "string" ||
    Date.parse(o.receiptExpiresAt) - Date.parse(o.writeExpiresAt) !== 60 * 60 * 1000
  )
    return;
  return o as unknown as CheckoutIntent;
}
export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
export function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && Object.keys(value).every((k) => keys.includes(k))
  );
}
export function validCheckoutSecret(value: string | undefined): value is string {
  if (!value) return false;
  const n = new TextEncoder().encode(value).byteLength;
  return n >= 32 && n <= 256;
}
function buffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function newCheckoutVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
export async function checkoutDigest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
async function hmacKey(secret: string, usage: "sign" | "verify") {
  if (!validCheckoutSecret(secret)) throw new Error("Unconfigured checkout secret");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}
export async function checkoutMac(secret: string, purpose: string, value: string): Promise<string> {
  return base64url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await hmacKey(secret, "sign"),
        new TextEncoder().encode(`${purpose}\n${value}`),
      ),
    ),
  );
}
export async function verifyCheckoutMac(
  secret: string,
  purpose: string,
  value: string,
  mac: string,
): Promise<boolean> {
  if (!checkoutVerifierPattern.test(mac)) return false;
  const bytes = Uint8Array.from(atob(mac.replaceAll("-", "+").replaceAll("_", "/") + "="), (c) =>
    c.charCodeAt(0),
  );
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    buffer(bytes),
    new TextEncoder().encode(`${purpose}\n${value}`),
  );
}
export interface CheckoutAttestation {
  readonly at: number;
  readonly nonce: string;
  readonly context: string | null;
  readonly freshContext: boolean;
  readonly network: readonly string[];
  readonly epoch: number;
}
/** Path includes query; signing the exact UTF-8 bytes prevents re-serialization ambiguity. */
export async function checkoutAttestationMessage(
  request: Request,
  body: string,
  a: CheckoutAttestation,
): Promise<string> {
  const u = new URL(request.url);
  return JSON.stringify([
    "v1",
    request.method,
    u.pathname + u.search,
    await checkoutDigest(body),
    a.at,
    a.nonce,
    a.context,
    a.freshContext,
    a.network,
    a.epoch,
  ]);
}
export async function signCheckoutRequest(
  request: Request,
  body: string,
  a: CheckoutAttestation,
  secret: string,
): Promise<Headers> {
  const headers = new Headers({ accept: "application/json" });
  if (request.method !== "GET") headers.set("content-type", "application/json");
  headers.set("x-provide-checkout", JSON.stringify(a));
  headers.set(
    "x-provide-checkout-mac",
    await checkoutMac(secret, "gateway-v1", await checkoutAttestationMessage(request, body, a)),
  );
  return headers;
}
export async function verifyCheckoutRequest(
  request: Request,
  body: string,
  secrets: readonly (string | undefined)[],
  now = Date.now(),
): Promise<CheckoutAttestation | undefined> {
  const raw = request.headers.get("x-provide-checkout");
  if (!raw || raw.length > 1024) return;
  let o: Record<string, unknown> | undefined;
  try {
    o = record(JSON.parse(raw));
  } catch {
    return;
  }
  if (
    !o ||
    !onlyKeys(o, ["at", "nonce", "context", "freshContext", "network", "epoch"]) ||
    typeof o.at !== "number" ||
    !Number.isSafeInteger(o.at) ||
    o.at > now + 2000 ||
    now - o.at > 30_000 ||
    typeof o.nonce !== "string" ||
    !checkoutUuidPattern.test(o.nonce) ||
    (o.context !== null &&
      (typeof o.context !== "string" || !checkoutHashPattern.test(o.context))) ||
    typeof o.freshContext !== "boolean" ||
    !Array.isArray(o.network) ||
    ![2, 4].includes(o.network.length) ||
    !o.network.every((n) => typeof n === "string" && checkoutHashPattern.test(n)) ||
    typeof o.epoch !== "number" ||
    o.epoch !== Math.floor(o.at / 600_000)
  )
    return;
  const a = o as unknown as CheckoutAttestation;
  const message = await checkoutAttestationMessage(request, body, a);
  let valid = false;
  for (const secret of secrets)
    if (validCheckoutSecret(secret))
      valid =
        (await verifyCheckoutMac(
          secret,
          "gateway-v1",
          message,
          request.headers.get("x-provide-checkout-mac") ?? "",
        )) || valid;
  return valid ? a : undefined;
}
export class CheckoutBodyError extends Error {
  constructor(readonly status: 400 | 413 | 415) {
    super("Invalid checkout body");
  }
}
export async function readCheckoutBody(
  request: Pick<Request, "headers" | "body">,
  maximum = 64 * 1024,
): Promise<string> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new CheckoutBodyError(415);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum))
    throw new CheckoutBodyError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new CheckoutBodyError(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new CheckoutBodyError(413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    JSON.parse(text);
    return text;
  } catch {
    throw new CheckoutBodyError(400);
  }
}
