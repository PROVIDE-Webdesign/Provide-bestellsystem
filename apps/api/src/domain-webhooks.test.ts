import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { dispatchDomainWebhooks, domainWebhookEvents } from "./domain-webhooks.js";

const orderId = "fc980000-0000-0000-0000-000000000001";
const id = "fc990000-0000-0000-0000-000000000001";
const transitionId = "fc990000-0000-0000-0000-000000000002";
const restaurant = "f2000000-0000-0000-0000-000000000001";
const location = "f3000000-0000-0000-0000-000000000001";
const now = "2026-11-08T20:00:00Z";
const row = {
  id,
  restaurant_id: restaurant,
  aggregate_type: "order",
  aggregate_id: orderId,
  event_version: 1,
  created_at: now,
  event_type: "order.status_changed",
  payload: {
    event_id: transitionId,
    order_id: orderId,
    location_id: location,
    from_status: "submitted",
    to_status: "accepted",
    phone: "private-example",
  },
};
const env = {
  DOMAIN_WEBHOOK_ENABLED: "true",
  DOMAIN_WEBHOOK_URL: "https://webhook.test/events",
  DOMAIN_WEBHOOK_SIGNING_SECRET: "synthetic-domain-webhook-secret-32-bytes",
  DOMAIN_WEBHOOK_RESTAURANT_ID: restaurant,
  DOMAIN_WEBHOOK_ACTIVE_SINCE: now,
  HYPERDRIVE: { connectionString: "synthetic" },
  HYPERDRIVE_CACHE_DISABLED: "true",
};

describe("domain webhook dispatch", () => {
  it("projects versioned events without copying private payload fields", () => {
    expect(domainWebhookEvents(row)?.map((event) => [event.eventType, event.eventId])).toEqual([
      ["order.status_changed.v1", id],
      ["order.accepted.v1", transitionId],
    ]);
    expect(
      domainWebhookEvents({ ...row, payload: { ...row.payload, to_status: "rejected" } })?.[1]
        ?.eventType,
    ).toBe("order.rejected.v1");
    expect(
      domainWebhookEvents({
        ...row,
        event_type: "order.submitted",
        payload: { ...row.payload, status: "submitted", fulfillment_type: "pickup" },
      })?.[0]?.eventType,
    ).toBe("order.submitted.v1");
    expect(
      domainWebhookEvents({
        ...row,
        aggregate_type: "payment",
        event_type: "payment.status_changed",
        payload: {
          ...row.payload,
          payment_id: orderId,
          from_status: "captured",
          to_status: "partially_refunded",
        },
      })?.[0]?.eventType,
    ).toBe("payment.status_changed.v1");
    expect(
      domainWebhookEvents({
        ...row,
        aggregate_type: "menu",
        event_type: "menu.version.published",
        created_at: "2026-11-08T20:00:00.123456+00:00",
        payload: {
          ...row.payload,
          menu_version_id: transitionId,
          effective_at: "2026-11-08T20:00:00.345678+00:00",
        },
      })?.[0],
    ).toMatchObject({
      eventType: "menu.published.v1",
      occurredAt: "2026-11-08T20:00:00.123Z",
      data: { effectiveAt: "2026-11-08T20:00:00.345Z" },
    });
    expect(JSON.stringify(domainWebhookEvents(row))).not.toContain("private-example");
    expect(domainWebhookEvents({ ...row, event_version: 2 })).toBeUndefined();
    expect(
      domainWebhookEvents({ ...row, payload: { ...row.payload, order_id: "foreign" } }),
    ).toBeUndefined();
  });

  it("replays identical IDs and signatures after a lost acknowledgement", async () => {
    const repository = {
      claim: vi.fn().mockResolvedValue([row]),
      finish: vi.fn().mockResolvedValueOnce("retry").mockResolvedValueOnce("published"),
    };
    const logger = { error: vi.fn() };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("confirmation lost"))
      .mockResolvedValue(new Response(null, { status: 204 }));
    await dispatchDomainWebhooks(env, logger, repository, fetcher);
    await dispatchDomainWebhooks(env, logger, repository, fetcher);
    expect(repository.finish).toHaveBeenNthCalledWith(
      1,
      "synthetic",
      id,
      expect.any(String),
      "confirmation_unknown",
    );
    expect(repository.finish).toHaveBeenNthCalledWith(
      2,
      "synthetic",
      id,
      expect.any(String),
      "accepted",
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    const keys = fetcher.mock.calls.map(([, init]) => {
      const headers = new Headers(init?.headers);
      if (typeof init?.body !== "string") throw new Error("Missing signed JSON body");
      const sig = headers.get("x-provide-signature")!;
      const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig)!;
      expect(
        createHmac("sha256", env.DOMAIN_WEBHOOK_SIGNING_SECRET)
          .update(match[1] + "." + init.body)
          .digest("hex"),
      ).toBe(match[2]);
      expect(init?.redirect).toBe("manual");
      return headers.get("idempotency-key");
    });
    expect(keys).toEqual([id, id, transitionId]);
  });

  it("uses the configured receiver binding for signed calls", async () => {
    const repository = {
      claim: vi.fn().mockResolvedValue([row]),
      finish: vi.fn().mockResolvedValue("published"),
    };
    const fetcher = vi.fn<typeof fetch>();
    const boundFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await dispatchDomainWebhooks(
      { ...env, DOMAIN_WEBHOOK_RECEIVER: { fetch: boundFetch } },
      { error: vi.fn() },
      repository,
      fetcher,
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(boundFetch).toHaveBeenCalledTimes(2);
    expect(repository.finish).toHaveBeenCalledWith("synthetic", id, expect.any(String), "accepted");
  });

  it("does not send a foreign event and never claims while disabled", async () => {
    const repository = {
      claim: vi.fn().mockResolvedValue([{ ...row, restaurant_id: location }]),
      finish: vi.fn().mockResolvedValue("dead_letter"),
    };
    const fetcher = vi.fn<typeof fetch>();
    const logger = { error: vi.fn() };
    await dispatchDomainWebhooks(
      { ...env, DOMAIN_WEBHOOK_ENABLED: "false" },
      logger,
      repository,
      fetcher,
    );
    expect(repository.claim).not.toHaveBeenCalled();
    await dispatchDomainWebhooks(env, logger, repository, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(repository.finish).toHaveBeenCalledWith(
      "synthetic",
      id,
      expect.any(String),
      "invalid_event",
    );
  });
});
