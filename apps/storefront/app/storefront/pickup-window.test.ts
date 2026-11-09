import { describe, expect, it } from "vitest";
import { pickupCandidates, pickupPreviewWindow } from "./pickup-window";

const config = "the-ash-aachen-test,aachen-test,12:00,22:30,30,15";
const window = pickupPreviewWindow(config, "the-ash-aachen-test", "aachen-test")!;

describe("pickup suggestions", () => {
  it("enables the configured preview window only for the exact test location", () => {
    expect(window).toEqual({ opens: "12:00", closes: "22:30", leadMinutes: 30, stepMinutes: 15 });
    expect(pickupPreviewWindow(config, "the-ash-aachen-test", "other")).toBeUndefined();
    expect(
      pickupPreviewWindow(config.replace(",15", ",0"), "the-ash-aachen-test", "aachen-test"),
    ).toBeUndefined();
  });

  it("uses the venue timezone and respects the lead time and inclusive closing slot", () => {
    const date = new Date("2026-11-09T21:00:00Z");
    const choices = pickupCandidates(date, "Europe/Berlin", window);
    expect(choices[0]).toEqual({
      localTime: "2026-11-09T22:30",
      requestedFor: "2026-11-09T21:30:00.000Z",
    });
    expect(choices[1]?.localTime).toBe("2026-11-10T12:00");
    expect(
      pickupCandidates(new Date(date.getTime() + 1000), "Europe/Berlin", window)[0]?.localTime,
    ).toBe("2026-11-10T12:00");
    expect(choices).toHaveLength(6);
  });
});
