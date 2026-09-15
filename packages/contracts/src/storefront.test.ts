import { describe, expect, it } from "vitest";
import { isExplicitInstant, isStorefrontScope, isAvailabilityQuery } from "./storefront.js";

const scope = { restaurantSlug: "test-restaurant", locationSlug: "mitte" };
describe("storefront input boundary", () => {
  it("accepts slugs but rejects tenant selectors disguised as paths or SQL", () => {
    expect(isStorefrontScope(scope)).toBe(true);
    for (const restaurantSlug of ["ab", "../test", "other/test", "TEST", "x'.OR.1", "a".repeat(64)])
      expect(isStorefrontScope({ ...scope, restaurantSlug })).toBe(false);
  });
  it.each(["2026-09-14T12:00:00Z", "2026-09-14T14:00:00+02:00", "2028-02-29T12:00:00.123Z"])(
    "accepts explicit instant %s",
    (value) => expect(isExplicitInstant(value)).toBe(true),
  );
  it.each([
    "2026-02-29T12:00:00Z",
    "2026-04-31T12:00:00Z",
    "2026-09-14T12:00",
    "2026-09-14T24:00:00Z",
    "2026-09-14T12:00:00+14:30",
    "infinity",
    "2026-13-14T12:00:00Z",
  ])("rejects ambiguous/invalid date %s", (value) => expect(isExplicitInstant(value)).toBe(false));
  it("accepts only whole item counts within the existing order boundary", () => {
    const query = {
      ...scope,
      fulfillmentType: "pickup" as const,
      requestedFor: "2026-09-14T12:00:00Z",
      itemCount: 1,
    };
    expect(isAvailabilityQuery(query)).toBe(true);
    for (const itemCount of [0, -1, 1.5, 1001, NaN, Infinity])
      expect(isAvailabilityQuery({ ...query, itemCount })).toBe(false);
  });
});
