import { describe, expect, it } from "vitest";

import { formatMoney, formatOrderTime, orderStatusLabels, transitionLabels } from "./order-ui.js";

describe("dashboard order presentation", () => {
  it("uses explicit German status and action labels", () => {
    expect(orderStatusLabels.preparing).toBe("In Zubereitung");
    expect(transitionLabels.ready).toBe("Als abholbereit markieren");
  });

  it("formats server amounts and instants without changing their value", () => {
    expect(formatMoney(2500, "EUR")).toContain("25,00");
    expect(formatOrderTime("2026-09-15T18:00:00.000Z")).toContain("20:00");
  });
});
