import { describe, expect, it, vi } from "vitest";
import { dispatchAcceptanceAlerts } from "./order-alerts.js";
import type { DashboardOrdersReader } from "./dashboard-orders.js";
describe("acceptance escalation dispatcher", () => {
  const enabled = {
    DASHBOARD_AUTH_ENABLED: "true",
    DASHBOARD_ORDER_OPERATIONS_ENABLED: "true",
    DASHBOARD_ORDER_ALERTS_ENABLED: "true",
    HYPERDRIVE_CACHE_DISABLED: "true",
    HYPERDRIVE: { connectionString: "synthetic-test" },
  };
  function fixture() {
    const escalateAlerts = vi.fn().mockResolvedValue(1);
    const reader: DashboardOrdersReader = {
      list: vi.fn(),
      detail: vi.fn(),
      transition: vi.fn(),
      escalateAlerts,
    };
    return { reader, escalateAlerts, logger: { error: vi.fn() } };
  }
  it.each([
    "DASHBOARD_AUTH_ENABLED",
    "DASHBOARD_ORDER_OPERATIONS_ENABLED",
    "DASHBOARD_ORDER_ALERTS_ENABLED",
    "HYPERDRIVE_CACHE_DISABLED",
  ])("requires %s independently", async (key) => {
    const { reader, escalateAlerts, logger } = fixture();
    await dispatchAcceptanceAlerts({ ...enabled, [key]: "false" }, reader, logger);
    expect(escalateAlerts).not.toHaveBeenCalled();
  });
  it("runs a bounded database batch and logs only its failure class", async () => {
    const { reader, escalateAlerts, logger } = fixture();
    await dispatchAcceptanceAlerts(enabled, reader, logger);
    expect(escalateAlerts).toHaveBeenCalledWith("synthetic-test");
    escalateAlerts.mockRejectedValueOnce(Error("private customer data"));
    await dispatchAcceptanceAlerts(enabled, reader, logger);
    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      "order_acceptance_escalation_failed",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("customer data");
  });
});
