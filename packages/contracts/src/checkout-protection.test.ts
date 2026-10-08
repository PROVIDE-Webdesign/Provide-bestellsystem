import { describe, expect, it } from "vitest";
import {
  checkoutDigest,
  checkoutMac,
  newCheckoutVerifier,
  parseCheckoutIntent,
  parseCheckoutIssue,
  readCheckoutBody,
  signCheckoutRequest,
  verifyCheckoutMac,
  verifyCheckoutRequest,
  type CheckoutAttestation,
} from "./checkout-protection.js";
const secret = "synthetic-o3-gateway-secret-32-bytes-minimum";
const a: CheckoutAttestation = {
  at: Date.now(),
  nonce: crypto.randomUUID(),
  context: "a".repeat(64),
  freshContext: false,
  network: ["b".repeat(64), "c".repeat(64)],
  epoch: Math.floor(Date.now() / 600000),
};
const intent = {
  sessionId: crypto.randomUUID(),
  submissionKey: crypto.randomUUID(),
  writeExpiresAt: "2026-10-08T11:30:00.000Z",
  receiptExpiresAt: "2026-10-08T12:30:00.000Z",
};
const issue = {
  issueId: crypto.randomUUID(),
  submissionKey: crypto.randomUUID(),
  challenge: "synthetic-challenge",
};
describe("O3 transport contract", () => {
  it("O3-T01/T08 generates 256-bit server verifiers and hashes, distinct from the public intent", async () => {
    const one = newCheckoutVerifier(),
      two = newCheckoutVerifier();
    expect(one).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(two).not.toBe(one);
    expect(await checkoutDigest(one)).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    { ...intent, verifier: "forged" },
    { ...intent, sessionId: "public-id" },
    { ...intent, receiptExpiresAt: intent.writeExpiresAt },
    null,
  ])("O3-T02/T18 rejects invalid intent metadata %j", (value) =>
    expect(parseCheckoutIntent(value)).toBeUndefined(),
  );
  it("O3-T04 accepts only the fixed write/receipt deadline relationship", () =>
    expect(parseCheckoutIntent(intent)).toEqual(intent));
  it.each([
    { ...issue, challenge: "" },
    { ...issue, challenge: "x".repeat(2049) },
    { ...issue, clientIp: "forged" },
    { ...issue, issueId: "not-a-uuid" },
  ])("O3-T34 rejects unsafe challenge request %j", (value) =>
    expect(parseCheckoutIssue(value)).toBeUndefined(),
  );
  it("O3-T20 validates the exact method, path, query, body and attested identity", async () => {
    const request = new Request("https://api.test/v1/storefront/a/b/orders", { method: "POST" });
    const body = '{"one":1}';
    const headers = await signCheckoutRequest(request, body, a, secret);
    expect(
      await verifyCheckoutRequest(new Request(request, { headers }), body, [secret], a.at),
    ).toEqual(a);
    for (const changed of [
      new Request(request, { method: "PUT", headers }),
      new Request(request.url + "?token=guess", { method: "POST", headers }),
      new Request(request.url.replace("/a/b/", "/a/c/"), { method: "POST", headers }),
    ])
      expect(await verifyCheckoutRequest(changed, body, [secret], a.at)).toBeUndefined();
    expect(
      await verifyCheckoutRequest(new Request(request, { headers }), body + " ", [secret], a.at),
    ).toBeUndefined();
    const mutated = new Headers(headers);
    mutated.set("x-provide-checkout", JSON.stringify({ ...a, context: "d".repeat(64) }));
    expect(
      await verifyCheckoutRequest(new Request(request, { headers: mutated }), body, [secret], a.at),
    ).toBeUndefined();
  });
  it("O3-T21 rejects expired/future timestamps exactly and accepts the previous gateway secret", async () => {
    const request = new Request("https://api.test/a", { method: "POST" });
    const headers = await signCheckoutRequest(request, "{}", a, secret);
    const signed = new Request(request, { headers });
    expect(
      await verifyCheckoutRequest(
        signed,
        "{}",
        ["different-long-secret-value-that-is-valid", secret],
        a.at,
      ),
    ).toEqual(a);
    expect(await verifyCheckoutRequest(signed, "{}", [secret], a.at + 30001)).toBeUndefined();
    expect(await verifyCheckoutRequest(signed, "{}", [secret], a.at - 2001)).toBeUndefined();
  });
  it("O3-T17/T24 purpose separates CSRF and gateway signatures", async () => {
    const mac = await checkoutMac(secret, "csrf-v1", a.context!);
    expect(await verifyCheckoutMac(secret, "csrf-v1", a.context!, mac)).toBe(true);
    expect(await verifyCheckoutMac(secret, "gateway-v1", a.context!, mac)).toBe(false);
  });
  it("O3-T18 cancels an oversized chunked body before consuming its tail", async () => {
    let cancelled = false;
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(c) {
        chunks++;
        c.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readCheckoutBody(
        { headers: new Headers({ "content-type": "application/json" }), body: stream },
        1024,
      ),
    ).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
    expect(chunks).toBeLessThanOrEqual(3);
  });
  it.each([new Uint8Array([0xff]), new TextEncoder().encode("{not-json}")])(
    "O3-T18 rejects invalid UTF-8/JSON",
    async (body) => {
      await expect(
        readCheckoutBody(
          new Request("https://a.test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: Uint8Array.from(body).buffer,
          }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it.each(["text/plain", "application/jsonp", "application/json;charset=latin1"])(
    "O3-T18 rejects media type %s",
    async (type) =>
      expect(
        readCheckoutBody(
          new Request("https://a.test", {
            method: "POST",
            headers: { "content-type": type },
            body: "{}",
          }),
        ),
      ).rejects.toMatchObject({ status: 415 }),
  );
});
