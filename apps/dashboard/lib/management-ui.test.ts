import { describe, it, expect } from "vitest";
import type {
  MenuAdminVersion,
  MenuDraftItem,
  MenuAdminState,
  LocationConfiguration,
} from "@provide/contracts";
import { countMenuChanges, menuItemAvailability, todayOpening } from "./management-ui.js";
const item: MenuDraftItem = {
  id: "one",
  name: "Gyoza",
  sectionKey: "starter",
  description: null,
  priceAmountMinor: 750,
  isActive: true,
  configuration: null,
};
const base: MenuAdminVersion = {
  id: "base",
  number: 1,
  revision: 1,
  status: "published",
  sections: [{ key: "starter", name: "Vorspeisen" }],
  items: [item],
};
const rules: LocationConfiguration = {
  minimumLeadMinutes: 15,
  maximumAdvanceDays: 14,
  slotIntervalMinutes: 15,
  defaultOrderCapacity: 10,
  defaultItemCapacity: 100,
  orderCutoffMinutes: 0,
  acceptanceMinutes: 5,
  maxOpenOrders: null,
  windows: [
    {
      fulfillment: "pickup",
      weekday: 5,
      opensAt: "12:00",
      closesAt: "22:00",
      orderCapacity: null,
      itemCapacity: null,
    },
  ],
  exceptions: [],
  zones: [],
};
describe("management summaries", () => {
  it("counts changed, removed and added dishes without turning an unchanged copy into changes", () => {
    const draft = { ...base, id: "draft", status: "draft" as const };
    expect(countMenuChanges(draft, base)).toBe(0);
    expect(countMenuChanges({ ...draft, items: [{ ...item, priceAmountMinor: 890 }] }, base)).toBe(
      1,
    );
    expect(countMenuChanges({ ...draft, items: [{ ...item, id: "new" }] }, base)).toBe(2);
  });
  it("distinguishes expired, partial and whole-dish availability in the correct menu", () => {
    const stop: MenuAdminState["stops"][number] = {
      menuId: "m",
      itemId: "one",
      choiceId: null,
      blocked: true,
      endsAt: "2026-11-06T11:00:00Z",
      reason: "Ausverkauft",
    };
    expect(menuItemAvailability(item, [stop], "m", Date.parse("2026-11-06T12:00:00Z"))).toBe(
      "Verfügbar",
    );
    expect(
      menuItemAvailability(item, [{ ...stop, endsAt: null, choiceId: "variant" }], "m", 0),
    ).toBe("Teilweise ausverkauft");
    expect(menuItemAvailability(item, [{ ...stop, endsAt: null }], "other", 0)).toBe("Verfügbar");
    expect(menuItemAvailability(item, [{ ...stop, endsAt: null }], "m", 0)).toBe("Ausverkauft");
  });
  it("applies a local-day closure instead of normal hours and uses the restaurant timezone", () => {
    const now = Date.parse("2026-11-05T23:30:00Z");
    expect(todayOpening(rules, "Europe/Berlin", now)).toBe("Heute 12:00–22:00");
    expect(
      todayOpening(
        {
          ...rules,
          exceptions: [
            {
              date: "2026-11-06",
              fulfillment: "pickup",
              closed: true,
              opensAt: null,
              closesAt: null,
              reason: "Feiertag",
              orderCapacity: null,
              itemCapacity: null,
            },
          ],
        },
        "Europe/Berlin",
        now,
      ),
    ).toBe("Heute geschlossen");
    expect(todayOpening(undefined, "Europe/Berlin", now)).toBe("Regeln ausstehend");
  });
});
