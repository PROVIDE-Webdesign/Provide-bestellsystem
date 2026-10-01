import { describe, it, expect } from "vitest";
import config from "../../../fixtures/menu-configuration.json" with { type: "json" };
import { parseMenuAdminCommand, parseMenuAdminState } from "./menu-admin.js";
const menuId = "f4000000-0000-0000-0000-000000000001",
  versionId = "f5000000-0000-0000-0000-000000000001",
  id = "f6000000-0000-0000-0000-000000000001";
const item = {
  id,
  sectionKey: "dishes",
  name: "Synthetic",
  description: "Line one\nLine two",
  priceAmountMinor: 1250,
  isActive: true,
  configuration: config,
};
const command = {
  action: "save_draft",
  menuId,
  versionId,
  expectedRevision: 1,
  sections: [{ key: "dishes", name: "Dishes" }],
  items: [item],
};
describe("menu administration boundary", () => {
  it("keeps declared information and multiline descriptions", () =>
    expect(parseMenuAdminCommand(command)).toEqual(command));
  it.each([
    { ...command, actorUserId: id },
    { ...command, expectedRevision: -1 },
    { ...command, items: [item, { ...item, id: id.toUpperCase() }] },
    { ...command, sections: [{ key: "--bad", name: "Bad" }] },
    { ...command, items: [{ ...item, configuration: { ...config, informationConfirmed: false } }] },
    { ...command, items: [{ ...item, sectionKey: "foreign" }] },
  ])("rejects forged, stale-shape or incomplete edits", (value) =>
    expect(parseMenuAdminCommand(value)).toBeUndefined(),
  );
  it("projects a safe scoped state without private actor data", () => {
    const state = {
      timezone: "Europe/Berlin",
      stops: [],
      menus: [
        {
          id: menuId,
          name: "Synthetic",
          versions: [
            {
              id: versionId,
              number: 1,
              status: "draft",
              revision: 1,
              sections: command.sections,
              items: command.items,
            },
          ],
          publications: [],
        },
      ],
      actor: id,
    };
    expect(parseMenuAdminState(state)).not.toHaveProperty("actor");
    expect(parseMenuAdminState({ ...state, timezone: "not/a-zone" })).toBeUndefined();
  });
  it("accepts an empty new draft and rejects client clocks on a stop", () => {
    expect(
      parseMenuAdminState({
        timezone: "Europe/Berlin",
        stops: [],
        menus: [
          {
            id: menuId,
            name: "Synthetic",
            versions: [
              { id: versionId, number: 1, status: "draft", revision: 0, sections: [], items: [] },
            ],
            publications: [],
          },
        ],
      }),
    ).toBeDefined();
    expect(
      parseMenuAdminCommand({
        action: "stop",
        menuId,
        versionId,
        itemId: id,
        choiceId: null,
        blocked: true,
        endsAt: "2026-10-02T12:00:00",
        reason: "Synthetic",
      }),
    ).toBeUndefined();
  });
});
