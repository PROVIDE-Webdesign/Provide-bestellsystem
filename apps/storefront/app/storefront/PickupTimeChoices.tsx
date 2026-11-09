"use client";
import { parsePublicAvailability } from "@provide/contracts";
import { useEffect, useState } from "react";
import { pickupCandidates, type PickupWindow } from "./pickup-window";

type Candidate = ReturnType<typeof pickupCandidates>[number];

export function PickupTimeChoices({
  base,
  timezone,
  window,
  itemCount,
  localTime,
  onSelect,
}: {
  base: string;
  timezone: string;
  window: PickupWindow;
  itemCount: number;
  localTime: string;
  onSelect: (time: string) => void;
}) {
  const [state, setState] = useState<{
    count: number;
    choices: Candidate[];
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!itemCount) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        const choices: Candidate[] = [];
        try {
          for (const candidate of pickupCandidates(new Date(), timezone, window)) {
            const query = new URLSearchParams({
              fulfillmentType: "pickup",
              requestedFor: candidate.requestedFor,
              itemCount: String(itemCount),
            });
            const response = await fetch(`${base}/availability?${query}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            if (!response.ok) throw Error("Pickup availability unavailable");
            const body = (await response.json()) as { data?: unknown };
            const result = parsePublicAvailability(body.data);
            if (
              result.fulfillmentType !== "pickup" ||
              Date.parse(result.requestedFor) !== Date.parse(candidate.requestedFor) ||
              result.itemCount !== itemCount
            )
              throw Error("Pickup availability does not match");
            if (result.status === "available") choices.push(candidate);
            if (choices.length >= 3) break;
          }
          if (!controller.signal.aborted) setState({ count: itemCount, choices, error: false });
        } catch {
          if (!controller.signal.aborted) setState({ count: itemCount, choices, error: true });
        }
      })();
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [base, timezone, window, itemCount]);

  if (!itemCount) return null;
  const current = state?.count === itemCount ? state : null;
  const formatter = new Intl.DateTimeFormat("de-DE", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="pickup-time-choices">
      <p role="status">
        {!current
          ? "Freie Abholzeiten werden gesucht …"
          : current.choices.length
            ? "Freie Abholzeiten"
            : current.error
              ? "Zeitvorschläge sind gerade nicht verfügbar."
              : "Für die nächsten Zeitfenster wurde keine freie Abholzeit gefunden."}
      </p>
      {current?.choices.map((candidate, index) => (
        <button
          type="button"
          className="secondary compact"
          key={candidate.localTime}
          aria-pressed={candidate.localTime === localTime}
          onClick={() => onSelect(candidate.localTime)}
        >
          {index === 0 ? "Frühestens " : ""}
          {formatter.format(new Date(candidate.requestedFor))}
        </button>
      ))}
    </div>
  );
}
