import { it, expect } from "vitest";
import {
  parseRecoveryCommand,
  parseRecoveryRequest,
  parseRecoveryCase,
} from "./account-recovery.js";
const id = "a4100000-0000-0000-0000-000000000001";
const base = { caseId: id, commandId: id };
it("rejects extra authority, redirects, secrets and partial approval evidence", () => {
  const request = { ...base, action: "request", kind: "lost_factor", reason: "factor_lost" };
  expect(parseRecoveryCommand(request)).toEqual(request);
  for (const extra of [
    { targetUserId: id },
    { role: "owner" },
    { approved: true },
    { redirectTo: "https://evil.test" },
    { token: "sensitive" },
  ])
    expect(parseRecoveryCommand({ ...request, ...extra })).toBeUndefined();
  expect(parseRecoveryCommand({ ...request, reason: "forgot_password" })).toBeUndefined();
  for (const evidenceReference of [
    "person@example.test",
    "raw document text",
    "https://new-contact.test",
    "",
  ])
    expect(
      parseRecoveryCommand({
        ...base,
        action: "verify",
        expectedRevision: 1,
        contactId: id,
        evidenceReference,
      }),
    ).toBeUndefined();
});
it("binds replacement to old proof before accepting a separately verified new factor", () => {
  expect(
    parseRecoveryCommand({
      ...base,
      action: "request",
      kind: "replace_factor",
      reason: "factor_replaced",
      oldFactorId: id,
    }),
  ).toBeDefined();
  expect(
    parseRecoveryCommand({
      ...base,
      action: "request",
      kind: "replace_factor",
      reason: "factor_replaced",
      newFactorId: id,
    }),
  ).toBeUndefined();
  expect(
    parseRecoveryCommand({ ...base, action: "begin_replacement", expectedRevision: 1 }),
  ).toBeUndefined();
  expect(
    parseRecoveryCommand({
      ...base,
      action: "begin_replacement",
      expectedRevision: 1,
      newFactorId: id,
    }),
  ).toBeDefined();
});
it("accepts a transient password only at the bound password-effect step", () => {
  const command = { ...base, action: "begin_password", expectedRevision: 1 };
  expect(parseRecoveryRequest({ command, password: "Synthetic password value" })).toBeDefined();
  for (const password of ["short", "x".repeat(1025), 123])
    expect(parseRecoveryRequest({ command, password })).toBeUndefined();
  expect(
    parseRecoveryRequest({
      command: { ...base, action: "read" },
      password: "Synthetic password value",
    }),
  ).toBeUndefined();
  expect(parseRecoveryRequest({ command, token: "secret" })).toBeUndefined();
});
it("projects no identity documents, email, tokens or server snapshots", () => {
  const c = {
    caseId: id,
    kind: "lost_factor",
    state: "requested",
    revision: 1,
    expiresAt: "2026-10-04T01:00:00Z",
    approvalExpiresAt: null,
    requiredApprovals: 2,
  };
  expect(parseRecoveryCase(c)).toEqual(c);
  for (const extra of [
    { email: "person@example.test" },
    { identity_snapshot: "sensitive" },
    { factorSecret: "sensitive" },
  ])
    expect(parseRecoveryCase({ ...c, ...extra })).toBeUndefined();
});
