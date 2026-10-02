import { describe, it, expect } from "vitest";
import raw from "../../../fixtures/personnel.json" with { type: "json" };
import { parsePersonnelCommand, parsePersonnelState } from "./personnel.js";
const q = {
  action: "member",
  restaurantId: raw.restaurantId,
  expectedRevision: 10,
  requestId: "aa000000-0000-0000-0000-000000000001",
  reason: "Synthetic personnel review",
  userId: raw.members[1]!.userId,
  role: "kitchen",
  status: "suspended",
  locationIds: [raw.locations[0]!.id],
};
describe("strict personnel contract", () => {
  it("preserves actual PostgreSQL microseconds and nullable contact", () => {
    expect(parsePersonnelState(raw)).toEqual(raw);
    expect(
      parsePersonnelState({ ...raw, members: [{ ...raw.members[1], email: null }] }),
    ).toBeDefined();
  });
  it("accepts management and own invitation commands", () => {
    expect(parsePersonnelCommand(q)).toEqual(q);
    expect(parsePersonnelCommand({ action: "accept", invitationId: q.requestId })).toBeDefined();
    expect(parsePersonnelCommand({ action: "inbox" })).toEqual({ action: "inbox" });
  });
  it.each([
    { actorUserId: q.userId },
    { role: "viewer" },
    { locationIds: [] },
    { locationIds: [raw.locations[0]!.id, raw.locations[0]!.id] },
    { expectedRevision: -1 },
    { reason: "short" },
    { reason: "Unsafe\nreason" },
    { requestId: "invalid" },
  ])("rejects tampering %j", (patch) => {
    expect(parsePersonnelCommand({ ...q, ...patch })).toBeUndefined();
  });
  it("requires owner scope empty and other scopes explicit", () => {
    expect(parsePersonnelCommand({ ...q, role: "owner", locationIds: [] })).toBeDefined();
    expect(parsePersonnelCommand({ ...q, role: "owner" })).toBeUndefined();
  });
  it("does not coerce unknown role/status objects", () => {
    expect(parsePersonnelCommand({ ...q, status: { toString: () => "active" } })).toBeUndefined();
  });
  it("requires normalized email and excludes secrets", () => {
    const invite = { ...q, action: "invite", email: "new@example.invalid" };
    delete (invite as Record<string, unknown>).userId;
    delete (invite as Record<string, unknown>).status;
    expect(parsePersonnelCommand(invite)).toBeDefined();
    expect(parsePersonnelCommand({ ...invite, email: "New@example.invalid" })).toBeUndefined();
    expect(parsePersonnelCommand({ ...invite, token: "secret" })).toBeUndefined();
  });
  it("rejects invalid dates, response role and oversized page", () => {
    expect(parsePersonnelState({ ...raw, inviteDeliveryEnabled: "false" })).toBeUndefined();
    expect(parsePersonnelState({ ...raw, serverNow: "2026-02-30T00:00:00Z" })).toBeUndefined();
    expect(
      parsePersonnelState({ ...raw, members: [{ ...raw.members[0], role: "viewer" }] }),
    ).toBeUndefined();
    expect(
      parsePersonnelState({ ...raw, members: Array.from({ length: 51 }, () => raw.members[0]) }),
    ).toBeUndefined();
  });
  it("requires invitation names to match exactly the granted location scope", () => {
    const invitation = {
      id: q.requestId,
      restaurantId: raw.restaurantId,
      restaurantName: "Synthetic Restaurant",
      role: "kitchen",
      locationIds: q.locationIds,
      locations: [raw.locations[0]],
      expiresAt: "2026-10-09T00:00:00.000Z",
      expired: false,
    };
    expect(parsePersonnelState({ mode: "inbox", invitations: [invitation] })).toBeDefined();
    expect(
      parsePersonnelState({
        mode: "inbox",
        invitations: [{ ...invitation, locations: [raw.locations[1]] }],
      }),
    ).toBeUndefined();
  });
});
