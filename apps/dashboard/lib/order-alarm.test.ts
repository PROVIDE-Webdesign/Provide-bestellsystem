import { describe, expect, it } from "vitest";
import { acceptanceRemaining, createAlarmTracker } from "./order-alarm.js";
import type { DashboardAcceptance } from "@provide/contracts";
const snapshot: DashboardAcceptance = {
  restaurantId: "f2000000-0000-0000-0000-000000000001",
  locationId: "f3000000-0000-0000-0000-000000000001",
  serverNow: "2026-10-01T12:00:00Z",
  timeoutRule: "manual_review",
  totalPending: 1,
  orders: [
    {
      orderId: "fa000000-0000-0000-0000-000000000001",
      orderNumber: "BS-00000421",
      fulfillmentType: "pickup",
      deadline: "2026-10-01T12:05:00Z",
      escalatedAt: null,
    },
  ],
};
describe("acceptance alarm", () => {
  it("counts down from the server clock and shows the boundary as overdue", () => {
    expect(acceptanceRemaining(snapshot.orders[0]!.deadline, Date.parse(snapshot.serverNow))).toBe(
      "Annehmen in 5:00",
    );
    expect(
      acceptanceRemaining(snapshot.orders[0]!.deadline, Date.parse(snapshot.orders[0]!.deadline)),
    ).toBe("Annahmefrist überschritten");
  });
  it("never plays without explicit opt-in", () =>
    expect(createAlarmTracker()(snapshot, Date.parse(snapshot.serverNow), false)).toBe(false));
  it("deduplicates reloads and repeats overdue orders only every 30 seconds", () => {
    const tick = createAlarmTracker(),
      now = Date.parse(snapshot.serverNow);
    expect(tick(snapshot, now, true)).toBe(true);
    expect(tick(snapshot, now + 1, true)).toBe(false);
    expect(tick(snapshot, now + 300000, true)).toBe(true);
    expect(tick(snapshot, now + 329999, true)).toBe(false);
    expect(tick(snapshot, now + 330000, true)).toBe(true);
  });
  it("stops for empty snapshots and muted/background/stale snapshots", () => {
    const tick = createAlarmTracker(),
      now = Date.parse(snapshot.serverNow) + 300000;
    expect(tick(snapshot, now, false)).toBe(false);
    expect(tick({ ...snapshot, totalPending: 0, orders: [] }, now, true)).toBe(false);
  });
});
