import { ProvideAuthClient } from "../components/ProvideAuthClient.js";
export default function ProvidePage() {
  const enabled =
    process.env.DASHBOARD_AUTH_ENABLED === "true" && process.env.PROVIDE_ADMIN_ENABLED === "true";
  return (
    <main>
      <header>
        <p className="eyebrow">PROVIDE · Plattformbetrieb</p>
        <h1>PROVIDE-Administration</h1>
        <p>Mandantenfreigaben und Feature-Regeln mit eigenständigen Berechtigungen.</p>
        <a href="/">Restaurant-Dashboard öffnen</a>
      </header>
      {enabled ? (
        <ProvideAuthClient />
      ) : (
        <section className="panel">
          <h2>Zugang derzeit geschlossen</h2>
          <p>Die Plattformverwaltung ist noch nicht freigeschaltet.</p>
        </section>
      )}
    </main>
  );
}
