import { describe, expect, it } from "vitest";

import { parseNotificationDispatchBatch, parseNotificationDispatchJob } from "./notifications.js";

const job = {
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

describe("notification dispatch contracts", () => {
  it("accepts the exact bounded SMS job", () => {
    expect(parseNotificationDispatchJob(job)).toEqual(job);
    expect(parseNotificationDispatchBatch([job])).toEqual([job]);
  });

  it("rejects mismatched templates, extra fields and personal-data-shaped additions", () => {
    expect(parseNotificationDispatchJob({ ...job, templateKey: "order_accepted" })).toBeUndefined();
    expect(
      parseNotificationDispatchJob({ ...job, contactName: "Synthetic Guest" }),
    ).toBeUndefined();
  });

  it("rejects invalid destinations and unbounded batches", () => {
    expect(parseNotificationDispatchJob({ ...job, phoneE164: "0241 123" })).toBeUndefined();
    expect(parseNotificationDispatchBatch(Array.from({ length: 26 }, () => job))).toBeUndefined();
  });
});
