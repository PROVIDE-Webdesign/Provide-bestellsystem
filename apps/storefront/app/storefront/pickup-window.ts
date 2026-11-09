import { locationTimeToInstant } from "./time";

export interface PickupWindow {
  readonly opens: string;
  readonly closes: string;
  readonly leadMinutes: number;
  readonly stepMinutes: number;
}

function clockMinutes(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours! * 60 + minutes!;
}

export function pickupPreviewWindow(
  setting: string | undefined,
  restaurantSlug: string,
  locationSlug: string,
): PickupWindow | undefined {
  // Scope the preview's explicit daily window to its single test location.
  const [restaurant, location, opens, closes, lead, step, extra] = setting?.split(",") ?? [];
  const validClock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (
    restaurant !== restaurantSlug ||
    location !== locationSlug ||
    !opens ||
    !closes ||
    !validClock.test(opens) ||
    !validClock.test(closes) ||
    opens > closes ||
    !lead ||
    !step ||
    extra !== undefined ||
    !/^\d{1,3}$/.test(lead) ||
    !/^\d{1,2}$/.test(step) ||
    Number(step) < 5 ||
    Number(step) > 60
  )
    return undefined;
  return { opens, closes, leadMinutes: Number(lead), stepMinutes: Number(step) };
}

export function pickupCandidates(now: Date, timezone: string, window: PickupWindow) {
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const day = new Date(date + "T00:00:00Z");
  const earliest = now.getTime() + window.leadMinutes * 60_000;
  const candidates: { localTime: string; requestedFor: string }[] = [];

  for (let offset = 0; offset < 2 && candidates.length < 6; offset++) {
    const localDate = day.toISOString().slice(0, 10);
    for (
      let minute = clockMinutes(window.opens);
      minute <= clockMinutes(window.closes) && candidates.length < 6;
      minute += window.stepMinutes
    ) {
      const time = [Math.floor(minute / 60), minute % 60]
        .map((part) => String(part).padStart(2, "0"))
        .join(":");
      const localTime = localDate + "T" + time;
      const requestedFor = locationTimeToInstant(localTime, timezone);
      if (requestedFor && Date.parse(requestedFor) >= earliest)
        candidates.push({ localTime, requestedFor });
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return candidates;
}
