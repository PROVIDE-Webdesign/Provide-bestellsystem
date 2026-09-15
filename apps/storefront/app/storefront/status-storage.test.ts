import { describe, expect, it } from "vitest";
import { orderStatusStorageKey, parseStoredOrderStatusAccess } from "./status-storage";

const access = {
  orderId: "fa000000-0000-0000-0000-000000000001",
  statusAccessToken: "a".repeat(43),
  statusAvailableUntil: "2026-09-17T12:00:00.000Z",
};

describe("temporary order status storage", () => {
  it("uses a validated scope-specific key", () => {
    expect(
      orderStatusStorageKey({ restaurantSlug: "restaurant-a", locationSlug: "location-a" }),
    ).toBe("provide:order-status:v1:restaurant-a:location-a");
  });

  it("restores only an unexpired, PII-free capability", () => {
    expect(parseStoredOrderStatusAccess(JSON.stringify(access), Date.parse("2026-09-15"))).toEqual(
      access,
    );
    expect(
      parseStoredOrderStatusAccess(JSON.stringify(access), Date.parse("2026-09-18")),
    ).toBeUndefined();
    expect(
      parseStoredOrderStatusAccess(
        JSON.stringify({ ...access, contactName: "Synthetic Guest" }),
        Date.parse("2026-09-15"),
      ),
    ).toBeUndefined();
  });
});
