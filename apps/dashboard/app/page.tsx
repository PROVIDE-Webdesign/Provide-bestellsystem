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
      <DashboardClient enabled={process.env.DASHBOARD_AUTH_ENABLED === "true"} />
    </main>
  );
}
