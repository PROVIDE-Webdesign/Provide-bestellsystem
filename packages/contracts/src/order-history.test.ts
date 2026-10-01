import { describe, it, expect } from "vitest";
import raw from "../../../fixtures/order-history.json" with { type: "json" };
import { parseHistoryQuery, parseHistoryCursor, parseOrderHistory } from "./order-history.js";
describe("history source and query contracts", () => {
  it("keeps nullable proof fields stable across API JSON serialization", () => {
    const once = parseOrderHistory(raw);
    expect(once?.purge).toBeNull();
    const again: unknown = JSON.parse(JSON.stringify(once));
    expect(parseOrderHistory(again)).toEqual(once);
  });
  it("uses real calendar dates and inclusive bounded date windows", () => {
    expect(parseHistoryQuery({ fromDate: "2026-01-01", toDate: "2026-04-03" })).toBeDefined();
    expect(parseHistoryQuery({ fromDate: "2026-01-01", toDate: "2026-04-04" })).toBeUndefined();
    expect(parseHistoryQuery({ fromDate: "2026-02-29", toDate: "2026-03-01" })).toBeUndefined();
    expect(parseHistoryQuery({ fromDate: "2026-10-02", toDate: "2026-10-01" })).toBeUndefined();
  });
  it.each([
    { actor: "forged" },
    { fromDate: "2026-10-01" },
    { customerName: "x" },
    { customerName: "Name\n" },
    { customerName: "a".repeat(81) },
    { status: "paid" },
    { fulfillmentType: "courier" },
    { limit: 51 },
    { orderNumber: "BS-0000" },
    { orderId: "foreign" },
    { cursor: "invalid" },
  ])("rejects invalid query %j", (q) => expect(parseHistoryQuery(q)).toBeUndefined());
  it("preserves timestamp microseconds for duplicate-free keyset pages", () => {
    const cursor = "2026-10-01T12:00:00.123456Z|fc000000-0000-0000-0000-000000000001";
    expect(parseHistoryCursor(cursor)?.createdAt).toBe("2026-10-01T12:00:00.123456Z");
    expect(parseHistoryCursor(cursor.replace("10-01", "02-30"))).toBeUndefined();
  });
  it("trims a literal name without wildcard reinterpretation", () =>
    expect(parseHistoryQuery({ customerName: "  %_  " })).toEqual({ customerName: "%_" }));
  it("accepts minimal source-verified response", () =>
    expect(parseOrderHistory(raw)).toBeDefined());
  it("rejects inconsistent counts, averages and refunds", () => {
    for (const changed of [
      { pickupCount: 2 },
      { averageCompletedMinor: 0 },
      { refundedMinor: 1 },
      { rejectionBasisPoints: 1 },
      { orderCount: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(
        parseOrderHistory({ ...raw, metrics: [{ ...raw.metrics[0], ...changed }] }),
      ).toBeUndefined();
  });
  it("rejects leaked data, cross-scope details and invalid clocks", () => {
    expect(parseOrderHistory({ ...raw, phone: "discard" })).toBeUndefined();
    expect(parseOrderHistory({ ...raw, serverNow: "yesterday" })).toBeUndefined();
    expect(parseOrderHistory({ ...raw, timezone: "not/a_zone" })).toBeUndefined();
    expect(
      parseOrderHistory({ ...raw, purge: { lastRunAt: raw.serverNow, purgedCount: 123 } }),
    ).toBeUndefined();
  });
});
