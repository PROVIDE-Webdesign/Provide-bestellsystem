import { DashboardClient } from "./components/DashboardClient.js";

export default function DashboardPage() {
  return (
    <main className="operator-root">
      <DashboardClient
        enabled={process.env.DASHBOARD_AUTH_ENABLED === "true"}
        personnelEnabled={process.env.DASHBOARD_PERSONNEL_ENABLED === "true"}
        historyEnabled={process.env.DASHBOARD_HISTORY_ENABLED === "true"}
        operationsEnabled={process.env.DASHBOARD_LOCATION_OPERATIONS_ENABLED === "true"}
        menuEnabled={process.env.DASHBOARD_MENU_ENABLED === "true"}
        liveEnabled={process.env.DASHBOARD_REALTIME_ENABLED === "true"}
        alertsEnabled={process.env.DASHBOARD_ORDER_ALERTS_ENABLED === "true"}
      />
    </main>
  );
}
