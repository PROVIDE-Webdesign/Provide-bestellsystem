import { InvitationEntry } from "../components/InvitationEntry.js";
export default function InvitationsPage() {
  return (
    <main>
      <header className="hero">
        <p className="brand">PROVIDE</p>
        <h1>Restaurant-Einladung</h1>
        <p>
          Restaurantrechte entstehen nach deiner bewussten Annahme; verantwortliche Rollen benötigen
          MFA.
        </p>
      </header>
      {process.env.DASHBOARD_AUTH_ENABLED === "true" &&
      process.env.DASHBOARD_PERSONNEL_ENABLED === "true" ? (
        <InvitationEntry />
      ) : (
        <p>Einladungsannahme ist derzeit deaktiviert.</p>
      )}
    </main>
  );
}
