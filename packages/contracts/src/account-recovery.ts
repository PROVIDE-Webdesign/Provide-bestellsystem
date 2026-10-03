const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const recoveryStates = [
  "requested",
  "verified",
  "approved",
  "executing",
  "awaiting_reenrollment",
  "completed",
  "rejected",
  "cancelled",
  "expired",
  "needs_review",
] as const;
export type RecoveryState = (typeof recoveryStates)[number];
export type RecoveryKind = "password" | "replace_factor" | "lost_factor";
export interface RecoveryCase {
  caseId: string;
  kind: RecoveryKind;
  state: RecoveryState;
  revision: number;
  expiresAt: string;
  approvalExpiresAt: string | null;
  requiredApprovals: number;
}
export interface RecoveryCommand {
  action:
    | "request"
    | "read"
    | "verify"
    | "approve"
    | "execute"
    | "begin_password"
    | "begin_replacement"
    | "complete"
    | "cancel"
    | "reject"
    | "reconcile";
  caseId: string;
  commandId: string;
  expectedRevision?: number;
  kind?: RecoveryKind;
  reason?: "forgot_password" | "factor_lost" | "factor_replaced";
  oldFactorId?: string;
  newFactorId?: string;
  contactId?: string;
  evidenceReference?: string;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function parseRecoveryCommand(v: unknown): RecoveryCommand | undefined {
  if (
    !record(v) ||
    typeof v.caseId !== "string" ||
    !uuid.test(v.caseId) ||
    typeof v.commandId !== "string" ||
    !uuid.test(v.commandId)
  )
    return;
  const base = ["action", "caseId", "commandId"];
  if (v.action === "request") {
    if (!["password", "replace_factor", "lost_factor"].includes(String(v.kind))) return;
    const reasons = {
      password: "forgot_password",
      replace_factor: "factor_replaced",
      lost_factor: "factor_lost",
    };
    if (v.reason !== reasons[v.kind as RecoveryKind]) return;
    base.push("kind", "reason");
    if (v.kind === "replace_factor") {
      if (typeof v.oldFactorId !== "string" || !uuid.test(v.oldFactorId)) return;
      base.push("oldFactorId");
    }
  } else if (v.action !== "read") {
    if (
      ![
        "verify",
        "approve",
        "execute",
        "begin_password",
        "begin_replacement",
        "complete",
        "cancel",
        "reject",
        "reconcile",
      ].includes(String(v.action)) ||
      !Number.isSafeInteger(v.expectedRevision) ||
      Number(v.expectedRevision) < 1
    )
      return;
    base.push("expectedRevision");
    if (v.action === "begin_replacement") {
      if (typeof v.newFactorId !== "string" || !uuid.test(v.newFactorId)) return;
      base.push("newFactorId");
    }
    if (v.action === "verify") {
      if (
        typeof v.contactId !== "string" ||
        !uuid.test(v.contactId) ||
        typeof v.evidenceReference !== "string" ||
        !/^[A-Za-z0-9:_-]{1,120}$/.test(v.evidenceReference)
      )
        return;
      base.push("contactId", "evidenceReference");
    }
  }
  if (Object.keys(v).length !== base.length || Object.keys(v).some((k) => !base.includes(k)))
    return;
  return v as unknown as RecoveryCommand;
}
export function parseRecoveryCase(v: unknown): RecoveryCase | undefined {
  if (
    !record(v) ||
    typeof v.caseId !== "string" ||
    !uuid.test(v.caseId) ||
    !["password", "replace_factor", "lost_factor"].includes(String(v.kind)) ||
    !recoveryStates.includes(v.state as RecoveryState) ||
    !Number.isSafeInteger(v.revision) ||
    typeof v.requiredApprovals !== "number" ||
    Number(v.revision) < 1 ||
    ![0, 1, 2].includes(Number(v.requiredApprovals)) ||
    typeof v.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(v.expiresAt)) ||
    (v.approvalExpiresAt !== null &&
      (typeof v.approvalExpiresAt !== "string" ||
        !Number.isFinite(Date.parse(v.approvalExpiresAt))))
  )
    return;
  if (
    Object.keys(v).sort().join(",") !==
    ["caseId", "kind", "state", "revision", "expiresAt", "approvalExpiresAt", "requiredApprovals"]
      .sort()
      .join(",")
  )
    return;
  return v as unknown as RecoveryCase;
}
export function parseRecoveryRequest(
  v: unknown,
): { command: RecoveryCommand; password?: string } | undefined {
  if (!record(v)) return;
  const command = parseRecoveryCommand(v.command);
  if (!command || Object.keys(v).some((k) => !["command", "password"].includes(k))) return;
  if (command.action === "begin_password") {
    if (typeof v.password !== "string" || v.password.length < 12 || v.password.length > 1024)
      return;
    return { command, password: v.password };
  }
  if ("password" in v) return;
  return { command };
}
