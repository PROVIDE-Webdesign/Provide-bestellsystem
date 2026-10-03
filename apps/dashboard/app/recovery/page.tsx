import { RecoveryPanel } from "../components/RecoveryPanel.js";
export default function RecoveryPage() {
  return (
    <main>
      <header className="hero">
        <p className="brand">PROVIDE</p>
        <h1>Konto- und MFA-Recovery</h1>
      </header>
      {process.env.ACCOUNT_RECOVERY_ENABLED === "true" &&
      process.env.DASHBOARD_AUTH_ENABLED === "true" ? (
        <RecoveryPanel />
      ) : (
        <p>Recovery ist derzeit deaktiviert.</p>
      )}
    </main>
  );
}
