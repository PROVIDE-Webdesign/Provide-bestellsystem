import { describe, it, expect } from "vitest";
import { parseMenuImportBundle, menuImportReady } from "./menu-import.js";
import { parseMenuAdminCommand } from "./menu-admin.js";
import pending from "../../../docs/pilot/asian-kitchen-12-0-r1-pending.json" with { type: "json" };
import config from "../../../fixtures/menu-configuration.json" with { type: "json" };
describe("pilot import boundary", () => {
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
