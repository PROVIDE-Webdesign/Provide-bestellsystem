import { menuIdPattern } from "./menu-selection.js";
import { restaurantRoles, type RestaurantRole } from "./dashboard-access.js";
import { isExplicitInstant } from "./storefront.js";

type Mutation = {
  restaurantId: string;
  expectedRevision: number;
  requestId: string;
  reason: string;
};
export type PersonnelCommand =
  | { action: "inbox" }
  | { action: "accept"; invitationId: string }
  | { action: "read"; restaurantId: string; cursor?: string }
  | (Mutation & { action: "invite"; email: string; role: RestaurantRole; locationIds: string[] })
  | (Mutation & {
      action: "member";
      userId: string;
      role: RestaurantRole;
      status: "active" | "suspended";
      locationIds: string[];
    })
  | (Mutation & { action: "revoke"; invitationId: string })
  | (Mutation & { action: "cancelDispatch"; dispatchId: string });
export type PersonnelInvitation = {
  id: string;
  restaurantId: string;
  restaurantName: string;
  role: RestaurantRole;
  locationIds: string[];
  locations: { id: string; displayName: string }[];
  expiresAt: string;
  expired: boolean;
};
export type PersonnelState =
  | { mode: "inbox"; invitations: PersonnelInvitation[] }
  | {
      mode: "management";
      restaurantId: string;
      actorRole: "owner" | "manager";
      revision: number;
      serverNow: string;
      inviteDeliveryEnabled?: boolean;
      locations: { id: string; displayName: string }[];
      members: {
        userId: string;
        email: string | null;
        role: RestaurantRole;
        status: "active" | "suspended";
        locationIds: string[];
      }[];
      nextCursor: string | null;
      invitations: (PersonnelInvitation & { email: string })[];
      dispatches: {
        id: string;
        email: string;
        role: RestaurantRole;
        locationIds: string[];
        status: "pending" | "sending" | "sent" | "uncertain" | "failed" | "cancelled";
      }[];
      audit: {
        id: string;
        at: string;
        actorUserId: string | null;
        action: string;
        reason: string;
        before: unknown;
        after: unknown;
      }[];
    };
const obj = (x: unknown): Record<string, unknown> | undefined =>
  typeof x === "object" && x !== null && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : undefined;
const uuid = (x: unknown): x is string => typeof x === "string" && menuIdPattern.test(x);
const text = (x: unknown, min: number, max: number): x is string =>
  typeof x === "string" &&
  x === x.trim() &&
  x.length >= min &&
  x.length <= max &&
  !Array.from(x).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
export const personnelEmail = (x: unknown): x is string =>
  text(x, 3, 254) && x === x.toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
const role = (x: unknown): x is RestaurantRole =>
  typeof x === "string" && restaurantRoles.includes(x as RestaurantRole);
const ids = (x: unknown): x is string[] =>
  Array.isArray(x) && x.length <= 50 && x.every(uuid) && new Set(x).size === x.length;
const scope = (r: unknown, x: unknown) =>
  role(r) && ids(x) && (r === "owner" ? x.length === 0 : x.length > 0);
const keys = (x: Record<string, unknown>, allowed: string[]) =>
  Object.keys(x).every((k) => allowed.includes(k));
const integer = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const instant = (x: unknown): x is string =>
  typeof x === "string" &&
  isExplicitInstant(x.replace(/(\.\d{3})\d{1,3}(?=(?:Z|[+-]\d{2}:\d{2})$)/, "$1"));
export function parsePersonnelCommand(x: unknown): PersonnelCommand | undefined {
  const q = obj(x);
  if (!q) return;
  if (q.action === "inbox") return keys(q, ["action"]) ? { action: "inbox" } : undefined;
  if (q.action === "accept")
    return keys(q, ["action", "invitationId"]) && uuid(q.invitationId)
      ? (q as PersonnelCommand)
      : undefined;
  if (!uuid(q.restaurantId)) return;
  if (q.action === "read")
    return keys(q, ["action", "restaurantId", "cursor"]) &&
      (q.cursor === undefined || uuid(q.cursor))
      ? (q as PersonnelCommand)
      : undefined;
  if (!integer(q.expectedRevision) || !uuid(q.requestId) || !text(q.reason, 8, 300)) return;
  const common = ["action", "restaurantId", "expectedRevision", "requestId", "reason"];
  if (
    q.action === "invite" &&
    keys(q, [...common, "email", "role", "locationIds"]) &&
    personnelEmail(q.email) &&
    scope(q.role, q.locationIds)
  )
    return q as PersonnelCommand;
  if (
    q.action === "member" &&
    keys(q, [...common, "userId", "role", "status", "locationIds"]) &&
    uuid(q.userId) &&
    scope(q.role, q.locationIds) &&
    (q.status === "active" || q.status === "suspended")
  )
    return q as PersonnelCommand;
  if (q.action === "revoke" && keys(q, [...common, "invitationId"]) && uuid(q.invitationId))
    return q as PersonnelCommand;
  if (q.action === "cancelDispatch" && keys(q, [...common, "dispatchId"]) && uuid(q.dispatchId))
    return q as PersonnelCommand;
  return;
}
function invitation(x: unknown): x is PersonnelInvitation {
  const v = obj(x);
  const locationIds = v?.locationIds;
  return (
    !!v &&
    uuid(v.id) &&
    uuid(v.restaurantId) &&
    text(v.restaurantName, 1, 160) &&
    ids(locationIds) &&
    scope(v.role, locationIds) &&
    Array.isArray(v.locations) &&
    v.locations.length === locationIds.length &&
    v.locations.every((entry) => {
      const location = obj(entry);
      return (
        !!location &&
        uuid(location.id) &&
        locationIds.includes(location.id) &&
        text(location.displayName, 1, 160)
      );
    }) &&
    new Set(v.locations.map((entry) => obj(entry)?.id)).size === v.locations.length &&
    instant(v.expiresAt) &&
    typeof v.expired === "boolean"
  );
}
export function parsePersonnelState(x: unknown): PersonnelState | undefined {
  const v = obj(x);
  if (
    !v ||
    !Array.isArray(v.invitations) ||
    v.invitations.length > 50 ||
    !v.invitations.every(invitation)
  )
    return;
  if (v.mode === "inbox")
    return keys(v, ["mode", "invitations"]) ? (v as PersonnelState) : undefined;
  if (
    v.mode !== "management" ||
    !uuid(v.restaurantId) ||
    !["owner", "manager"].includes(String(v.actorRole)) ||
    !integer(v.revision) ||
    !instant(v.serverNow)
  )
    return;
  if (v.inviteDeliveryEnabled !== undefined && typeof v.inviteDeliveryEnabled !== "boolean") return;
  if (
    !Array.isArray(v.locations) ||
    v.locations.length > 100 ||
    !v.locations.every((x) => {
      const a = obj(x);
      return !!a && uuid(a.id) && text(a.displayName, 1, 160);
    })
  )
    return;
  if (
    !Array.isArray(v.members) ||
    v.members.length > 50 ||
    !v.members.every((x) => {
      const a = obj(x);
      return (
        !!a &&
        uuid(a.userId) &&
        (a.email === null || personnelEmail(a.email)) &&
        role(a.role) &&
        ids(a.locationIds) &&
        ["active", "suspended"].includes(String(a.status))
      );
    })
  )
    return;
  if (v.nextCursor !== null && !uuid(v.nextCursor)) return;
  if (
    !v.invitations.every((x) => {
      const a = obj(x);
      return !!a && a.restaurantId === v.restaurantId && personnelEmail(a.email);
    })
  )
    return;
  if (
    !Array.isArray(v.dispatches) ||
    v.dispatches.length > 20 ||
    !v.dispatches.every((x) => {
      const a = obj(x);
      return (
        !!a &&
        uuid(a.id) &&
        personnelEmail(a.email) &&
        scope(a.role, a.locationIds) &&
        ["pending", "sending", "sent", "uncertain", "failed", "cancelled"].includes(
          String(a.status),
        )
      );
    })
  )
    return;
  if (
    !Array.isArray(v.audit) ||
    v.audit.length > 30 ||
    !v.audit.every((x) => {
      const a = obj(x);
      const after = obj(a?.after);
      const system = after?.changeKind === "system";
      return (
        !!a &&
        uuid(a.id) &&
        (system
          ? a.actorUserId === null &&
            typeof a.action === "string" &&
            a.action.startsWith("dispatch.") &&
            uuid(after?.initiatorUserId)
          : uuid(a.actorUserId)) &&
        instant(a.at) &&
        text(a.action, 1, 80) &&
        text(a.reason, 8, 300) &&
        Object.hasOwn(a, "before") &&
        Object.hasOwn(a, "after")
      );
    })
  )
    return;
  return v as PersonnelState;
}
