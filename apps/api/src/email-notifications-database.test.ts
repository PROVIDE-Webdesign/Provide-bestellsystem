import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailSendJob } from "@provide/contracts";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("pg", () => ({
  Client: class {
    connect = vi.fn().mockResolvedValue(undefined);
    end = vi.fn().mockResolvedValue(undefined);
    query = query;
  },
}));
import { postgresEmailRepository } from "./email-notifications-database.js";

const lock = "fa100000-0000-0000-0000-000000000002";
const now = "2026-09-30T12:00:00Z";
const good: EmailSendJob = {
  deliveryId: "fa100000-0000-0000-0000-000000000001",
  lockToken: lock,
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
  requestedFor: "2026-09-30T18:00:00Z",
  confirmedFor: null,
  reasonCode: "unspecified",
  refundAmountMinor: null,
  currency: "EUR",
};
afterEach(() => query.mockReset());
function respond(batch: unknown, isolation = "dead_letter") {
  query.mockImplementation((sql: string) =>
    Promise.resolve({
      rows: sql.includes("claim_email_deliveries")
        ? [{ data: batch }]
        : sql.includes("finish_email_delivery")
          ? [{ data: isolation }]
          : [],
    }),
  );
}
describe("email claim transaction", () => {
  it("isolates an invalid send before committing; returns the other valid job", async () => {
    const bad = { ...good, deliveryId: "fa100000-0000-0000-0000-000000000004", email: "invalid" };
    respond([bad, good]);
    expect(await postgresEmailRepository.claim("synthetic", lock, 25, now)).toEqual([good]);
    const calls = query.mock.calls;
    const isolation = calls.findIndex(([sql]) => String(sql).includes("finish_email_delivery"));
    expect(calls[isolation]?.[1]).toEqual([bad.deliveryId, lock, now]);
    expect(calls.findIndex(([sql]) => sql === "COMMIT")).toBeGreaterThan(isolation);
    expect(calls.some(([sql]) => sql === "ROLLBACK")).toBe(false);
  });
  it("rolls back an untrusted claim identity without completing another lease", async () => {
    respond([{ ...good, lockToken: "fa100000-0000-0000-0000-000000000099" }]);
    await expect(postgresEmailRepository.claim("synthetic", lock, 25, now)).rejects.toThrow();
    expect(query.mock.calls.some(([sql]) => String(sql).includes("finish_email_delivery"))).toBe(
      false,
    );
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).not.toHaveBeenCalledWith("COMMIT");
  });
  it("rolls back if isolation loses its lease", async () => {
    respond([{ ...good, email: "invalid" }], "conflict");
    await expect(postgresEmailRepository.claim("synthetic", lock, 25, now)).rejects.toThrow();
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).not.toHaveBeenCalledWith("COMMIT");
  });
  it("reconciles using only the provider key components", async () => {
    const job = {
      deliveryId: good.deliveryId,
      lockToken: lock,
      mode: "reconcile",
      templateVersion: 1,
    };
    respond([job]);
    expect(await postgresEmailRepository.claim("synthetic", lock, 25, now)).toEqual([job]);
  });
});
