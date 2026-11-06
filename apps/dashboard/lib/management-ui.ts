import type {
  MenuAdminState,
  MenuAdminVersion,
  MenuDraftItem,
  LocationOperationsState,
  LocationConfiguration,
} from "@provide/contracts";
export type SettingsTopic =
  "acceptance" | "hours" | "capacity" | "delivery" | "exceptions" | "publication";
export function countMenuChanges(
  draft: MenuAdminVersion | null | undefined,
  baseline: MenuAdminVersion | null | undefined,
): number {
  if (!draft || draft.status !== "draft") return 0;
  if (!baseline) return draft.items.length + draft.sections.length;
  const changed = draft.items.filter(
    (item, index) =>
      JSON.stringify(item) !== JSON.stringify(baseline.items.find((old) => old.id === item.id)) ||
      (baseline.items.some((old) => old.id === item.id) && baseline.items[index]?.id !== item.id),
  ).length;
  return (
    changed +
    baseline.items.filter((old) => !draft.items.some((item) => item.id === old.id)).length +
    (JSON.stringify(draft.sections) === JSON.stringify(baseline.sections) ? 0 : 1)
  );
}
export function menuItemAvailability(
  item: MenuDraftItem,
  stops: MenuAdminState["stops"],
  menuId: string,
  now: number,
): string {
  if (!item.isActive) return "Inaktiv";
  const active = stops.filter(
    (stop) =>
      stop.menuId === menuId &&
      stop.itemId === item.id &&
      stop.blocked &&
      (!stop.endsAt || Date.parse(stop.endsAt) > now),
  );
  return active.some((stop) => stop.choiceId === null)
    ? "Ausverkauft"
    : active.length
      ? "Teilweise ausverkauft"
      : "Verfügbar";
}
export function todayOpening(
  configuration: LocationConfiguration | undefined,
  timezone: string,
  now: number,
): string {
  if (!configuration) return "Regeln ausstehend";
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now),
  );
  const ranges = new Set<string>();
  for (const fulfillment of ["pickup", "delivery"] as const) {
    const exceptions = configuration.exceptions.filter(
      (item) => item.fulfillment === fulfillment && item.date === date,
    );
    if (exceptions.length)
      for (const item of exceptions) {
        if (!item.closed && item.opensAt && item.closesAt)
          ranges.add(`${item.opensAt}–${item.closesAt}`);
      }
    else
      for (const item of configuration.windows.filter(
        (item) => item.fulfillment === fulfillment && item.weekday === day,
      ))
        ranges.add(`${item.opensAt}–${item.closesAt}`);
  }
  return ranges.size ? `Heute ${[...ranges].sort().join(", ")}` : "Heute geschlossen";
}
export function preparedSettingsChanges(state: LocationOperationsState | null): number {
  if (!state) return 0;
  const current = state.versions.find((v) => v.id === state.currentVersionId)?.configuration;
  const draft = state.versions.find((v) => v.status === "draft")?.configuration;
  if (!draft) return 0;
  return (Object.keys(draft) as (keyof LocationConfiguration)[]).filter(
    (key) => JSON.stringify(draft[key]) !== JSON.stringify(current?.[key]),
  ).length;
}
