import { menuIdPattern } from "./menu-selection.js";
import { isExplicitInstant } from "./storefront.js";
export type OperationScope = "all" | "pickup" | "delivery";
export interface OperationValues {
  paused: boolean;
  leadMinutes: number | null;
  orderCapacity: number | null;
  itemCapacity: number | null;
  maxOpenOrders: number | null;
}
export interface LocationConfiguration {
  minimumLeadMinutes: number;
  maximumAdvanceDays: number;
  slotIntervalMinutes: number;
  defaultOrderCapacity: number | null;
  defaultItemCapacity: number | null;
  orderCutoffMinutes: number;
  acceptanceMinutes: number;
  maxOpenOrders: number | null;
  windows: {
    fulfillment: "pickup" | "delivery";
    weekday: number;
    opensAt: string;
    closesAt: string;
    orderCapacity: number | null;
    itemCapacity: number | null;
  }[];
  exceptions: {
    fulfillment: "pickup" | "delivery";
    date: string;
    closed: boolean;
    opensAt: string | null;
    closesAt: string | null;
    reason: string;
    orderCapacity: number | null;
    itemCapacity: number | null;
  }[];
  zones: { postalCodes: string[]; minimumAmountMinor: number; feeAmountMinor: number }[];
}
export type LocationOperationsCommand =
  | { action: "create_draft"; sourceVersionId: string | null; reason: string }
  | {
      action: "save_draft";
      versionId: string;
      expectedRevision: number;
      configuration: LocationConfiguration;
      reason: string;
    }
  | {
      action: "publish";
      versionId: string;
      expectedRevision: number;
      expectedPublicationId: string | null;
      expectedDeliveryPolicyId: string | null;
      reason: string;
    }
  | {
      action: "override";
      scope: OperationScope;
      expectedSequence: number;
      endsAt: string;
      values: OperationValues;
      reason: string;
    }
  | { action: "clear_override"; scope: OperationScope; expectedSequence: number; reason: string };
export interface LocationOperationsState {
  timezone: string;
  serverNow: string;
  publicationId: string | null;
  deliveryPolicyId: string | null;
  currentVersionId: string | null;
  operationSequence: number;
  openOrders: number;
  versions: {
    id: string;
    number: number;
    revision: number;
    status: "draft" | "published";
    configuration: LocationConfiguration;
  }[];
  overrides: {
    scope: OperationScope;
    sequence: number;
    endsAt: string;
    reason: string;
    values: OperationValues;
  }[];
  audit: { id: string; action: string; actorId: string; reason: string; createdAt: string }[];
}
const object = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const integer = (v: unknown, min = 0, max = 1000000): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const optionalCapacity = (v: unknown): v is number | null => v === null || integer(v, 1);
const identifier = (v: unknown): v is string => typeof v === "string" && menuIdPattern.test(v);
const nullableId = (v: unknown): v is string | null => v === null || identifier(v);
const instant = (v: unknown): v is string => typeof v === "string" && isExplicitInstant(v);
const text = (v: unknown, max = 300): v is string =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const clock = (v: unknown): v is string =>
  typeof v === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
const channel = (v: unknown): v is "pickup" | "delivery" => v === "pickup" || v === "delivery";
const scope = (v: unknown): v is OperationScope => v === "all" || channel(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && Object.keys(v).every((k) => keys.includes(k));
export function parseOperationValues(v: unknown): OperationValues | undefined {
  const x = object(v);
  if (
    !x ||
    !exact(x, ["paused", "leadMinutes", "orderCapacity", "itemCapacity", "maxOpenOrders"]) ||
    typeof x.paused !== "boolean" ||
    !(x.leadMinutes === null || integer(x.leadMinutes, 0, 10080)) ||
    !optionalCapacity(x.orderCapacity) ||
    !optionalCapacity(x.itemCapacity) ||
    !optionalCapacity(x.maxOpenOrders)
  )
    return;
  return {
    paused: x.paused,
    leadMinutes: x.leadMinutes,
    orderCapacity: x.orderCapacity,
    itemCapacity: x.itemCapacity,
    maxOpenOrders: x.maxOpenOrders,
  };
}
export function parseLocationConfiguration(v: unknown): LocationConfiguration | undefined {
  const x = object(v);
  if (
    !x ||
    !exact(x, [
      "minimumLeadMinutes",
      "maximumAdvanceDays",
      "slotIntervalMinutes",
      "defaultOrderCapacity",
      "defaultItemCapacity",
      "orderCutoffMinutes",
      "acceptanceMinutes",
      "maxOpenOrders",
      "windows",
      "exceptions",
      "zones",
    ]) ||
    !integer(x.minimumLeadMinutes, 0, 10080) ||
    !integer(x.maximumAdvanceDays, 1, 365) ||
    !integer(x.slotIntervalMinutes, 5, 240) ||
    1440 % x.slotIntervalMinutes !== 0 ||
    !optionalCapacity(x.defaultOrderCapacity) ||
    !optionalCapacity(x.defaultItemCapacity) ||
    (x.defaultOrderCapacity === null && x.defaultItemCapacity === null) ||
    !integer(x.orderCutoffMinutes, 0, 1440) ||
    !integer(x.acceptanceMinutes, 1, 60) ||
    !optionalCapacity(x.maxOpenOrders) ||
    !Array.isArray(x.windows) ||
    x.windows.length > 100 ||
    !Array.isArray(x.exceptions) ||
    x.exceptions.length > 366 ||
    !Array.isArray(x.zones) ||
    x.zones.length > 100
  )
    return;
  const windows: LocationConfiguration["windows"] = [];
  for (const v of x.windows) {
    const w = object(v);
    if (
      !w ||
      !exact(w, [
        "fulfillment",
        "weekday",
        "opensAt",
        "closesAt",
        "orderCapacity",
        "itemCapacity",
      ]) ||
      !channel(w.fulfillment) ||
      !integer(w.weekday, 0, 6) ||
      !clock(w.opensAt) ||
      !clock(w.closesAt) ||
      w.opensAt === w.closesAt ||
      !optionalCapacity(w.orderCapacity) ||
      !optionalCapacity(w.itemCapacity)
    )
      return;
    windows.push({
      fulfillment: w.fulfillment,
      weekday: w.weekday,
      opensAt: w.opensAt,
      closesAt: w.closesAt,
      orderCapacity: w.orderCapacity,
      itemCapacity: w.itemCapacity,
    });
  }
  // Reject overlap, including a Saturday-to-Sunday window wrapping the week.
  const ranges = windows.map((w) => ({
    f: w.fulfillment,
    start: w.weekday * 1440 + Number(w.opensAt.slice(0, 2)) * 60 + Number(w.opensAt.slice(3)),
    end:
      w.weekday * 1440 +
      Number(w.closesAt.slice(0, 2)) * 60 +
      Number(w.closesAt.slice(3)) +
      (w.closesAt < w.opensAt ? 1440 : 0),
  }));
  if (
    ranges.some((a, i) =>
      ranges.some(
        (b, j) =>
          i < j &&
          a.f === b.f &&
          [-10080, 0, 10080].some((shift) => a.start < b.end + shift && b.start + shift < a.end),
      ),
    )
  )
    return;
  const exceptions: LocationConfiguration["exceptions"] = [];
  for (const v of x.exceptions) {
    const e = object(v);
    if (
      !e ||
      !exact(e, [
        "fulfillment",
        "date",
        "closed",
        "opensAt",
        "closesAt",
        "reason",
        "orderCapacity",
        "itemCapacity",
      ]) ||
      !channel(e.fulfillment) ||
      typeof e.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(e.date) ||
      !Number.isFinite(Date.parse(e.date)) ||
      new Date(e.date).toISOString().slice(0, 10) !== e.date ||
      typeof e.closed !== "boolean" ||
      !text(e.reason) ||
      !optionalCapacity(e.orderCapacity) ||
      !optionalCapacity(e.itemCapacity) ||
      (e.closed
        ? e.opensAt !== null || e.closesAt !== null
        : !clock(e.opensAt) || !clock(e.closesAt) || e.opensAt >= e.closesAt)
    )
      return;
    exceptions.push({
      fulfillment: e.fulfillment,
      date: e.date,
      closed: e.closed,
      opensAt: e.opensAt as string | null,
      closesAt: e.closesAt as string | null,
      reason: e.reason,
      orderCapacity: e.orderCapacity,
      itemCapacity: e.itemCapacity,
    });
  }
  if (new Set(exceptions.map((e) => e.fulfillment + e.date)).size !== exceptions.length) return;
  const zones: LocationConfiguration["zones"] = [],
    postcodes = new Set<string>();
  for (const v of x.zones) {
    const z = object(v);
    if (
      !z ||
      !exact(z, ["postalCodes", "minimumAmountMinor", "feeAmountMinor"]) ||
      !Array.isArray(z.postalCodes) ||
      z.postalCodes.length < 1 ||
      z.postalCodes.length > 1000 ||
      !integer(z.minimumAmountMinor, 0, 999999999) ||
      !integer(z.feeAmountMinor, 0, 999999999)
    )
      return;
    const codes: string[] = [];
    for (const p of z.postalCodes) {
      if (typeof p !== "string" || !/^\d{5}$/.test(p) || postcodes.has(p)) return;
      postcodes.add(p);
      codes.push(p);
    }
    zones.push({
      postalCodes: codes,
      minimumAmountMinor: z.minimumAmountMinor,
      feeAmountMinor: z.feeAmountMinor,
    });
  }
  if (postcodes.size > 10000) return;
  return {
    minimumLeadMinutes: x.minimumLeadMinutes,
    maximumAdvanceDays: x.maximumAdvanceDays,
    slotIntervalMinutes: x.slotIntervalMinutes,
    defaultOrderCapacity: x.defaultOrderCapacity,
    defaultItemCapacity: x.defaultItemCapacity,
    orderCutoffMinutes: x.orderCutoffMinutes,
    acceptanceMinutes: x.acceptanceMinutes,
    maxOpenOrders: x.maxOpenOrders,
    windows,
    exceptions,
    zones,
  };
}
export function parseLocationOperationsCommand(v: unknown): LocationOperationsCommand | undefined {
  const x = object(v);
  if (!x || !text(x.reason)) return;
  if (
    x.action === "create_draft" &&
    exact(x, ["action", "sourceVersionId", "reason"]) &&
    nullableId(x.sourceVersionId)
  )
    return { action: x.action, sourceVersionId: x.sourceVersionId, reason: x.reason };
  if (
    x.action === "save_draft" &&
    exact(x, ["action", "versionId", "expectedRevision", "configuration", "reason"]) &&
    identifier(x.versionId) &&
    integer(x.expectedRevision)
  ) {
    const configuration = parseLocationConfiguration(x.configuration);
    return configuration
      ? {
          action: x.action,
          versionId: x.versionId,
          expectedRevision: x.expectedRevision,
          configuration,
          reason: x.reason,
        }
      : undefined;
  }
  if (
    x.action === "publish" &&
    exact(x, [
      "action",
      "versionId",
      "expectedRevision",
      "expectedPublicationId",
      "expectedDeliveryPolicyId",
      "reason",
    ]) &&
    identifier(x.versionId) &&
    integer(x.expectedRevision) &&
    nullableId(x.expectedPublicationId) &&
    nullableId(x.expectedDeliveryPolicyId)
  )
    return {
      action: x.action,
      versionId: x.versionId,
      expectedRevision: x.expectedRevision,
      expectedPublicationId: x.expectedPublicationId,
      expectedDeliveryPolicyId: x.expectedDeliveryPolicyId,
      reason: x.reason,
    };
  if (
    x.action === "override" &&
    exact(x, ["action", "scope", "expectedSequence", "endsAt", "values", "reason"]) &&
    scope(x.scope) &&
    integer(x.expectedSequence) &&
    instant(x.endsAt)
  ) {
    const values = parseOperationValues(x.values);
    return values
      ? {
          action: x.action,
          scope: x.scope,
          expectedSequence: x.expectedSequence,
          endsAt: x.endsAt,
          values,
          reason: x.reason,
        }
      : undefined;
  }
  if (
    x.action === "clear_override" &&
    exact(x, ["action", "scope", "expectedSequence", "reason"]) &&
    scope(x.scope) &&
    integer(x.expectedSequence)
  )
    return {
      action: x.action,
      scope: x.scope,
      expectedSequence: x.expectedSequence,
      reason: x.reason,
    };
  return;
}
export function parseLocationOperationsState(v: unknown): LocationOperationsState | undefined {
  const x = object(v);
  if (
    !x ||
    typeof x.timezone !== "string" ||
    !instant(x.serverNow) ||
    !nullableId(x.publicationId) ||
    !nullableId(x.deliveryPolicyId) ||
    !nullableId(x.currentVersionId) ||
    !integer(x.operationSequence) ||
    !integer(x.openOrders) ||
    !Array.isArray(x.versions) ||
    x.versions.length > 50 ||
    !Array.isArray(x.overrides) ||
    x.overrides.length > 3 ||
    !Array.isArray(x.audit) ||
    x.audit.length > 30
  )
    return;
  try {
    new Intl.DateTimeFormat("en", { timeZone: x.timezone });
  } catch {
    return;
  }
  const versions: LocationOperationsState["versions"] = [];
  for (const v of x.versions) {
    const s = object(v);
    if (
      !s ||
      !identifier(s.id) ||
      !integer(s.number, 1) ||
      !integer(s.revision) ||
      (s.status !== "draft" && s.status !== "published")
    )
      return;
    const configuration = parseLocationConfiguration(s.configuration);
    if (!configuration) return;
    versions.push({
      id: s.id,
      number: s.number,
      revision: s.revision,
      status: s.status,
      configuration,
    });
  }
  const overrides: LocationOperationsState["overrides"] = [];
  for (const v of x.overrides) {
    const s = object(v);
    if (!s || !scope(s.scope) || !integer(s.sequence) || !instant(s.endsAt) || !text(s.reason))
      return;
    const values = parseOperationValues(s.values);
    if (!values) return;
    overrides.push({
      scope: s.scope,
      sequence: s.sequence,
      endsAt: s.endsAt,
      reason: s.reason,
      values,
    });
  }
  const audit: LocationOperationsState["audit"] = [];
  for (const v of x.audit) {
    const s = object(v);
    if (
      !s ||
      !identifier(s.id) ||
      !text(s.action, 80) ||
      !identifier(s.actorId) ||
      !text(s.reason) ||
      !instant(s.createdAt)
    )
      return;
    audit.push({
      id: s.id,
      action: s.action,
      actorId: s.actorId,
      reason: s.reason,
      createdAt: s.createdAt,
    });
  }
  return {
    timezone: x.timezone,
    serverNow: x.serverNow,
    publicationId: x.publicationId,
    deliveryPolicyId: x.deliveryPolicyId,
    currentVersionId: x.currentVersionId,
    operationSequence: x.operationSequence,
    openOrders: x.openOrders,
    versions,
    overrides,
    audit,
  };
}
