import { describe, it, expect } from "vitest";
import {
  parseLocationConfiguration,
  parseLocationOperationsCommand,
  parseLocationOperationsState,
} from "./location-operations.js";
const id = "f8000000-0000-0000-0000-000000000001";
export const config = {
  minimumLeadMinutes: 15,
  maximumAdvanceDays: 14,
  slotIntervalMinutes: 15,
  defaultOrderCapacity: 10,
  defaultItemCapacity: 50,
  orderCutoffMinutes: 0,
  acceptanceMinutes: 5,
  maxOpenOrders: null,
  windows: [
    {
      fulfillment: "pickup",
      weekday: 1,
      opensAt: "12:00",
      closesAt: "22:00",
      orderCapacity: null,
      itemCapacity: null,
    },
  ],
  exceptions: [],
  zones: [{ postalCodes: ["52062"], minimumAmountMinor: 1500, feeAmountMinor: 200 }],
};
describe("location operation contracts", () => {
  it("validates a complete scoped draft and rejects actor injection", () => {
    const c = {
      action: "save_draft",
      versionId: id,
      expectedRevision: 0,
      configuration: config,
      reason: "Synthetic change",
    };
    expect(parseLocationOperationsCommand(c)).toEqual(c);
    expect(parseLocationOperationsCommand({ ...c, actorId: id })).toBeUndefined();
  });
  it.each([
    { minimumLeadMinutes: -1 },
    { maximumAdvanceDays: 0 },
    { slotIntervalMinutes: 7 },
    { defaultOrderCapacity: 0 },
    { acceptanceMinutes: 61 },
    { maxOpenOrders: 1.5 },
    { defaultOrderCapacity: null, defaultItemCapacity: null },
  ])("rejects invalid operating limits %j", (change) =>
    expect(parseLocationConfiguration({ ...config, ...change })).toBeUndefined(),
  );
  it("rejects duplicate or overlapping delivery areas and fractional money", () => {
    const z = config.zones[0]!;
    expect(parseLocationConfiguration({ ...config, zones: [z, z] })).toBeUndefined();
    expect(
      parseLocationConfiguration({ ...config, zones: [{ ...z, feeAmountMinor: 1.5 }] }),
    ).toBeUndefined();
  });
  it("allows overnight hours and catches overlaps across a week boundary", () => {
    const w = {
      fulfillment: "pickup",
      weekday: 6,
      opensAt: "22:00",
      closesAt: "02:00",
      orderCapacity: null,
      itemCapacity: null,
    };
    expect(parseLocationConfiguration({ ...config, windows: [w] })).toBeDefined();
    expect(
      parseLocationConfiguration({
        ...config,
        windows: [w, { ...w, weekday: 0, opensAt: "01:00", closesAt: "03:00" }],
      }),
    ).toBeUndefined();
  });
  it("rejects impossible or duplicate special days and closed days with hours", () => {
    const e = {
      fulfillment: "pickup",
      date: "2026-02-30",
      closed: true,
      opensAt: null,
      closesAt: null,
      reason: "Synthetic",
      orderCapacity: null,
      itemCapacity: null,
    };
    expect(parseLocationConfiguration({ ...config, exceptions: [e] })).toBeUndefined();
    expect(
      parseLocationConfiguration({
        ...config,
        exceptions: [{ ...e, date: "2026-12-24", opensAt: "12:00" }],
      }),
    ).toBeUndefined();
  });
  it("requires explicit instants and bounded complete override values", () => {
    const c = {
      action: "override",
      scope: "all",
      expectedSequence: 0,
      endsAt: "2026-10-01T15:00:00Z",
      reason: "Synthetic",
      values: {
        paused: true,
        leadMinutes: 30,
        orderCapacity: 3,
        itemCapacity: null,
        maxOpenOrders: 10,
      },
    };
    expect(parseLocationOperationsCommand(c)).toEqual(c);
    expect(parseLocationOperationsCommand({ ...c, endsAt: "2026-10-01T15:00" })).toBeUndefined();
    expect(
      parseLocationOperationsCommand({ ...c, values: { ...c.values, orderCapacity: 0 } }),
    ).toBeUndefined();
  });
  it("reconstructs only the bounded public projection", () => {
    const s = {
      timezone: "Europe/Berlin",
      serverNow: "2026-10-01T15:00:00Z",
      publicationId: null,
      deliveryPolicyId: null,
      currentVersionId: null,
      operationSequence: 0,
      openOrders: 0,
      versions: [],
      overrides: [],
      audit: [],
      secret: "discard",
    };
    expect(parseLocationOperationsState(s)).not.toHaveProperty("secret");
    expect(parseLocationOperationsState({ ...s, timezone: "invalid" })).toBeUndefined();
  });
});
