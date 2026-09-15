import type { StorefrontScope } from "@provide/contracts";

const encoder = new TextEncoder();
const minimumSecretBytes = 32;

function tokenMessage(scope: StorefrontScope, orderId: string): Uint8Array {
  return encoder.encode(
    ["provide-order-status-v1", scope.restaurantSlug, scope.locationSlug, orderId].join("\n"),
  );
}

function validSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && encoder.encode(secret).byteLength >= minimumSecretBytes;
}

function encodeBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return undefined;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=";
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

async function key(secret: string, usage: ("sign" | "verify")[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

export function hasValidStatusSecret(secret: string | undefined): secret is string {
  return validSecret(secret);
}

export async function createStatusAccessToken(
  secret: string,
  scope: StorefrontScope,
  orderId: string,
): Promise<string> {
  if (!validSecret(secret)) throw new Error("Status token secret is not configured");
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(secret, ["sign"]),
    tokenMessage(scope, orderId),
  );
  return encodeBase64Url(signature);
}

export async function verifyStatusAccessToken(
  token: string,
  secrets: readonly (string | undefined)[],
  scope: StorefrontScope,
  orderId: string,
): Promise<boolean> {
  const signature = decodeBase64Url(token);
  if (!signature) return false;
  let verified = false;
  for (const secret of secrets) {
    if (!validSecret(secret)) continue;
    const matches = await crypto.subtle.verify(
      "HMAC",
      await key(secret, ["verify"]),
      signature,
      tokenMessage(scope, orderId),
    );
    verified = matches || verified;
  }
  return verified;
}

export function statusAvailableUntil(requestedFor: string): string | undefined {
  const requested = Date.parse(requestedFor);
  if (!Number.isFinite(requested)) return undefined;
  return new Date(requested + 48 * 60 * 60 * 1000).toISOString();
}
