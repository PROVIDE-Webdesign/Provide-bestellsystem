import { menuIdPattern } from "./menu-selection.js";
import { isExplicitInstant } from "./storefront.js";

export const provideEvidenceKinds = ["document", "test", "provider"] as const;
export const onboardingStatuses = [
  "not_started",
  "in_progress",
  "ready_for_review",
  "approved",
] as const;
export const goLiveStatuses = ["blocked", "ready", "live", "paused"] as const;
export type LaunchConfiguration = {
  merchantRole: "restaurant" | null;
  payoutAccountReference: string | null;
  productionDomain: string | null;
  dataRegion: "eu-central-1" | null;
  responsibleUserId: string | null;
};
type Mutation = {
  restaurantId: string;
  locationId: string | null;
  expectedRevision: number;
  requestId: string;
  reason: string;
};
export type ProvideAdminCommand =
  | {
      action: "read";
      restaurantId?: string;
      locationId?: string;
      cursor?: string;
      locationCursor?: string;
    }
  | (Mutation & {
      action: "feature";
      featureKey: string;
      mode: "enabled" | "disabled" | "inherit";
      expiresAt: string | null;
    })
  | (Mutation & {
      action: "check";
      checkKey: string;
      status: "pending" | "passed" | "failed";
      evidenceKind: (typeof provideEvidenceKinds)[number] | null;
      evidenceReference: string | null;
    })
  | (Mutation & { action: "onboarding"; status: "in_progress" | "ready_for_review" | "approved" })
  | (Mutation & { action: "goLive"; status: "ready" | "live" | "paused"; confirmation: string })
  | (Mutation & { action: "reopen"; checkKeys: string[] })
  | (Mutation & { action: "critical"; configuration: LaunchConfiguration })
  | (Mutation & { action: "profileStatus"; status: "setup" | "active" | "suspended" })
  | (Mutation & {
      action: "createRestaurant" | "createLocation";
      displayName: string;
      slug: string;
      timezone: string;
    });
const object = (x: unknown): Record<string, unknown> | undefined =>
  typeof x === "object" && x !== null && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : undefined;
const keys = (x: Record<string, unknown>, allowed: string[]) =>
  Object.keys(x).every((k) => allowed.includes(k));
const text = (x: unknown, min: number, max: number): x is string =>
  typeof x === "string" &&
  x === x.trim() &&
  x.length >= min &&
  x.length <= max &&
  !Array.from(x).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const uuid = (x: unknown): x is string => typeof x === "string" && menuIdPattern.test(x);
const reference = (x: unknown): x is string =>
  text(x, 3, 200) && /^[A-Za-z0-9][A-Za-z0-9:/._#?=&%+-]*$/.test(x);
const member = (x: unknown, values: readonly string[]) =>
  typeof x === "string" && values.includes(x);
const featureKey = (x: unknown): x is string =>
  text(x, 3, 80) && /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(x);
const integer = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const instant = (x: unknown): x is string => typeof x === "string" && isExplicitInstant(x);
export function parseLaunchConfiguration(x: unknown): LaunchConfiguration | undefined {
  const s = object(x);
  if (
    !s ||
    Object.keys(s).length !== 5 ||
    !keys(s, [
      "merchantRole",
      "payoutAccountReference",
      "productionDomain",
      "dataRegion",
      "responsibleUserId",
    ]) ||
    (s.merchantRole !== null && s.merchantRole !== "restaurant") ||
    (s.payoutAccountReference !== null && !reference(s.payoutAccountReference)) ||
    (s.productionDomain !== null &&
      (!text(s.productionDomain, 4, 253) ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s.productionDomain))) ||
    (s.dataRegion !== null && s.dataRegion !== "eu-central-1") ||
    (s.responsibleUserId !== null && !uuid(s.responsibleUserId))
  )
    return undefined;
  return s as LaunchConfiguration;
}
export function parseProvideAdminCommand(x: unknown): ProvideAdminCommand | undefined {
  const s = object(x);
  if (!s) return undefined;
  if (s.action === "read") {
    if (
      !keys(s, ["action", "restaurantId", "locationId", "cursor", "locationCursor"]) ||
      ["restaurantId", "locationId", "cursor", "locationCursor"].some(
        (k) => s[k] !== undefined && !uuid(s[k]),
      ) ||
      ((s.locationId !== undefined || s.locationCursor !== undefined) &&
        s.restaurantId === undefined)
    )
      return undefined;
    return s as Extract<ProvideAdminCommand, { action: "read" }>;
  }
  if (
    !uuid(s.restaurantId) ||
    (s.locationId !== null && !uuid(s.locationId)) ||
    !integer(s.expectedRevision) ||
    !uuid(s.requestId) ||
    !text(s.reason, 8, 300)
  )
    return undefined;
  const common = [
    "action",
    "restaurantId",
    "locationId",
    "expectedRevision",
    "requestId",
    "reason",
  ];
  switch (s.action) {
    case "feature":
      if (
        !keys(s, [...common, "featureKey", "mode", "expiresAt"]) ||
        !featureKey(s.featureKey) ||
        !member(s.mode, ["enabled", "disabled", "inherit"]) ||
        (s.expiresAt !== null && !instant(s.expiresAt)) ||
        (s.mode === "enabled" && s.expiresAt === null) ||
        (s.mode === "inherit" && s.expiresAt !== null)
      )
        return undefined;
      break;
    case "check":
      if (
        !keys(s, [...common, "checkKey", "status", "evidenceKind", "evidenceReference"]) ||
        !featureKey(s.checkKey) ||
        !member(s.status, ["passed", "failed", "pending"]) ||
        (s.evidenceKind !== null && !provideEvidenceKinds.some((v) => v === s.evidenceKind)) ||
        (s.evidenceReference !== null && !reference(s.evidenceReference)) ||
        (s.status === "passed" && (s.evidenceKind === null || s.evidenceReference === null))
      )
        return undefined;
      break;
    case "onboarding":
      if (
        !keys(s, [...common, "status"]) ||
        !member(s.status, ["in_progress", "ready_for_review", "approved"])
      )
        return undefined;
      break;
    case "goLive":
      if (
        !keys(s, [...common, "status", "confirmation"]) ||
        !member(s.status, ["ready", "live", "paused"]) ||
        !text(s.confirmation, 3, 63)
      )
        return undefined;
      break;
    case "reopen":
      if (
        !keys(s, [...common, "checkKeys"]) ||
        !Array.isArray(s.checkKeys) ||
        s.checkKeys.length < 1 ||
        s.checkKeys.length > 30 ||
        s.checkKeys.some((k) => !featureKey(k)) ||
        new Set(s.checkKeys).size !== s.checkKeys.length
      )
        return undefined;
      break;
    case "critical":
      if (
        s.locationId !== null ||
        !keys(s, [...common, "configuration"]) ||
        !parseLaunchConfiguration(s.configuration)
      )
        return undefined;
      break;
    case "profileStatus":
      if (!keys(s, [...common, "status"]) || !member(s.status, ["setup", "active", "suspended"]))
        return undefined;
      break;
    case "createRestaurant":
    case "createLocation":
      if (
        !keys(s, [...common, "displayName", "slug", "timezone"]) ||
        !text(s.displayName, 2, 100) ||
        !text(s.slug, 3, 63) ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(s.slug)) ||
        !text(s.timezone, 3, 80) ||
        (s.action === "createRestaurant" && (s.locationId !== null || s.expectedRevision !== 0)) ||
        (s.action === "createLocation" && s.locationId === null)
      )
        return undefined;
      break;
    default:
      return undefined;
  }
  return s as ProvideAdminCommand;
}
export type ProvideAdminState = {
  serverNow: string;
  liveActionsEnabled: boolean;
  canCreateRestaurant: boolean;
  restaurants: { id: string; slug: string; displayName: string }[];
  nextRestaurantCursor: string | null;
  selected: null | {
    restaurantId: string;
    scopeSlug: string;
    scopeDisplayName: string;
    slug: string;
    displayName: string;
    revision: number;
    canManageRestaurant: boolean;
    locationId: string | null;
    locations: { id: string; slug: string; displayName: string }[];
    nextLocationCursor: string | null;
    profileStatus: "setup" | "active" | "suspended";
    onboardingStatus: (typeof onboardingStatuses)[number];
    goLiveStatus: (typeof goLiveStatuses)[number];
    configuration: LaunchConfiguration | null;
    checks: {
      key: string;
      description: string;
      required: boolean;
      status: "pending" | "passed" | "failed";
      checkedAt: string | null;
      checkedByUserId: string | null;
      evidenceKind: (typeof provideEvidenceKinds)[number] | null;
      evidenceReference: string | null;
    }[];
    features: {
      key: string;
      description: string;
      mode: "enabled" | "disabled" | "inherit";
      expiresAt: string | null;
      reason: string | null;
      effectiveEnabled: boolean;
      restaurantEnabled: boolean;
    }[];
    audit: {
      id: string;
      at: string;
      locationId: string | null;
      action: string;
      actorUserId: string | null;
      reason: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }[];
  };
};
export function parseProvideAdminState(x: unknown): ProvideAdminState | undefined {
  const s = object(x);
  if (
    !s ||
    !keys(s, [
      "serverNow",
      "liveActionsEnabled",
      "canCreateRestaurant",
      "restaurants",
      "nextRestaurantCursor",
      "selected",
    ]) ||
    !instant(s.serverNow) ||
    typeof s.liveActionsEnabled !== "boolean" ||
    typeof s.canCreateRestaurant !== "boolean" ||
    !Array.isArray(s.restaurants) ||
    s.restaurants.length > 25 ||
    (s.nextRestaurantCursor !== null && !uuid(s.nextRestaurantCursor))
  )
    return undefined;
  const scope = (v: unknown) => {
    const r = object(v);
    return (
      !!r &&
      keys(r, ["id", "slug", "displayName"]) &&
      uuid(r.id) &&
      text(r.slug, 2, 63) &&
      text(r.displayName, 1, 100)
    );
  };
  if (
    s.restaurants.some((r) => !scope(r)) ||
    new Set(s.restaurants.map((r) => object(r)?.id)).size !== s.restaurants.length
  )
    return undefined;
  if (s.selected !== null) {
    const v = object(s.selected);
    if (
      !v ||
      !keys(v, [
        "restaurantId",
        "scopeSlug",
        "scopeDisplayName",
        "slug",
        "displayName",
        "revision",
        "canManageRestaurant",
        "locationId",
        "locations",
        "nextLocationCursor",
        "profileStatus",
        "onboardingStatus",
        "goLiveStatus",
        "configuration",
        "checks",
        "features",
        "audit",
      ]) ||
      !uuid(v.restaurantId) ||
      !text(v.scopeSlug, 2, 63) ||
      !text(v.scopeDisplayName, 1, 100) ||
      !text(v.slug, 3, 63) ||
      !text(v.displayName, 1, 100) ||
      !integer(v.revision) ||
      typeof v.canManageRestaurant !== "boolean" ||
      (v.locationId !== null && !uuid(v.locationId)) ||
      !Array.isArray(v.locations) ||
      v.locations.length > 25 ||
      v.locations.some((l) => !scope(l)) ||
      (v.nextLocationCursor !== null && !uuid(v.nextLocationCursor)) ||
      !member(v.profileStatus, ["setup", "active", "suspended"]) ||
      !onboardingStatuses.some((t) => t === v.onboardingStatus) ||
      !goLiveStatuses.some((t) => t === v.goLiveStatus) ||
      (v.configuration !== null && !parseLaunchConfiguration(v.configuration)) ||
      !Array.isArray(v.checks) ||
      v.checks.length > 40 ||
      !Array.isArray(v.features) ||
      v.features.length > 20 ||
      !Array.isArray(v.audit) ||
      v.audit.length > 30
    )
      return undefined;
    for (const raw of v.checks) {
      const c = object(raw);
      if (
        !c ||
        !keys(c, [
          "key",
          "description",
          "required",
          "status",
          "checkedAt",
          "checkedByUserId",
          "evidenceKind",
          "evidenceReference",
        ]) ||
        !featureKey(c.key) ||
        !text(c.description, 1, 500) ||
        typeof c.required !== "boolean" ||
        !member(c.status, ["pending", "passed", "failed"]) ||
        (c.checkedAt !== null && !instant(c.checkedAt)) ||
        (c.checkedByUserId !== null && !uuid(c.checkedByUserId)) ||
        (c.evidenceKind !== null && !provideEvidenceKinds.some((t) => t === c.evidenceKind)) ||
        (c.evidenceReference !== null && !reference(c.evidenceReference))
      )
        return undefined;
    }
    for (const raw of v.features) {
      const f = object(raw);
      if (
        !f ||
        !keys(f, [
          "key",
          "description",
          "mode",
          "expiresAt",
          "reason",
          "effectiveEnabled",
          "restaurantEnabled",
        ]) ||
        !featureKey(f.key) ||
        !text(f.description, 1, 500) ||
        !member(f.mode, ["enabled", "disabled", "inherit"]) ||
        (f.expiresAt !== null && !instant(f.expiresAt)) ||
        (f.reason !== null && !text(f.reason, 1, 300)) ||
        typeof f.effectiveEnabled !== "boolean" ||
        typeof f.restaurantEnabled !== "boolean"
      )
        return undefined;
    }
    for (const raw of v.audit) {
      const a = object(raw);
      if (
        !a ||
        !keys(a, [
          "id",
          "at",
          "locationId",
          "action",
          "actorUserId",
          "reason",
          "before",
          "after",
        ]) ||
        !uuid(a.id) ||
        !instant(a.at) ||
        (a.locationId !== null && !uuid(a.locationId)) ||
        (a.actorUserId !== null && !uuid(a.actorUserId)) ||
        !text(a.action, 1, 100) ||
        !text(a.reason, 1, 300) ||
        (a.before !== null && !object(a.before)) ||
        (a.after !== null && !object(a.after)) ||
        JSON.stringify(a).length > 8192
      )
        return undefined;
    }
  }
  return s as ProvideAdminState;
}
