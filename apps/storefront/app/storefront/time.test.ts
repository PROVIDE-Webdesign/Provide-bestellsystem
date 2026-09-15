import { expect, it } from "vitest";
import { locationTimeToInstant } from "./time";
it("converts restaurant time independently of the device timezone", () => {
  expect(locationTimeToInstant("2026-09-14T18:00", "Europe/Berlin")).toBe(
    "2026-09-14T16:00:00.000Z",
  );
  expect(locationTimeToInstant("2026-01-14T18:00", "Europe/Berlin")).toBe(
    "2026-01-14T17:00:00.000Z",
  );
});
it("rejects missing/duplicate DST wall times and invalid calendar days", () => {
  expect(locationTimeToInstant("2026-03-29T02:30", "Europe/Berlin")).toBeNull();
  expect(locationTimeToInstant("2026-10-25T02:30", "Europe/Berlin")).toBeNull();
  expect(locationTimeToInstant("2026-02-30T18:00", "Europe/Berlin")).toBeNull();
  expect(locationTimeToInstant("2026-09-14T18:00", "not-a-zone")).toBeNull();
});
