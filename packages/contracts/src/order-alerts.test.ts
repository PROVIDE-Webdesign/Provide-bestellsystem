import { describe, expect, it } from "vitest";
import {
  orderLiveTopic,
  parseDashboardAcceptance,
  parseOrderInvalidation,
} from "./order-alerts.js";
const restaurantId = "f2000000-0000-0000-0000-000000000001",
  locationId = "f3000000-0000-0000-0000-000000000001";
const order = {
  orderId: "fa000000-0000-0000-0000-000000000001",
  orderNumber: "BS-00000421",
  fulfillmentType: "pickup",
  deadline: "2026-10-01T12:05:00Z",
  escalatedAt: null,
};
const snapshot = {
  restaurantId,
  locationId,
  serverNow: "2026-10-01T12:00:00Z",
  timeoutRule: "manual_review",
  totalPending: 1,
  orders: [order],
};
describe("private order signals", () => {
  it("canonicalizes scope and rejects malformed topics", () => {
    expect(orderLiveTopic(restaurantId.toUpperCase(), locationId)).toBe(
      `orders:v1:${restaurantId}:${locationId}`,
    );
    expect(() => orderLiveTopic("anything", locationId)).toThrow();
  });
  it("accepts only versioned minimal invalidations", () => {
    expect(parseOrderInvalidation({ schemaVersion: 1, id: order.orderId })).toBeDefined();
    for (const v of [
      { schemaVersion: 2, id: order.orderId },
      { schemaVersion: 1, id: order.orderId, customer: "PII" },
      { schemaVersion: 1, id: "x" },
      null,
    ])
      expect(parseOrderInvalidation(v)).toBeUndefined();
  });
  it("projects a PII-free acceptance snapshot", () => {
    expect(
      parseDashboardAcceptance({
        ...snapshot,
        customer: "hidden",
        orders: [{ ...order, email: "hidden" }],
      }),
    ).toEqual(snapshot);
  });
  it.each([
    { ...snapshot, serverNow: "2026-10-01T12:00" },
    { ...snapshot, totalPending: 0 },
    { ...snapshot, totalPending: 1.5 },
    { ...snapshot, timeoutRule: "auto_refund" },
    { ...snapshot, orders: [order, order] },
    { ...snapshot, orders: [{ ...order, deadline: "2026-02-30T12:00:00Z" }] },
    { ...snapshot, orders: [{ ...order, escalatedAt: "2026-10-01T12:04:00Z" }] },
    { ...snapshot, orders: Array.from({ length: 101 }, () => order) },
  ])("rejects incoherent acceptance data %#", (v) =>
    expect(parseDashboardAcceptance(v)).toBeUndefined(),
  );
});
