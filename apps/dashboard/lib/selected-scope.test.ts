import { describe, it, expect } from "vitest";
import { parseDashboardAccessContext } from "@provide/contracts";
import { readSelectedScope, rememberSelectedScope } from "./selected-scope.js";
const scope = {
  restaurantId: "a2000000-0000-4000-8000-000000000001",
  locationId: "a3000000-0000-4000-8000-000000000001",
};
const context = parseDashboardAccessContext({
  aal: "aal1",
  memberships: [
    {
      restaurantId: scope.restaurantId,
      role: "owner",
      status: "active",
      access: "allowed",
      restaurant: { slug: "test", displayName: "Test" },
      locations: [{ id: scope.locationId, slug: "mitte", displayName: "Mitte" }],
    },
  ],
})!;
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
describe("saved dashboard scope", () => {
  it("restores the selected permitted location and clears it on logout", () => {
    const device = storage();
    rememberSelectedScope(scope, device);
    expect(readSelectedScope(context, device)).toEqual(scope);
    rememberSelectedScope(undefined, device);
    expect(readSelectedScope(context, device)).toBeUndefined();
  });
  it("never restores a scope without current membership", () => {
    const device = storage();
    rememberSelectedScope(scope, device);
    expect(readSelectedScope({ ...context, memberships: [] }, device)).toBeUndefined();
  });
  it("rejects a foreign location and malformed preference", () => {
    const device = storage();
    rememberSelectedScope({ ...scope, locationId: "foreign" }, device);
    expect(readSelectedScope(context, device)).toBeUndefined();
    expect(readSelectedScope(context, { getItem: () => "broken" })).toBeUndefined();
  });
  it("does not break the dashboard when storage is blocked", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    expect(readSelectedScope(context, { getItem: blocked })).toBeUndefined();
    expect(() =>
      rememberSelectedScope(scope, { setItem: blocked, removeItem: blocked }),
    ).not.toThrow();
  });
});
