import { describe, expect, it } from "vitest";
import { CheckoutClient } from "./checkout-client";
const base = "/api/storefront/restaurant/location";
const issuedAt = Date.now();
const intent = {
  sessionId: crypto.randomUUID(),
  submissionKey: crypto.randomUUID(),
  writeExpiresAt: new Date(issuedAt + 1800000).toISOString(),
  receiptExpiresAt: new Date(issuedAt + 5400000).toISOString(),
};
function store(seed: string | null = null): Storage {
  const m = new Map<string, string>();
  if (seed) m.set(`provide-checkout-intent:${base}`, seed);
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (n) => [...m.keys()][n] ?? null,
    removeItem: (k) => {
      m.delete(k);
    },
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}
function setup(storage: Storage = store()) {
  const requests: { url: string; body: string }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const body = typeof init?.body === "string" ? init.body : "";
    requests.push({ url, body });
    return Promise.resolve(
      Response.json(
        {
          data: url.endsWith("checkout-context")
            ? { ready: true, csrf: "a".repeat(43) }
            : url.endsWith("checkout-session")
              ? intent
              : url.endsWith("checkout-receipt")
                ? { state: "unsubmitted" }
                : { orderId: crypto.randomUUID() },
        },
        { status: url.endsWith("orders") ? 201 : 200 },
      ),
    );
  };
  return { client: new CheckoutClient(base, fetcher, storage), requests, storage };
}
describe("O3 client recovery state (unit)", () => {
  it.each(["order-status", "payment-session"])(
    "O3-T46 %s retains its capability after cookie expiry without issuing an intent",
    async (resource) => {
      const calls: { resource: string; body: string; csrf: string | null }[] = [];
      let boots = 0,
        attempts = 0;
      const body = JSON.stringify({
        orderId: crypto.randomUUID(),
        accessToken: "synthetic-capability",
        paymentDeadline: "2026-10-08T22:00:00Z",
      });
      const fetcher: typeof fetch = (input, init) => {
        const name = (input instanceof Request ? input.url : input.toString()).split("/").at(-1)!;
        calls.push({
          resource: name,
          body: typeof init?.body === "string" ? init.body : "",
          csrf: new Headers(init?.headers).get("x-provide-checkout-csrf"),
        });
        if (name === "checkout-context")
          return Promise.resolve(
            Response.json({ data: { ready: true, csrf: (++boots === 1 ? "a" : "b").repeat(43) } }),
          );
        return Promise.resolve(
          ++attempts === 1
            ? Response.json({ error: { code: "checkout_session_expired" } }, { status: 410 })
            : Response.json({ data: { ready: true } }),
        );
      };
      const client = new CheckoutClient(base, fetcher, store());
      expect(
        (
          await client.request(resource, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          })
        ).status,
      ).toBe(200);
      expect(calls.map((c) => c.resource)).toEqual([
        "checkout-context",
        resource,
        "checkout-context",
        resource,
      ]);
      expect(calls.filter((c) => c.resource === resource).map((c) => c.body)).toEqual([body, body]);
      expect(calls[1]?.csrf).toBe("a".repeat(43));
      expect(calls[3]?.csrf).toBe("b".repeat(43));
      expect(client.currentIntent).toBeNull();
    },
  );
  it.each(["orders", "checkout-receipt", "cart-quote"])(
    "O3-T40/T46 %s never retries or renews after cookie expiry",
    async (resource) => {
      const calls: string[] = [];
      const fetcher: typeof fetch = (input) => {
        const name = (input instanceof Request ? input.url : input.toString()).split("/").at(-1)!;
        calls.push(name);
        return Promise.resolve(
          name === "checkout-context"
            ? Response.json({ data: { ready: true, csrf: "a".repeat(43) } })
            : Response.json({ error: { code: "checkout_session_expired" } }, { status: 410 }),
        );
      };
      const client = new CheckoutClient(base, fetcher, store());
      expect((await client.request(resource, { method: "POST", body: "{}" })).status).toBe(410);
      expect(calls).toEqual(["checkout-context", resource]);
    },
  );
  it("O3-T39 browser fetch is invoked with its global receiver", async () => {
    const fetcher: typeof fetch = function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(Response.json({ data: { ready: true, csrf: "a".repeat(43) } }));
    };
    await new CheckoutClient(base, fetcher, store()).bootstrap();
  });
  it("O3-T41 missing public metadata warns about a scoped existing intent without automatic issue or submit", async () => {
    let calls = 0;
    const fetcher: typeof fetch = () => {
      calls++;
      return Promise.resolve(
        Response.json({ data: { ready: true, csrf: "a".repeat(43), hasExistingIntents: true } }),
      );
    };
    const client = new CheckoutClient(base, fetcher, store());
    await client.bootstrap();
    expect(client.missingMetadataWarning).toBe(true);
    expect(client.persistenceWarning).toBe(true);
    expect(client.currentIntent).toBeNull();
    expect(calls).toBe(1);
  });
  it("O3-T40 reload reads the existing intent before any write, with no repeated contacts", async () => {
    const x = setup(store(JSON.stringify({ scope: base, intent })));
    expect(x.client.needsReceipt).toBe(true);
    await expect(
      x.client.submit("orders", { customer: { contactName: "Synthetic" } }),
    ).rejects.toMatchObject({ code: "checkout_result_unknown" });
    expect(x.requests).toHaveLength(0);
    await x.client.receipt();
    expect(x.requests.at(-1)?.body).toBe(
      JSON.stringify({ sessionId: intent.sessionId, submissionKey: intent.submissionKey }),
    );
    expect(x.client.needsReceipt).toBe(false);
  });
  it("O3-T09/T40 an attempted write locks further submission until receipt verification", async () => {
    const x = setup();
    await x.client.issue("challenge", crypto.randomUUID());
    await x.client.submit("orders", {
      submissionKey: "client-change",
      customer: { contactName: "Synthetic" },
    });
    expect(x.client.needsReceipt).toBe(true);
    const count = x.requests.length;
    await expect(x.client.submit("orders", {})).rejects.toMatchObject({ status: 409 });
    expect(x.requests).toHaveLength(count);
    expect(JSON.parse(x.requests.at(-1)!.body)).toMatchObject({
      command: { submissionKey: intent.submissionKey },
    });
  });
  it("O3-T35 uncertain issue retries preserve the exact provider UUID, challenge and key", async () => {
    const bodies: string[] = [];
    let fail = true;
    const fetcher: typeof fetch = (input, init) => {
      if ((input instanceof Request ? input.url : input.toString()).endsWith("checkout-context"))
        return Promise.resolve(Response.json({ data: { ready: true, csrf: "a".repeat(43) } }));
      bodies.push(typeof init?.body === "string" ? init.body : "");
      if (fail) {
        fail = false;
        return Promise.reject(Error("lost response"));
      }
      return Promise.resolve(Response.json({ data: intent }));
    };
    const client = new CheckoutClient(base, fetcher, store());
    const issue = crypto.randomUUID();
    await expect(client.issue("challenge", issue)).rejects.toThrow();
    await client.issue("challenge", issue);
    expect(bodies[1]).toBe(bodies[0]);
  });
  it("O3-T41/T49 public metadata contains no customer, address, verifier, token or CSRF", async () => {
    const x = setup();
    await x.client.issue("raw-challenge", crypto.randomUUID());
    await x.client.submit("orders", {
      customer: { contactName: "Synthetic Guest", email: "synthetic@example.invalid" },
      delivery: { addressLine1: "Testweg" },
    });
    const saved = x.storage.getItem(x.client.storageKey)!;
    expect(JSON.parse(saved)).toEqual({ scope: base, intent });
    for (const forbidden of [
      "Synthetic Guest",
      "synthetic@example.invalid",
      "Testweg",
      "raw-challenge",
      "csrf",
      "verifier",
    ])
      expect(saved).not.toContain(forbidden);
  });
  it("O3-T41 corrupt metadata preserves an explicit warning and cannot auto-submit", async () => {
    const x = setup(store("{corrupt"));
    expect(x.client.persistenceWarning).toBe(true);
    expect(x.client.needsReceipt).toBe(true);
    await expect(x.client.submit("orders", {})).rejects.toMatchObject({ status: 409 });
    expect(x.requests).toHaveLength(0);
  });
  it("O3-T41 throwing sessionStorage keeps a new in-memory intent without persisting secrets", async () => {
    const blocked = store();
    blocked.getItem = () => {
      throw Error("blocked");
    };
    blocked.setItem = () => {
      throw Error("blocked");
    };
    const x = setup(blocked);
    await x.client.issue("challenge", crypto.randomUUID());
    expect(x.client.currentIntent).toEqual(intent);
    expect(x.client.persistenceWarning).toBe(true);
  });
  it("O3-T42 scopes cannot restore each other's public metadata", () => {
    const x = setup(store(JSON.stringify({ scope: "/other", intent })));
    expect(x.client.currentIntent).toBeNull();
    expect(x.client.needsReceipt).toBe(true);
  });
  it("O3-T43 parses a bounded 429 delay, completes only explicitly and removes old intent metadata", async () => {
    const x = setup();
    const error = await x.client.error(
      Response.json(
        { error: { code: "rate_limited" } },
        { status: 429, headers: { "retry-after": "10" } },
      ),
    );
    expect(error.retryAfter).toBe(10);
    expect(error.message).toContain("10 Sekunden");
    await x.client.issue("challenge", crypto.randomUUID());
    x.client.complete();
    expect(x.client.currentIntent).toBeNull();
    expect(x.storage.getItem(x.client.storageKey)).toBeNull();
  });
});
