import { describe, it, expect } from "vitest";
import raw from "../../../fixtures/support.json" with { type: "json" };
import { parseSupportCommand, parseSupportState, supportKinds } from "./support.js";
const scope = { restaurantId: raw.restaurantId, locationId: raw.locationId };
const requestId = "f1000000-0000-0000-0000-000000000001";
const base = {
  action: "update",
  ...scope,
  requestId,
  caseId: raw.cases[0]!.caseId,
  expectedRevision: 1,
  operation: "status",
  assigneeUserId: null,
  state: "waiting",
  severity: null,
  deadline: null,
  reason: "awaiting_internal",
  sourceFingerprint: null,
};
describe("O1 minimized support contracts", () => {
  it("accepts all scoped command families and exact minimized evidence", () => {
    expect(parseSupportState(raw)).toEqual(raw);
    for (const q of [
      { action: "read", ...scope, cursor: null, caseId: null },
      { action: "scan", ...scope, requestId, cursor: null },
      ...supportKinds.map((kind) => ({
        action: "create",
        ...scope,
        requestId,
        kind,
        sourceId: kind === "incident" ? null : requestId,
        severity: "normal",
        reason: kind === "incident" ? "incident_recorded" : "triage",
      })),
      base,
      { ...base, operation: "claim", state: null, reason: "triage" },
      { ...base, operation: "assign", state: null, reason: "handover", assigneeUserId: requestId },
      { ...base, operation: "priority", state: null, severity: "high", reason: "priority_changed" },
      {
        ...base,
        operation: "deadline",
        state: null,
        deadline: "2026-10-04T10:00:00Z",
        reason: "deadline_changed",
      },
    ])
      expect(parseSupportCommand(q), JSON.stringify(q)).toEqual(q);
  });
  it.each([
    "name",
    "email",
    "phone",
    "address",
    "token",
    "providerPayload",
    "note",
    "url",
    "actorUserId",
  ])("rejects %s on input and output, including nested evidence", (key) => {
    expect(parseSupportCommand({ ...base, [key]: "sensitive" })).toBeUndefined();
    expect(parseSupportState({ ...raw, [key]: "sensitive" })).toBeUndefined();
    expect(
      parseSupportState({ ...raw, cases: [{ ...raw.cases[0], [key]: "sensitive" }] }),
    ).toBeUndefined();
    expect(
      parseSupportState({
        ...raw,
        cases: [{ ...raw.cases[0], evidence: { ...raw.cases[0]!.evidence, [key]: "sensitive" } }],
      }),
    ).toBeUndefined();
  });
  it("rejects forged references, contradictory states and unsigned free error codes", () => {
    for (const patch of [
      { restaurantId: "https://example.invalid" },
      { caseId: "https://example.invalid" },
      { expectedRevision: 0 },
      { expectedRevision: 1.5 },
      { state: "paid" },
      { state: "waiting", reason: "arbitrary text" },
      { state: "resolved", reason: "source_confirmed", sourceFingerprint: null },
      { operation: "refund_retry" },
      { operation: "send" },
    ])
      expect(parseSupportCommand({ ...base, ...patch })).toBeUndefined();
    expect(
      parseSupportState({
        ...raw,
        cases: [{ ...raw.cases[0], state: "resolved", resolution: null }],
      }),
    ).toBeUndefined();
    expect(
      parseSupportState({
        ...raw,
        cases: [
          {
            ...raw.cases[0],
            evidence: { ...raw.cases[0]!.evidence, stateCode: "guest@example.invalid" },
          },
        ],
      }),
    ).toBeUndefined();
    expect(
      parseSupportState({
        ...raw,
        cases: [{ ...raw.cases[0], evidence: { ...raw.cases[0]!.evidence, orderId: requestId } }],
      }),
    ).toBeUndefined();
    expect(parseSupportState({ ...raw, scanned: 101 })).toBeUndefined();
    expect(parseSupportState({ ...raw, timezone: "invalid" })).toBeUndefined();
  });
  it("does not fabricate an order reference for a scoped incident", () => {
    const incident = {
      ...raw.cases[0],
      kind: "incident",
      sourceId: null,
      orderId: null,
      orderNumber: null,
      evidence: null,
    };
    expect(parseSupportState({ ...raw, cases: [incident] })).toBeDefined();
    expect(
      parseSupportState({ ...raw, cases: [{ ...incident, orderId: requestId }] }),
    ).toBeUndefined();
  });
});
