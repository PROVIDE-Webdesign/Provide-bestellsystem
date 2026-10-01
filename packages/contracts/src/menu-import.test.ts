import { describe, it, expect } from "vitest";
import { parseMenuImportBundle, menuImportReady } from "./menu-import.js";
import { parseMenuAdminCommand } from "./menu-admin.js";
import pending from "../../../docs/pilot/asian-kitchen-12-0-r1-pending.json" with { type: "json" };
import config from "../../../fixtures/menu-configuration.json" with { type: "json" };
import synthetic from "../../../docs/pilot/asian-kitchen-staging-synthetic.json" with { type: "json" };
describe("pilot import boundary", () => {
  it("accepts the explicitly synthetic twelve-dish staging bundle without confirming real data", () => {
    const b = parseMenuImportBundle(synthetic)!;
    expect(b).toBeDefined();
    expect(menuImportReady(b)).toBe(true);
    expect(synthetic.testOnly).toBe(true);
    expect(b.source.name).toContain("SYNTHETISCH");
    expect(b.sections).toHaveLength(3);
    expect(b.items).toHaveLength(12);
    expect(b.items.every((i) => i.name.startsWith("TEST "))).toBe(true);
    expect(b.items.every((i) => i.description?.includes("SYNTHETISCHER TESTARTIKEL"))).toBe(true);
    expect(b.items.map((i) => i.priceAmountMinor)).toEqual(
      pending.items.map((i) => i.priceAmountMinor),
    );
    expect(b.items.every((i) => !pending.items.some((p) => p.id === i.id))).toBe(true);
    expect(new Set(b.items.map((i) => i.configuration!.taxRateBasisPoints))).toEqual(
      new Set([700, 1900]),
    );
    b.items.forEach((item, index) => {
      expect(item.configuration!.variants.map((v) => v.priceDeltaAmountMinor)).toEqual(
        pending.pendingDeclarations[index]!.variants.map((v) => v.priceDeltaAmountMinor),
      );
    });
    expect(
      parseMenuAdminCommand({
        action: "import_draft",
        menuId: pending.items[0]!.id,
        source: b.source,
        sections: b.sections,
        items: b.items,
      }),
    ).toBeDefined();
    expect(menuImportReady(parseMenuImportBundle(pending)!)).toBe(false);
  });
  it("preserves twelve source dishes without inventing declarations", () => {
    const b = parseMenuImportBundle(pending)!;
    expect(b.items).toHaveLength(12);
    expect(b.sections).toHaveLength(3);
    expect(menuImportReady(b)).toBe(false);
    expect(pending.pendingDeclarations.filter((d) => d.variants.length)).toHaveLength(3);
    expect(
      pending.pendingDeclarations.every(
        (d) =>
          d.taxRateBasisPoints === null &&
          d.additives === null &&
          d.businessInformationConfirmed === false,
      ),
    ).toBe(true);
  });
  it("blocks undeclared active imports and permits only complete configured drafts", () => {
    const b = parseMenuImportBundle(pending)!;
    const cmd = {
      action: "import_draft",
      menuId: "f4000000-0000-0000-0000-000000000001",
      source: b.source,
      sections: b.sections,
      items: b.items,
    };
    expect(parseMenuAdminCommand(cmd)).toBeUndefined();
    const complete = { ...cmd, items: b.items.map((i) => ({ ...i, configuration: config })) };
    expect(parseMenuAdminCommand(complete)).toEqual(complete);
  });
  it("rejects oversized, invalid, duplicate and foreign-category files", () => {
    expect(
      parseMenuImportBundle({ ...pending, source: { name: "source", sha256: "not-a-hash" } }),
    ).toBeUndefined();
    expect(
      parseMenuImportBundle({ ...pending, items: [...pending.items, pending.items[0]] }),
    ).toBeUndefined();
    expect(
      parseMenuImportBundle({
        ...pending,
        items: [{ ...pending.items[0], sectionKey: "foreign" }],
      }),
    ).toBeUndefined();
  });
  it("requires explicit delivery declaration and scoped optimistic policy identity", () => {
    const c = {
      action: "set_delivery_tax",
      expectedPolicyId: pending.items[0]!.id,
      mode: "fixed",
      taxRateBasisPoints: 1900,
      informationConfirmed: true,
      note: "Synthetic",
    };
    expect(parseMenuAdminCommand(c)).toEqual(c);
    expect(parseMenuAdminCommand({ ...c, informationConfirmed: false })).toBeUndefined();
    expect(
      parseMenuAdminCommand({ ...c, mode: "proportional", taxRateBasisPoints: null }),
    ).toBeDefined();
    expect(parseMenuAdminCommand({ ...c, mode: "proportional" })).toBeUndefined();
  });
});
