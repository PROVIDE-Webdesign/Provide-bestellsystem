import { describe, expect, it } from "vitest";

import {
  allowedOrderTransitions,
  parseDashboardOrderCursor,
  parseDashboardOrderDetail,
  parseDashboardOrderList,
  parseDashboardOrderStatusCommand,
  parseDashboardOrderStatusResult,
} from "./dashboard-orders.js";

const summary = {
  orderId: "f0000000-0000-0000-0000-000000000001",
  status: "submitted",
  fulfillmentType: "pickup",
  paymentCollectionMode: "on_fulfillment",
  requestedFor: "2026-09-15T18:00:00.000Z",
  currency: "EUR",
  totalAmountMinor: 2500,
  itemCount: 2,
  updatedAt: "2026-09-15T16:00:00.000Z",
  allowedTransitions: ["accepted", "rejected"],
};

describe("dashboard order contracts", () => {
  it("accepts a bounded order list and cursor", () => {
    const cursor = `${summary.requestedFor}|${summary.orderId}`;
    expect(parseDashboardOrderCursor(cursor)).toEqual({
      requestedFor: summary.requestedFor,
      orderId: summary.orderId,
    });
    expect(
      parseDashboardOrderList({
        restaurantId: "f2000000-0000-0000-0000-000000000001",
        locationId: "f3000000-0000-0000-0000-000000000001",
        orders: [summary],
        nextCursor: cursor,
      }),
    ).toBeDefined();
  });

  it("accepts minimal details and rejects personal-data expansion", () => {
    const detail = {
      ...summary,
      restaurantId: "f2000000-0000-0000-0000-000000000001",
      locationId: "f3000000-0000-0000-0000-000000000001",
      contactName: "Synthetic Guest",
      lines: [
        {
          lineNumber: 1,
          displayName: "Gemüsecurry",
          quantity: 2,
          unitPriceAmountMinor: 1250,
          lineAmountMinor: 2500,
        },
      ],
    };
    expect(parseDashboardOrderDetail(detail)).toBeDefined();
    expect(parseDashboardOrderDetail({ ...detail, phoneE164: "+999100000001" })).toBeUndefined();
    const deliveryDetail = {
      ...detail,
      fulfillmentType: "delivery",
      totalAmountMinor: 2850,
      deliveryFeeAmountMinor: 350,
      delivery: {
        recipientName: "Synthetic Guest",
        phoneE164: "+999100000001",
        addressLine1: "Synthetic Weg 1",
        addressLine2: null,
        postalCode: "52062",
        city: "Aachen",
        countryCode: "DE",
      },
    };
    expect(parseDashboardOrderDetail(deliveryDetail)?.delivery?.phoneE164).toBe("+999100000001");
    expect(
      parseDashboardOrderDetail({
        ...deliveryDetail,
        delivery: { ...deliveryDetail.delivery, phoneE164: "invalid" },
      }),
    ).toBeUndefined();
  });

  it("allows only a valid forward transition", () => {
    expect(
      parseDashboardOrderStatusCommand({ expectedStatus: "accepted", targetStatus: "preparing" }),
    ).toEqual({
      expectedStatus: "accepted",
      targetStatus: "preparing",
    });
    expect(
      parseDashboardOrderStatusCommand({ expectedStatus: "ready", targetStatus: "accepted" }),
    ).toBeUndefined();
    expect(allowedOrderTransitions("completed")).toEqual([]);
    expect(
      parseDashboardOrderStatusResult({
        orderId: summary.orderId,
        status: "preparing",
        updatedAt: summary.updatedAt,
      }),
    ).toBeDefined();
  });

  it("rejects malformed timestamps, totals and role-incompatible transition expansions", () => {
    expect(parseDashboardOrderList({ orders: [] })).toBeUndefined();
    expect(parseDashboardOrderCursor("not-a-cursor")).toBeUndefined();
    expect(
      parseDashboardOrderList({
        restaurantId: "f2000000-0000-0000-0000-000000000001",
        locationId: "f3000000-0000-0000-0000-000000000001",
        orders: [{ ...summary, allowedTransitions: ["completed"] }],
        nextCursor: null,
      }),
    ).toBeUndefined();
  });
});
