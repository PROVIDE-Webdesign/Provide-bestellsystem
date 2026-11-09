import { DurableObject } from "cloudflare:workers";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const maxBodyBytes = 4096;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const events = new Set([
  "order.submitted.v1",
  "order.status_changed.v1",
  "order.accepted.v1",
  "order.rejected.v1",
  "payment.status_changed.v1",
  "menu.published.v1",
]);
const reply = (status) => new Response(null, { status, headers: { "cache-control": "no-store" } });
const uuid = (value) => typeof value === "string" && uuidPattern.test(value);
const hex = (bytes) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

async function readBody(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const buffer = new Uint8Array(maxBodyBytes);
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return buffer.subarray(0, length);
      if (length + value.length > maxBodyBytes) {
        await reader.cancel();
        return null;
      }
      buffer.set(value, length);
      length += value.length;
    }
  } finally {
    reader.releaseLock();
  }
}

function validEvent(event, eventId, env) {
  return (
    event?.eventId === eventId &&
    event.schemaVersion === 1 &&
    event.restaurantId === env.RESTAURANT_ID &&
    event.locationId === env.LOCATION_ID &&
    events.has(event.eventType) &&
    uuid(event.objectId) &&
    uuid(event.correlationId) &&
    typeof event.occurredAt === "string" &&
    isoPattern.test(event.occurredAt) &&
    Number.isFinite(Date.parse(event.occurredAt)) &&
    typeof event.data === "object" &&
    event.data !== null &&
    !Array.isArray(event.data)
  );
}

export class ReceiptLedger extends DurableObject {
  async fetch(request) {
    if (request.method === "GET") {
      const receipt = await this.ctx.storage.get("receipt");
      if (!receipt) return reply(404);
      return Response.json(receipt, { headers: { "cache-control": "no-store" } });
    }
    const receipt = await request.json();
    const accepted = await this.ctx.storage.transaction(async (storage) => {
      const existing = await storage.get("receipt");
      if (existing) return existing.digest === receipt.digest;
      await storage.put("receipt", receipt);
      return true;
    });
    return reply(accepted ? 204 : 409);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.search) return reply(404);
    const receiptPath = /^\/receipts\/([a-f0-9-]+)$/i.exec(url.pathname);
    if (request.method === "GET" && receiptPath && uuid(receiptPath[1])) {
      if (
        !env.RECEIPT_TOKEN ||
        request.headers.get("authorization") !== `Bearer ${env.RECEIPT_TOKEN}`
      ) {
        return reply(401);
      }
      const id = env.LEDGER.idFromName(receiptPath[1].toLowerCase());
      return env.LEDGER.get(id).fetch("https://receipt.internal/receipt");
    }
    if (request.method !== "POST" || url.pathname !== "/events") return reply(404);
    const eventId = request.headers.get("idempotency-key");
    const signature = /^t=(\d{10}),v1=([a-f0-9]{64})$/.exec(
      request.headers.get("x-provide-signature") ?? "",
    );
    if (
      !uuid(eventId) ||
      !signature ||
      Math.abs(Math.floor(Date.now() / 1000) - Number(signature[1])) > 300
    ) {
      return reply(401);
    }
    if (!env.SIGNING_SECRET || env.SIGNING_SECRET.length < 32) return reply(503);
    if (Number(request.headers.get("content-length")) > maxBodyBytes) return reply(413);
    const bytes = await readBody(request);
    if (bytes === null) return reply(413);
    let body;
    try {
      body = decoder.decode(bytes);
    } catch {
      return reply(400);
    }
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.SIGNING_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const proof = Uint8Array.from(signature[2].match(/../g), (pair) => Number.parseInt(pair, 16));
    if (
      !(await crypto.subtle.verify("HMAC", key, proof, encoder.encode(`${signature[1]}.${body}`)))
    ) {
      return reply(401);
    }
    let event;
    try {
      event = JSON.parse(body);
    } catch {
      return reply(400);
    }
    if (!validEvent(event, eventId, env)) return reply(422);
    const id = env.LEDGER.idFromName(eventId.toLowerCase());
    const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
    const receipt = { digest, eventType: event.eventType, receivedAt: new Date().toISOString() };
    return env.LEDGER.get(id).fetch("https://receipt.internal/receipt", {
      method: "POST",
      body: JSON.stringify(receipt),
    });
  },
};
