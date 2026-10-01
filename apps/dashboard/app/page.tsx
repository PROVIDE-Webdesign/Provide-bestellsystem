import { DashboardClient } from "./components/DashboardClient.js";

export default function DashboardPage() {
  return (
    <main>
      <header className="hero">
        <p className="brand">PROVIDE</p>
        <p className="eyebrow">Restaurantbetrieb</p>
        <h1>Sicheres Dashboard</h1>
        <p>Mitgliedschaft, Rolle, Standort und MFA werden vor jedem fachlichen Zugriff geprüft.</p>
      </header>
      <DashboardClient
        enabled={process.env.DASHBOARD_AUTH_ENABLED === "true"}
        historyEnabled={process.env.DASHBOARD_HISTORY_ENABLED === "true"}
        operationsEnabled={process.env.DASHBOARD_LOCATION_OPERATIONS_ENABLED === "true"}
        menuEnabled={process.env.DASHBOARD_MENU_ENABLED === "true"}
        liveEnabled={process.env.DASHBOARD_REALTIME_ENABLED === "true"}
        alertsEnabled={process.env.DASHBOARD_ORDER_ALERTS_ENABLED === "true"}
      />
    </main>
  );
}
