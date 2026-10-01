import { describe, it, expect } from "vitest";
import raw from "../../../fixtures/provide-admin.json" with { type: "json" };
import { parseProvideAdminCommand, parseProvideAdminState } from "./provide-admin.js";
const common = {
  restaurantId: raw.selected.restaurantId,
  locationId: null,
  expectedRevision: 10,
  requestId: "fa000000-0000-0000-0000-000000000001",
  reason: "Synthetic review",
};
const feature = {
  ...common,
  action: "feature",
  featureKey: "ordering.accept_orders",
  mode: "enabled",
  expiresAt: "2026-10-02T12:00:00.000Z",
};
describe("PROVIDE administration contracts", () => {
  it("accepts PostgreSQL RFC3339 microseconds without losing the original instant", () => {
    const state = { ...raw, serverNow: "2026-10-01T12:00:00.123456+00:00" };
    expect(parseProvideAdminState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
  it("preserves unknown configuration and nullable audit evidence through JSON", () => {
    expect(parseProvideAdminState(JSON.parse(JSON.stringify(raw)))).toEqual(raw);
    expect(parseProvideAdminState({ ...raw, selected: null })).toBeDefined();
  });
  it.each([
    { mode: ["enabled"] },
    { mode: "other" },
    { expiresAt: null },
    { reason: "short" },
    { reason: "Line\nAnother line" },
    { actorUserId: common.requestId },
    { expectedRevision: -1 },
    { expectedRevision: 1.5 },
    { expiresAt: "2026-10-02" },
    { featureKey: "unbounded" },
    { locationId: "other" },
  ])("rejects malformed or forged mutations %j", (patch) => {
    expect(parseProvideAdminCommand({ ...feature, ...patch })).toBeUndefined();
  });
  it("requires structured evidence and refuses actor claims on reads", () => {
    const q = {
      ...common,
      action: "check",
      checkKey: "restaurant.owner",
      status: "passed",
      evidenceKind: "test",
      evidenceReference: "fixture:owner",
    };
    expect(parseProvideAdminCommand(q)).toEqual(q);
    expect(parseProvideAdminCommand({ ...q, evidenceReference: null })).toBeUndefined();
    expect(
      parseProvideAdminCommand({ ...q, evidenceReference: "guest@example.invalid" }),
    ).toBeUndefined();
    expect(parseProvideAdminCommand({ ...q, status: ["passed"] })).toBeUndefined();
    expect(parseProvideAdminCommand({ action: "read", actor: common.requestId })).toBeUndefined();
    expect(
      parseProvideAdminCommand({ action: "read", locationId: common.requestId }),
    ).toBeUndefined();
  });
  it("rejects coercion and extra state fields", () => {
    expect(
      parseProvideAdminState({ ...raw, selected: { ...raw.selected, profileStatus: ["setup"] } }),
    ).toBeUndefined();
    expect(parseProvideAdminState({ ...raw, privateGrant: true })).toBeUndefined();
    expect(
      parseProvideAdminState({
        ...raw,
        selected: {
          ...raw.selected,
          features: [{ ...raw.selected.features[0], mode: ["enabled"] }],
        },
      }),
    ).toBeUndefined();
  });
  it("requires an explicit scope and revision for creation and rechecks", () => {
    expect(
      parseProvideAdminCommand({
        ...common,
        action: "reopen",
        checkKeys: ["restaurant.owner", "restaurant.owner"],
      }),
    ).toBeUndefined();
    expect(
      parseProvideAdminCommand({
        ...common,
        action: "critical",
        locationId: common.requestId,
        configuration: raw.selected.configuration,
      }),
    ).toBeUndefined();
    expect(
      parseProvideAdminCommand({
        ...common,
        action: "createRestaurant",
        displayName: "Testküche",
        slug: "test-kueche",
        timezone: "Europe/Berlin",
      }),
    ).toBeUndefined();
    expect(parseProvideAdminCommand(feature)).toEqual(feature);
  });
});
