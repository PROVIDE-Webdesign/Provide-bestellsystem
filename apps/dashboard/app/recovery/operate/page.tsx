import { RecoveryPanel } from "../../components/RecoveryPanel.js";
export default function RecoveryOperatePage() {
  return (
    <main>
      <header className="hero">
        <p className="brand">PROVIDE</p>
        <h1>Unabhängige Recovery-Prüfung</h1>
      </header>
      {process.env.ACCOUNT_RECOVERY_ENABLED === "true" &&
      process.env.DASHBOARD_AUTH_ENABLED === "true" ? (
        <RecoveryPanel operator />
      ) : (
        <p>Recovery ist derzeit deaktiviert.</p>
      )}
    </main>
  );
}
