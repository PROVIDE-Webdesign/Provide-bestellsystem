export const restaurantRoles = ["owner", "manager", "kitchen", "driver"] as const;
export type RestaurantRole = (typeof restaurantRoles)[number];

export const dashboardAccessStates = ["allowed", "mfa_required", "suspended"] as const;
export type DashboardAccessState = (typeof dashboardAccessStates)[number];

export interface DashboardLocationAccess {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
}

export interface DashboardRestaurantSummary {
  readonly slug: string;
  readonly displayName: string;
}

export interface DashboardMembershipAccess {
  readonly restaurantId: string;
  readonly role: RestaurantRole;
  readonly status: "active" | "suspended";
  readonly access: DashboardAccessState;
  readonly restaurant: DashboardRestaurantSummary | null;
  readonly locations: readonly DashboardLocationAccess[];
}

export interface DashboardAccessContext {
  readonly aal: "aal1" | "aal2";
  readonly memberships: readonly DashboardMembershipAccess[];
}

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maximum
  );
}

function parseLocation(value: unknown): DashboardLocationAccess | undefined {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ["id", "slug", "displayName"]) ||
    typeof source.id !== "string" ||
    !uuidPattern.test(source.id) ||
    typeof source.slug !== "string" ||
    !slugPattern.test(source.slug) ||
    !text(source.displayName, 160)
  )
    return undefined;
  return { id: source.id, slug: source.slug, displayName: source.displayName };
}

function parseRestaurant(value: unknown): DashboardRestaurantSummary | undefined {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ["slug", "displayName"]) ||
    typeof source.slug !== "string" ||
    !slugPattern.test(source.slug) ||
    !text(source.displayName, 160)
  )
    return undefined;
  return { slug: source.slug, displayName: source.displayName };
}

function parseMembership(value: unknown): DashboardMembershipAccess | undefined {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ["restaurantId", "role", "status", "access", "restaurant", "locations"]) ||
    typeof source.restaurantId !== "string" ||
    !uuidPattern.test(source.restaurantId) ||
    typeof source.role !== "string" ||
    !restaurantRoles.some((role) => role === source.role) ||
    (source.status !== "active" && source.status !== "suspended") ||
    typeof source.access !== "string" ||
    !dashboardAccessStates.some((access) => access === source.access) ||
    !Array.isArray(source.locations) ||
    source.locations.length > 100
  )
    return undefined;
  const locations = source.locations.map(parseLocation);
  if (locations.some((location) => !location)) return undefined;
  const restaurant = source.restaurant === null ? null : parseRestaurant(source.restaurant);
  if (source.restaurant !== null && !restaurant) return undefined;
  if (
    (source.access === "allowed" && (source.status !== "active" || !restaurant)) ||
    (source.access !== "allowed" && (restaurant !== null || locations.length !== 0)) ||
    (source.access === "mfa_required" && source.status !== "active") ||
    (source.access === "suspended" && source.status !== "suspended")
  )
    return undefined;
  return {
    restaurantId: source.restaurantId,
    role: source.role as RestaurantRole,
    status: source.status,
    access: source.access as DashboardAccessState,
    restaurant: restaurant ?? null,
    locations: locations as DashboardLocationAccess[],
  };
}

export function parseDashboardAccessContext(value: unknown): DashboardAccessContext | undefined {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, ["aal", "memberships"]) ||
    (source.aal !== "aal1" && source.aal !== "aal2") ||
    !Array.isArray(source.memberships) ||
    source.memberships.length > 20
  )
    return undefined;
  const memberships = source.memberships.map(parseMembership);
  if (memberships.some((membership) => !membership)) return undefined;
  return { aal: source.aal, memberships: memberships as DashboardMembershipAccess[] };
}
