import type { DashboardOrdersEnvironment, DashboardOrdersReader } from "./dashboard-orders.js";
import type { ApiLogger } from "./logger.js";
import { createRequestContext } from "./context.js";

export async function dispatchAcceptanceAlerts(
  environment: DashboardOrdersEnvironment,
  reader: DashboardOrdersReader,
  logger: ApiLogger,
): Promise<void> {
  if (
    environment.DASHBOARD_ORDER_ALERTS_ENABLED !== "true" ||
    environment.DASHBOARD_AUTH_ENABLED !== "true" ||
    environment.DASHBOARD_ORDER_OPERATIONS_ENABLED !== "true" ||
    environment.HYPERDRIVE_CACHE_DISABLED !== "true" ||
    !environment.HYPERDRIVE ||
    !reader.escalateAlerts
  )
    return;
  try {
    await reader.escalateAlerts(environment.HYPERDRIVE.connectionString);
  } catch {
    logger.error(createRequestContext(), "order_acceptance_escalation_failed");
  }
}
