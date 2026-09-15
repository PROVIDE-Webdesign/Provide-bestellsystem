import type { NotificationDispatchJob } from "@provide/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  dispatchOrderNotifications,
  renderOrderNotification,
  type NotificationAdapter,
  type NotificationRepository,
} from "./notifications.js";

const job: NotificationDispatchJob = {
  deliveryId: "fa000000-0000-0000-0000-000000000001",
  lockToken: "fa000000-0000-0000-0000-000000000002",
  orderId: "fa000000-0000-0000-0000-000000000003",
  channel: "sms",
  fulfillmentType: "pickup",
  templateKey: "order_ready",
  templateVersion: 1,
  targetStatus: "ready",
  restaurantName: "PROVIDE Testküche",
  requestedFor: "2026-09-15T18:00:00.000Z",
  locationTimezone: "Europe/Berlin",
  phoneE164: "+999100000001",
};

const env = {
  NOTIFICATION_DISPATCH_ENABLED: "true",
  HYPERDRIVE: { connectionString: "postgresql://synthetic.invalid/db" },
};

function dependencies(
  adapterResult: Awaited<ReturnType<NotificationAdapter["send"]>> = { outcome: "accepted" },
) {
  const claim = vi.fn<NotificationRepository["claim"]>().mockResolvedValue([job]);
  const finish = vi.fn<NotificationRepository["finish"]>().mockResolvedValue("sent");
  const send = vi.fn<NotificationAdapter["send"]>().mockResolvedValue(adapterResult);
  const repository: NotificationRepository = {
    claim,
    finish,
  };
  const adapter: NotificationAdapter = {
    configured: true,
    send,
  };
  const logger = { error: vi.fn() };
  return { repository, adapter, logger, claim, finish, send };
}

describe("order notification dispatch", () => {
  it("renders bounded transactional templates without identifiers or contact names", () => {
    for (const templateKey of [
      "order_submitted",
      "order_accepted",
      "order_rejected",
      "order_ready",
      "order_cancelled",
    ] as const) {
      const body = renderOrderNotification({
        ...job,
        templateKey,
        targetStatus: templateKey.replace("order_", "") as NotificationDispatchJob["targetStatus"],
      });
      expect(body).toContain("PROVIDE Testküche");
      expect(body.length).toBeLessThanOrEqual(320);
      expect(body).not.toContain(job.orderId);
      expect(body).not.toContain(job.phoneE164);
    }
  });

  it("does nothing while the feature is disabled", async () => {
    const { repository, adapter, logger, claim, send } = dependencies();
    await dispatchOrderNotifications(
      { ...env, NOTIFICATION_DISPATCH_ENABLED: "false" },
      repository,
      adapter,
      logger,
    );
    expect(claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("fails closed before claiming when no adapter is configured", async () => {
    const { repository, adapter, logger, claim } = dependencies();
    await dispatchOrderNotifications(env, repository, { ...adapter, configured: false }, logger);
    expect(claim).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Object),
      "notification_dispatch_unavailable",
    );
  });

  it("uses a stable non-personal idempotency key and completes an accepted message", async () => {
    const { repository, adapter, logger, finish, send } = dependencies();
    const now = vi.fn().mockReturnValue(new Date("2026-09-15T16:00:00.000Z"));
    await dispatchOrderNotifications(env, repository, adapter, logger, now);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      idempotencyKey: `notification:${job.deliveryId}:v1`,
      destination: job.phoneE164,
    });
    expect(send.mock.calls[0]?.[0].body).toContain("abholbereit");
    expect(finish).toHaveBeenCalledWith(
      env.HYPERDRIVE.connectionString,
      job.deliveryId,
      job.lockToken,
      { outcome: "accepted" },
      "2026-09-15T16:00:00.000Z",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("passes bounded adapter failures to the retry state machine", async () => {
    const { repository, adapter, logger, finish } = dependencies({
      outcome: "temporary_failure",
      code: "provider_timeout",
    });
    await dispatchOrderNotifications(env, repository, adapter, logger);
    expect(finish).toHaveBeenCalledWith(
      expect.any(String),
      job.deliveryId,
      job.lockToken,
      { outcome: "temporary_failure", code: "provider_timeout" },
      expect.any(String),
    );
  });

  it("converts thrown and malformed adapter results without logging personal data", async () => {
    const thrown = dependencies();
    thrown.send.mockRejectedValueOnce(new Error(job.phoneE164));
    await dispatchOrderNotifications(env, thrown.repository, thrown.adapter, thrown.logger);
    expect(thrown.finish).toHaveBeenCalledWith(
      expect.any(String),
      job.deliveryId,
      job.lockToken,
      { outcome: "temporary_failure", code: "adapter_request_failed" },
      expect.any(String),
    );
    expect(JSON.stringify(thrown.logger.error.mock.calls)).not.toContain(job.phoneE164);

    const malformed = dependencies({ outcome: "temporary_failure", code: job.phoneE164 });
    await dispatchOrderNotifications(
      env,
      malformed.repository,
      malformed.adapter,
      malformed.logger,
    );
    expect(malformed.finish).toHaveBeenCalledWith(
      expect.any(String),
      job.deliveryId,
      job.lockToken,
      { outcome: "permanent_failure", code: "invalid_adapter_result" },
      expect.any(String),
    );
  });
});
