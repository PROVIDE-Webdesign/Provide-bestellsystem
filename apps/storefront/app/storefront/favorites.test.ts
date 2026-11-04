import { describe, expect, it } from "vitest";
import { favoritesKey, parseFavorites } from "./favorites";
describe("stored guest favorites", () => {
  it("isolates restaurants and locations", () => {
    const a = favoritesKey({restaurantSlug:"asian-kitchen", locationSlug:"mitte"});
    expect(a).not.toBe(favoritesKey({restaurantSlug:"other",locationSlug:"mitte"}));
    expect(a).not.toBe(favoritesKey({restaurantSlug:"asian-kitchen",locationSlug:"west"}));
    expect(favoritesKey({restaurantSlug:"../bad",locationSlug:"mitte"})).toBeUndefined();
  });
  it("tolerates malformed and unavailable browser storage", () => {
    for (const raw of [null, "{", "{}", '"dish-1"', "x".repeat(16001)]) expect(parseFavorites(raw)).toEqual([]);
  });
  it("keeps valid unique ids and rejects invalid values", () => {
    expect(parseFavorites(JSON.stringify(["dish-1", 3, null, "dish-1", "bad/path", "dish-2"]))).toEqual(["dish-1","dish-2"]);
  });
  it("bounds persisted data", () => {
    expect(parseFavorites(JSON.stringify(Array.from({length:150},(_,i)=>`dish-${i}`)))).toHaveLength(100);
  });
});
