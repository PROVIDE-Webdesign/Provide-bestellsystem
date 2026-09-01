const checks = [
  "React Server Components",
  "Serverseitiges Rendering",
  "Cloudflare-Workers-Bundle",
  "Route Handler",
];

export default function Home() {
  return (
    <main>
      <section aria-labelledby="spike-title">
        <p className="eyebrow">PROVIDE-BS · Arbeitsblock 1.3</p>
        <h1 id="spike-title">Cloudflare-Laufzeitprüfung</h1>
        <p className="intro">
          Diese interne Vorschau prüft ausschließlich die technische Grundlage. Sie verarbeitet
          keine echten Kunden-, Zahlungs- oder Bestelldaten.
        </p>

        <ul>
          {checks.map((check) => (
            <li key={check}>
              <span aria-hidden="true">✓</span>
              {check}
            </li>
          ))}
        </ul>

        <a href="/api/health">Technischen Status als JSON öffnen</a>
      </section>
    </main>
  );
}
