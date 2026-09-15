/** Matches a location wall-clock minute to UTC. Gaps and duplicate DST times are rejected. */
export function locationTimeToInstant(localTime: string, timezone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime)) return null;
  const naive = Date.parse(`${localTime}:00Z`);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== localTime)
    return null;
  try {
    const formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    // Derive candidate offsets around both sides of a possible timezone transition.
    const offsets = new Set<number>();
    for (const hours of [-36, 0, 36]) {
      const instant = naive + hours * 3600000;
      const wall = formatter.format(instant).replace(" ", "T");
      offsets.add(Date.parse(`${wall}:00Z`) - instant);
    }
    const matches = [...offsets]
      .map((offset) => naive - offset)
      .filter((instant) => formatter.format(instant).replace(" ", "T") === localTime);
    return matches.length === 1 ? new Date(matches[0]!).toISOString() : null;
  } catch {
    return null;
  }
}
