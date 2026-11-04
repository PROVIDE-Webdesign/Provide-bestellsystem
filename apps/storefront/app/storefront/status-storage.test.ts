import { describe, expect, it } from "vitest";
import {
  orderStatusStorageKey,
  readOrderHistory,
  saveOrderHistory,
  parseStoredOrderStatusAccess,
  parseEmailStatusFragment,
} from "./status-storage";

const access = {
  orderId: "fa000000-0000-0000-0000-000000000001",
  statusAccessToken: "a".repeat(43),
  statusAvailableUntil: "2026-09-17T12:00:00.000Z",
};

describe("temporary order status storage", () => {
  it("accepts an unexpired email fragment; rejects duplicate fields and expired capabilities", () => {
    const fragment = "#" + new URLSearchParams(access).toString();
    expect(parseEmailStatusFragment(fragment, Date.parse("2026-09-16T12:00:00Z"))).toEqual(access);
    expect(
      parseEmailStatusFragment(
        fragment + "&orderId=" + access.orderId,
        Date.parse("2026-09-16T12:00:00Z"),
      ),
    ).toBeUndefined();
    expect(parseEmailStatusFragment(fragment, Date.parse("2026-09-18T12:00:00Z"))).toBeUndefined();
  });
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

it("restores multiple orders in a new tab and removes expired access per location", () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  } as Storage;
  const key = orderStatusStorageKey({
    restaurantSlug: "restaurant-a",
    locationSlug: "location-a",
  })!;
  const future = new Date(Date.now() + 60_000).toISOString();
  const first = { ...access, orderNumber: "BS-00000001", statusAvailableUntil: future };
  const second = {
    ...first,
    orderId: "fa000000-0000-0000-0000-000000000002",
    orderNumber: "BS-00000002",
  };
  saveOrderHistory(storage, key, first);
  saveOrderHistory(storage, key, second);
  expect(readOrderHistory(storage, key)).toEqual([second, first]);
  expect(readOrderHistory(storage, key + "-other")).toEqual([]);
  expect(readOrderHistory(storage, key, Date.parse(future))).toEqual([]);
  expect(entries.size).toBe(0);
});
