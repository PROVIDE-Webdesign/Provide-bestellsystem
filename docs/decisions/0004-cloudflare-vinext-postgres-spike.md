# ADR 0004: Cloudflare-, vinext- und PostgreSQL-Technik-Spike

## Status

Angenommen am 8. September 2026.

## Kontext

Architektur A2 empfiehlt Cloudflare Workers für Auslieferung und API sowie PostgreSQL in einer
festen EU-Region. Für die Next.js-Oberfläche ist vinext vorgesehen. Da vinext Beta-Software ist,
muss die Kombination vor Beginn der Produktentwicklung praktisch bestätigt oder kontrolliert
verworfen werden.

## Entscheidung

Die folgende technische Linie wird als Grundlage für die Produktlaufzeit angenommen:

- Storefront: Next.js über vinext auf Cloudflare Workers,
- API: eigenständiger Cloudflare Worker,
- Datenbank: Supabase PostgreSQL in Frankfurt (`eu-central-1`),
- Verbindung: Cloudflare Hyperdrive mit minimal berechtigtem Datenbankbenutzer.

Die Entscheidung wurde durch reproduzierbare Cloudflare-Preview-Deployments, erfolgreiche
Statusaufrufe für Storefront und API sowie ein erfolgreiches `SELECT 1` über Hyperdrive bestätigt.
GitHub-CI-Lauf 6 für den bestätigenden Commit `b858486` wurde erfolgreich abgeschlossen. Die
vollständigen Nachweise und Preview-Adressen stehen im Spike-Protokoll
`docs/spikes/0001-cloudflare-postgres.md`.

## Verwerfungsregeln

Die vinext-Linie wird neu bewertet, wenn mindestens einer dieser Punkte eintritt:

- Preview-Deployment oder zentrale Next.js-Funktionen sind nicht stabil reproduzierbar,
- notwendige Fehlerbehebungen erfordern das Abschalten der strikten Projektregeln,
- Sicherheits- oder Betriebsanforderungen können nicht erfüllt werden,
- ein Update beseitigt den funktionierenden Build ohne vertretbaren Migrationsweg.

In diesem Fall ist React Router 7 auf Cloudflare Workers der zuerst zu prüfende Fallback. Die
eigenständige API- und PostgreSQL-Architektur bleibt davon unberührt.

## Folgen

- vinext-Versionen bleiben für den Spike exakt festgeschrieben.
- Beta-Auffälligkeiten werden im Spike-Protokoll dokumentiert.
- Es werden ausschließlich Preview-Ressourcen und synthetische Daten verwendet.
- Änderungen an der Laufzeitlinie müssen die lokalen Prüfungen und einen reproduzierbaren
  Preview-Nachweis bestehen.
