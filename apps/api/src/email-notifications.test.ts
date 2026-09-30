import { describe, expect, it, vi } from "vitest";
import { parseEmailDispatchJob, type EmailSendJob } from "@provide/contracts";
import {
  dispatchEmailNotifications,
  renderEmailNotification,
  type EmailRepository,
  type EmailAdapter,
} from "./email-notifications.js";
import { createSyntheticEmailAdapter } from "./synthetic-email.js";
import { verifyStatusAccessToken } from "./status-token.js";
const job: EmailSendJob = {
  deliveryId: "fa100000-0000-0000-0000-000000000001",
  lockToken: "fa100000-0000-0000-0000-000000000002",
  orderId: "fa100000-0000-0000-0000-000000000003",
  mode: "send",
  templateKey: "order_submitted",
  templateVersion: 1,
  restaurantSlug: "test-restaurant",
  locationSlug: "test-location",
  restaurantName: "Testküche",
  pickupLocation: "Testweg 1",
  locationTimezone: "Europe/Berlin",
  fulfillmentType: "pickup",
  email: "synthetic@example.invalid",
  requestedFor: "2026-09-30T18:00:00.000Z",
  confirmedFor: null,
  reasonCode: "unspecified",
  refundAmountMinor: null,
  currency: "EUR",
};
const env = {
  EMAIL_DISPATCH_ENABLED: "true",
  EMAIL_STOREFRONT_ORIGIN: "https://store.test",
  ORDER_STATUS_TOKEN_SECRET: "synthetic-email-secret-with-at-least-32-bytes",
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "synthetic" },
};
describe("transactional email worker", () => {
  function setup() {
    const repo: EmailRepository = {
      claim: vi.fn().mockResolvedValue([job]),
      finish: vi.fn().mockResolvedValue("accepted"),
    };
    const adapter: EmailAdapter = {
      configured: true,
      send: vi.fn().mockResolvedValue({ outcome: "accepted", reference: "synthetic-1" }),
      lookup: vi.fn().mockResolvedValue({ outcome: "not_found" }),
    };
    return { repo, adapter, logger: { error: vi.fn() } };
  }
  it("validates its scoped event projection", () => {
    expect(parseEmailDispatchJob(job)).toEqual(job);
    for (const bad of [
      { ...job, extra: true },
      { ...job, restaurantSlug: undefined },
      { ...job, email: "guest\r\n@example.invalid" },
      { ...job, locationTimezone: "Invalid/Zone" },
      { ...job, templateKey: "order_accepted" },
      { ...job, templateKey: "order_refunded" },
      { ...job, templateKey: "order_dispatched" },
    ])
      expect(parseEmailDispatchJob(bad)).toBeUndefined();
  });
  it("renders a scoped status capability in the fragment", async () => {
    const s = setup();
    await dispatchEmailNotifications(env, s.repo, s.adapter, s.logger);
    const message = vi.mocked(s.adapter.send).mock.calls[0]![0];
    const url = new URL(message.text.split("Aktueller Stand: ")[1]!);
    expect(url.origin).toBe(env.EMAIL_STOREFRONT_ORIGIN);
    expect(url.search).toBe("");
    const hash = new URLSearchParams(url.hash.slice(1));
    expect(
      await verifyStatusAccessToken(
        hash.get("statusAccessToken")!,
        [env.ORDER_STATUS_TOKEN_SECRET],
        job,
        job.orderId,
      ),
    ).toBe(true);
    expect(message.html).toContain("Eine Annahmebestätigung folgt separat.");
    expect(s.logger.error).not.toHaveBeenCalled();
    expect(s.repo.finish).toHaveBeenCalledWith(
      "synthetic",
      job.deliveryId,
      job.lockToken,
      { outcome: "accepted", reference: "synthetic-1" },
      expect.any(String),
    );
  });
  it.each(["", "false"])("does not claim while gated off", async (value) => {
    const s = setup();
    await dispatchEmailNotifications(
      { ...env, EMAIL_DISPATCH_ENABLED: value },
      s.repo,
      s.adapter,
      s.logger,
    );
    expect(s.repo.claim).not.toHaveBeenCalled();
  });
  it.each([
    "http://store.test",
    "https://store.test/path",
    "https://user:pass@store.test",
    "https://store.test?token=x",
  ])("rejects unsafe configuration before claim", async (value) => {
    const s = setup();
    await dispatchEmailNotifications(
      { ...env, EMAIL_STOREFRONT_ORIGIN: value },
      s.repo,
      s.adapter,
      s.logger,
    );
    expect(s.repo.claim).not.toHaveBeenCalled();
  });
  it("reconciles an unknown acceptance without a second send", async () => {
    const s = setup();
    const reconcile = {
      deliveryId: job.deliveryId,
      lockToken: job.lockToken,
      templateVersion: 1 as const,
      mode: "reconcile" as const,
    };
    expect(parseEmailDispatchJob(reconcile)).toEqual(reconcile);
    expect(parseEmailDispatchJob({ ...reconcile, email: job.email })).toBeUndefined();
    vi.mocked(s.repo.claim).mockResolvedValue([reconcile]);
    vi.mocked(s.adapter.lookup).mockResolvedValue({
      outcome: "accepted",
      reference: "previous-send",
    });
    await dispatchEmailNotifications(env, s.repo, s.adapter, s.logger);
    expect(s.adapter.send).not.toHaveBeenCalled();
    expect(s.adapter.lookup).toHaveBeenCalledWith(`email:${job.deliveryId}:v1`);
  });
  it("treats a throw or invalid result as unknown; logs no customer data", async () => {
    const s = setup();
    vi.mocked(s.adapter.send).mockRejectedValue(
      new Error("synthetic@example.invalid secret-token"),
    );
    await dispatchEmailNotifications(env, s.repo, s.adapter, s.logger);
    expect(s.repo.finish).toHaveBeenCalledWith(
      "synthetic",
      job.deliveryId,
      job.lockToken,
      { outcome: "unknown", code: "adapter_request_failed" },
      expect.any(String),
    );
    expect(JSON.stringify(s.logger.error.mock.calls)).not.toContain("synthetic@example.invalid");
    vi.mocked(s.adapter.send).mockResolvedValue({ outcome: "accepted", reference: "\r\n" });
    await dispatchEmailNotifications(env, s.repo, s.adapter, s.logger);
    expect(s.repo.finish).toHaveBeenLastCalledWith(
      "synthetic",
      job.deliveryId,
      job.lockToken,
      { outcome: "unknown", code: "invalid_adapter_result" },
      expect.any(String),
    );
  });
  it("does not start the next send after a slow request exhausts the batch lease", async () => {
    const s = setup();
    let clock = Date.parse("2026-09-30T12:00:00Z");
    vi.mocked(s.repo.claim).mockResolvedValue([
      job,
      { ...job, deliveryId: "fa100000-0000-0000-0000-000000000004" },
    ]);
    vi.mocked(s.adapter.send).mockImplementation(() => {
      clock += 5 * 60 * 1000;
      return Promise.resolve({ outcome: "accepted", reference: "slow-first-send" });
    });
    await dispatchEmailNotifications(env, s.repo, s.adapter, s.logger, () => new Date(clock));
    expect(s.adapter.send).toHaveBeenCalledTimes(1);
    expect(s.repo.finish).toHaveBeenCalledTimes(1);
  });
  it("escapes HTML, uses confirmed time and omits full delivery addresses", () => {
    const m = renderEmailNotification(
      { ...job, templateKey: "order_submitted", restaurantName: "<script>x</script>" },
      "https://store.test/#x",
    );
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).not.toContain("<script>");
    const delivery = renderEmailNotification(
      {
        ...job,
        fulfillmentType: "delivery",
        templateKey: "order_accepted",
        confirmedFor: "2026-09-30T18:45:00Z",
      },
      "https://store.test/#x",
    );
    expect(delivery.text).toContain("20:45");
    expect(delivery.text).not.toContain("Testweg");
  });
  it("distinguishes readiness, dispatch, time correction and confirmed refund", () => {
    const link = "https://store.test";
    expect(
      renderEmailNotification(
        { ...job, templateKey: "order_refunded", refundAmountMinor: 1700 },
        link,
      ).text,
    ).toContain("17,00");
    expect(renderEmailNotification({ ...job, templateKey: "order_ready" }, link).text).toContain(
      "Abholung",
    );
    expect(
      renderEmailNotification(
        { ...job, templateKey: "order_dispatched", fulfillmentType: "delivery" },
        link,
      ).text,
    ).toContain("unterwegs");
    expect(
      renderEmailNotification(
        { ...job, templateKey: "order_time_changed", confirmedFor: "2026-09-30T18:45:00Z" },
        link,
      ).text,
    ).toContain("geändert auf");
  });
  it("synthetic adapter is idempotent and refuses real destinations", async () => {
    const adapter = createSyntheticEmailAdapter();
    const command = {
      ...renderEmailNotification(job, "https://store.test"),
      destination: job.email,
      idempotencyKey: "test",
    };
    expect(await adapter.send(command)).toEqual(await adapter.send(command));
    expect(adapter.acceptedCount()).toBe(1);
    expect(await adapter.lookup("test")).toEqual({
      outcome: "accepted",
      reference: "synthetic-email-1",
    });
    expect(
      await adapter.send({ ...command, destination: "real@example.com", idempotencyKey: "real" }),
    ).toMatchObject({ outcome: "permanent_failure" });
  });
});
