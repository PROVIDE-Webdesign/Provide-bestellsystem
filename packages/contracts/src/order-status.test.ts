import { describe, expect, it } from "vitest";
import {
  parsePublicOrderStatus,
  parsePublicOrderStatusRequest,
  publicOrderStatuses,
} from "./order-status.js";

const token = "a".repeat(43);
const response = {
  orderId: "fa000000-0000-0000-0000-000000000001",
  status: "ready",
  fulfillmentType: "pickup",
  paymentCollectionMode: "on_fulfillment",
  requestedFor: "2026-09-15T12:00:00.000Z",
  currency: "EUR",
  totalAmountMinor: 2500,
  itemCount: 2,
  updatedAt: "2026-09-15T11:30:00.000Z",
  statusAvailableUntil: "2026-09-17T12:00:00.000Z",
};

describe("public order status contracts", () => {
  it("accepts only the capability request allowlist", () => {
    expect(
      parsePublicOrderStatusRequest({ orderId: response.orderId, statusAccessToken: token }),
    ).toEqual({ orderId: response.orderId, statusAccessToken: token });
    expect(
      parsePublicOrderStatusRequest({
        orderId: response.orderId,
        statusAccessToken: token,
        phone: "+999100000001",
      }),
    ).toBeUndefined();
  });

  it.each(["short", `${token}!`, ""])("rejects an invalid capability token", (value) => {
    expect(
      parsePublicOrderStatusRequest({ orderId: response.orderId, statusAccessToken: value }),
    ).toBeUndefined();
  });

  it.each(publicOrderStatuses)("reconstructs the public %s status allowlist", (status) => {
    expect(parsePublicOrderStatus({ ...response, status, actor: "hidden" })).toEqual({
      ...response,
      status,
    });
  });

  it("rejects personal or malformed output", () => {
    expect(parsePublicOrderStatus({ ...response, status: "unknown" })).toBeUndefined();
    expect(parsePublicOrderStatus({ ...response, totalAmountMinor: -1 })).toBeUndefined();
  });
});
