const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const supportKinds = [
  "payment_review",
  "refund_failed",
  "email_uncertain",
  "email_dead_letter",
  "acceptance_overdue",
  "incident",
] as const;
export const supportStates = ["open", "in_progress", "waiting", "resolved"] as const;
export const supportSeverities = ["critical", "high", "normal"] as const;
export const supportReasons = [
  "triage",
  "handover",
  "awaiting_internal",
  "awaiting_provider",
  "source_confirmed",
  "misassignment",
  "duplicate",
  "out_of_scope",
  "reopened",
  "priority_changed",
  "deadline_changed",
  "incident_recorded",
] as const;
export const supportSourceStates = [
  "manual_review",
  "refund_failed",
  "payment_known",
  "payment_pending",
  "refund_succeeded",
  "refund_pending",
  "queued",
  "processing",
  "retry",
  "uncertain",
  "accepted",
  "delivered",
  "bounced",
  "suppressed",
  "dead_letter",
  "overdue",
  "acceptance_resolved",
  "acceptance_pending",
] as const;
export type SupportKind = (typeof supportKinds)[number];
export type SupportReason = (typeof supportReasons)[number];
type Scope = { restaurantId: string; locationId: string };
type Mutation = Scope & { requestId: string };
export type SupportCommand =
  | (Scope & { action: "read"; cursor: string | null; caseId: string | null })
  | (Mutation & { action: "scan"; cursor: string | null })
  | (Mutation & {
      action: "create";
      kind: SupportKind;
      sourceId: string | null;
      severity: (typeof supportSeverities)[number];
      reason: "incident_recorded" | "triage";
    })
  | (Mutation & {
      action: "update";
      caseId: string;
      expectedRevision: number;
      operation: "claim" | "assign" | "status" | "priority" | "deadline";
      assigneeUserId: string | null;
      state: (typeof supportStates)[number] | null;
      severity: (typeof supportSeverities)[number] | null;
      deadline: string | null;
      reason: SupportReason;
      sourceFingerprint: string | null;
    });
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).length === allowed.length && allowed.every((k) => Object.hasOwn(v, k));
const uuid = (v: unknown): v is string => typeof v === "string" && uuidPattern.test(v);
const instant = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
  Number.isFinite(Date.parse(v));
const member = (v: unknown, allowed: readonly string[]) =>
  typeof v === "string" && allowed.includes(v);
const fingerprint = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{32}$/.test(v);
export function parseSupportCommand(value: unknown): SupportCommand | undefined {
  const q = obj(value);
  if (!q || !uuid(q.restaurantId) || !uuid(q.locationId)) return undefined;
  const scope = ["action", "restaurantId", "locationId"];
  if (q.action === "read") {
    if (
      !keys(q, [...scope, "cursor", "caseId"]) ||
      (q.cursor !== null && !uuid(q.cursor)) ||
      (q.caseId !== null && !uuid(q.caseId)) ||
      (q.cursor !== null && q.caseId !== null)
    )
      return undefined;
  } else {
    if (!uuid(q.requestId)) return undefined;
    if (q.action === "scan") {
      if (!keys(q, [...scope, "requestId", "cursor"]) || (q.cursor !== null && !uuid(q.cursor)))
        return undefined;
    } else if (q.action === "create") {
      if (
        !keys(q, [...scope, "requestId", "kind", "sourceId", "severity", "reason"]) ||
        !member(q.kind, supportKinds) ||
        !member(q.severity, supportSeverities) ||
        (q.kind === "incident"
          ? q.sourceId !== null || q.reason !== "incident_recorded"
          : !uuid(q.sourceId) || q.reason !== "triage")
      )
        return undefined;
    } else if (q.action === "update") {
      if (
        !keys(q, [
          ...scope,
          "requestId",
          "caseId",
          "expectedRevision",
          "operation",
          "assigneeUserId",
          "state",
          "severity",
          "deadline",
          "reason",
          "sourceFingerprint",
        ]) ||
        !uuid(q.caseId) ||
        !Number.isSafeInteger(q.expectedRevision) ||
        Number(q.expectedRevision) < 1 ||
        !member(q.reason, supportReasons) ||
        (q.sourceFingerprint !== null && !fingerprint(q.sourceFingerprint))
      )
        return undefined;
      if (q.operation === "assign" || q.operation === "claim") {
        if (
          (q.operation === "claim"
            ? q.assigneeUserId !== null
            : q.assigneeUserId !== null && !uuid(q.assigneeUserId)) ||
          q.state !== null ||
          q.severity !== null ||
          q.deadline !== null ||
          q.sourceFingerprint !== null ||
          !member(q.reason, ["triage", "handover"])
        )
          return undefined;
      } else if (q.operation === "status") {
        if (
          !member(q.state, supportStates) ||
          q.assigneeUserId !== null ||
          q.severity !== null ||
          q.deadline !== null
        )
          return undefined;
        if (
          q.state === "resolved"
            ? !member(q.reason, [
                "source_confirmed",
                "misassignment",
                "duplicate",
                "out_of_scope",
              ]) ||
              (q.reason === "source_confirmed" && !fingerprint(q.sourceFingerprint))
            : q.sourceFingerprint !== null ||
              !member(
                q.reason,
                q.state === "waiting"
                  ? ["awaiting_internal", "awaiting_provider"]
                  : ["triage", "reopened"],
              )
        )
          return undefined;
      } else if (q.operation === "priority" || q.operation === "deadline") {
        if (
          q.assigneeUserId !== null ||
          q.state !== null ||
          q.sourceFingerprint !== null ||
          (q.operation === "priority"
            ? !member(q.severity, supportSeverities) ||
              q.deadline !== null ||
              q.reason !== "priority_changed"
            : q.severity !== null || !instant(q.deadline) || q.reason !== "deadline_changed")
        )
          return undefined;
      } else return undefined;
    } else return undefined;
  }
  return q as SupportCommand;
}
export type SupportSource = {
  kind: Exclude<SupportKind, "incident">;
  sourceId: string;
  orderId: string;
  orderNumber: string;
  stateCode: (typeof supportSourceStates)[number];
  problem: boolean;
  canClose: boolean;
  fingerprint: string;
  recordedAt: string | null;
  observedAt: string;
};
export type SupportCase = {
  caseId: string;
  kind: SupportKind;
  sourceId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  state: (typeof supportStates)[number];
  severity: (typeof supportSeverities)[number];
  deadline: string;
  assigneeUserId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  previousCaseId: string | null;
  resolution: "technical" | "administrative" | null;
  reason: SupportReason;
  evidence: SupportSource | null;
};
export type SupportState = Scope & {
  serverNow: string;
  timezone: string;
  canManage: boolean;
  cases: SupportCase[];
  nextCursor: string | null;
  scanned: number;
  scanCursor: string | null;
  currentSource: SupportSource | null;
  audit: {
    id: string;
    caseId: string;
    action: "create" | "observe" | "claim" | "assign" | "status" | "priority" | "deadline";
    provenance: "human" | "system_observed";
    actorUserId: string;
    reason: SupportReason;
    revision: number;
    at: string;
    evidence: SupportSource | null;
    before: SupportChange | null;
    after: SupportChange;
  }[];
};
type SupportChange = Pick<
  SupportCase,
  "state" | "severity" | "deadline" | "assigneeUserId" | "resolution"
>;
function change(value: unknown): boolean {
  const c = obj(value);
  return (
    !!c &&
    keys(c, ["state", "severity", "deadline", "assigneeUserId", "resolution"]) &&
    member(c.state, supportStates) &&
    member(c.severity, supportSeverities) &&
    instant(c.deadline) &&
    (c.assigneeUserId === null || uuid(c.assigneeUserId)) &&
    (c.resolution === null || member(c.resolution, ["technical", "administrative"])) &&
    (c.state === "resolved") === (c.resolution !== null)
  );
}
export function parseSupportSource(value: unknown): SupportSource | undefined {
  const s = obj(value);
  if (
    !s ||
    !keys(s, [
      "kind",
      "sourceId",
      "orderId",
      "orderNumber",
      "stateCode",
      "problem",
      "canClose",
      "fingerprint",
      "recordedAt",
      "observedAt",
    ]) ||
    !member(
      s.kind,
      supportKinds.filter((k) => k !== "incident"),
    ) ||
    !uuid(s.sourceId) ||
    !uuid(s.orderId) ||
    typeof s.orderNumber !== "string" ||
    !/^BS-\d{8,20}$/.test(s.orderNumber) ||
    !member(s.stateCode, supportSourceStates) ||
    typeof s.problem !== "boolean" ||
    typeof s.canClose !== "boolean" ||
    !fingerprint(s.fingerprint) ||
    (s.recordedAt !== null && !instant(s.recordedAt)) ||
    !instant(s.observedAt) ||
    (s.problem && s.canClose)
  )
    return undefined;
  return s as SupportSource;
}
export function parseSupportState(value: unknown): SupportState | undefined {
  const s = obj(value);
  if (
    !s ||
    !keys(s, [
      "restaurantId",
      "locationId",
      "serverNow",
      "timezone",
      "canManage",
      "cases",
      "nextCursor",
      "scanned",
      "scanCursor",
      "currentSource",
      "audit",
    ]) ||
    !uuid(s.restaurantId) ||
    !uuid(s.locationId) ||
    !instant(s.serverNow) ||
    typeof s.timezone !== "string" ||
    s.timezone.length > 80 ||
    typeof s.canManage !== "boolean" ||
    !Array.isArray(s.cases) ||
    s.cases.length > 50 ||
    (s.nextCursor !== null && !uuid(s.nextCursor)) ||
    !Number.isInteger(s.scanned) ||
    Number(s.scanned) < 0 ||
    Number(s.scanned) > 100 ||
    (s.scanCursor !== null && !uuid(s.scanCursor)) ||
    (s.currentSource !== null && !parseSupportSource(s.currentSource)) ||
    !Array.isArray(s.audit) ||
    s.audit.length > 30
  )
    return undefined;
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: s.timezone });
  } catch {
    return undefined;
  }
  for (const v of s.cases) {
    const c = obj(v);
    if (
      !c ||
      !keys(c, [
        "caseId",
        "kind",
        "sourceId",
        "orderId",
        "orderNumber",
        "state",
        "severity",
        "deadline",
        "assigneeUserId",
        "revision",
        "createdAt",
        "updatedAt",
        "previousCaseId",
        "resolution",
        "reason",
        "evidence",
      ]) ||
      !uuid(c.caseId) ||
      !member(c.kind, supportKinds) ||
      !member(c.state, supportStates) ||
      !member(c.severity, supportSeverities) ||
      !instant(c.deadline) ||
      !instant(c.createdAt) ||
      !instant(c.updatedAt) ||
      !Number.isSafeInteger(c.revision) ||
      Number(c.revision) < 1 ||
      !member(c.reason, supportReasons) ||
      (c.assigneeUserId !== null && !uuid(c.assigneeUserId)) ||
      (c.previousCaseId !== null && !uuid(c.previousCaseId)) ||
      (c.resolution !== null && !member(c.resolution, ["technical", "administrative"])) ||
      (c.state === "resolved") !== (c.resolution !== null)
    )
      return undefined;
    if (
      c.kind === "incident"
        ? c.sourceId !== null || c.orderId !== null || c.orderNumber !== null || c.evidence !== null
        : !uuid(c.sourceId) ||
          !uuid(c.orderId) ||
          typeof c.orderNumber !== "string" ||
          !/^BS-\d{8,20}$/.test(c.orderNumber) ||
          !parseSupportSource(c.evidence) ||
          obj(c.evidence)?.sourceId !== c.sourceId ||
          obj(c.evidence)?.kind !== c.kind ||
          obj(c.evidence)?.orderId !== c.orderId ||
          obj(c.evidence)?.orderNumber !== c.orderNumber
    )
      return undefined;
  }
  if (new Set(s.cases.map((c) => obj(c)?.caseId)).size !== s.cases.length) return undefined;
  if (
    s.currentSource !== null &&
    (s.cases.length !== 1 ||
      obj(s.cases[0])?.sourceId !== obj(s.currentSource)?.sourceId ||
      obj(s.cases[0])?.kind !== obj(s.currentSource)?.kind ||
      obj(s.cases[0])?.orderId !== obj(s.currentSource)?.orderId ||
      obj(s.cases[0])?.orderNumber !== obj(s.currentSource)?.orderNumber)
  )
    return undefined;
  for (const v of s.audit) {
    const a = obj(v);
    if (
      !a ||
      !keys(a, [
        "id",
        "caseId",
        "action",
        "provenance",
        "actorUserId",
        "reason",
        "revision",
        "at",
        "evidence",
        "before",
        "after",
      ]) ||
      !uuid(a.id) ||
      !uuid(a.caseId) ||
      !member(a.action, [
        "create",
        "observe",
        "claim",
        "assign",
        "status",
        "priority",
        "deadline",
      ]) ||
      !member(a.provenance, ["human", "system_observed"]) ||
      !uuid(a.actorUserId) ||
      !member(a.reason, supportReasons) ||
      !Number.isSafeInteger(a.revision) ||
      Number(a.revision) < 1 ||
      !instant(a.at) ||
      (a.evidence !== null && !parseSupportSource(a.evidence)) ||
      (a.before !== null && !change(a.before)) ||
      !change(a.after) ||
      !s.cases.some((c) => obj(c)?.caseId === a.caseId)
    )
      return undefined;
  }
  return s as SupportState;
}
