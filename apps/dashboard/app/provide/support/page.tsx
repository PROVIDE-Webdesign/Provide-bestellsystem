import { ProvideAuthClient } from "../../components/ProvideAuthClient.js";
export default function SupportPage() {
  const enabled =
    process.env.DASHBOARD_AUTH_ENABLED === "true" && process.env.SUPPORT_CASES_ENABLED === "true";
  return (
    <main>
      <header>
        <p className="eyebrow">PROVIDE · Support</p>
        <h1>Supportfälle</h1>
        <p>Interne Bearbeitung und gespeicherte Abgleichsnachweise.</p>
        <a href="/provide">Plattformverwaltung öffnen</a>
      </header>
      {enabled ? (
        <ProvideAuthClient support />
      ) : (
        <section className="panel">
          <h2>Zugang derzeit geschlossen</h2>
          <p>Supportfälle sind noch nicht freigeschaltet.</p>
        </section>
      )}
    </main>
  );
}
