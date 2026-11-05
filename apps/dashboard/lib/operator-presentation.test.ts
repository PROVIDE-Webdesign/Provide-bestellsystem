import { describe, expect, it } from "vitest";
import type { DashboardOrderSummary } from "@provide/contracts";
import { operatorPayment, shortOrderNumber } from "./order-ui.js";
const order: DashboardOrderSummary = {
  orderId: "fa000000-0000-0000-0000-000000001042",
  orderNumber: "BS-00001042",
  status: "submitted",
  fulfillmentType: "pickup",
  paymentCollectionMode: "online",
  paymentState: "authorized",
  requestedFor: "2026-11-05T18:15:00Z",
  updatedAt: "2026-11-05T17:57:00Z",
  currency: "EUR",
  totalAmountMinor: 2740,
  itemCount: 2,
  allowedTransitions: ["accepted", "rejected"],
};
describe("operator order presentation", () => {
  it("preserves large database identities without number rounding", () => {
    expect(shortOrderNumber({ ...order, orderNumber: "BS-9223372036854775807" })).toBe(
      "9223372036854775807",
    );
    const { orderNumber, ...legacy } = order;
    expect(shortOrderNumber(legacy)).toBe(order.orderId);
  });
  it("distinguishes reserved and unsettled payments from paid orders", () => {
    expect(operatorPayment(order)).toBe("Zahlung reserviert");
    expect(operatorPayment({ ...order, paymentState: "capture_pending" })).toBe(
      "Abbuchung wird bestätigt",
    );
    expect(operatorPayment({ ...order, paymentState: "paid" })).toBe("Online bezahlt");
  });
  it("uses the correct collection label for deliveries", () => {
    expect(
      operatorPayment({
        ...order,
        paymentCollectionMode: "on_fulfillment",
        fulfillmentType: "delivery",
      }),
    ).toBe("Bei Lieferung zahlen");
  });
});
