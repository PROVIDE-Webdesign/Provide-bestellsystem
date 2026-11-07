import type { DashboardAccessContext } from "@provide/contracts";
const key = "provide-dashboard-selected-scope";
type Scope = { restaurantId: string; locationId: string };
export function readSelectedScope(
  context: DashboardAccessContext,
  storage: Pick<Storage, "getItem">,
): Scope | undefined {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "null");
    if (
      !value ||
      typeof value !== "object" ||
      !("restaurantId" in value) ||
      !("locationId" in value)
    )
      return;
    const membership = context.memberships.find(
      (item) => item.access === "allowed" && item.restaurantId === value.restaurantId,
    );
    const location = membership?.locations.find((item) => item.id === value.locationId);
    if (membership && location)
      return { restaurantId: membership.restaurantId, locationId: location.id };
  } catch {
    /* Storage may be unavailable; access still comes from the server. */
  }
}
export function rememberSelectedScope(
  scope: Scope | undefined,
  storage: Pick<Storage, "setItem" | "removeItem">,
) {
  try {
    if (scope) storage.setItem(key, JSON.stringify(scope));
    else storage.removeItem(key);
  } catch {
    /* A blocked device preference must not prevent dashboard use. */
  }
}
