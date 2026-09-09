# Technik-Spike 0001: Cloudflare und PostgreSQL

## Status

Bestanden. Lokaler und externer Preview-Nachweis wurden am 8. September 2026 erfolgreich
abgeschlossen.

## Ziel

Arbeitsblock 1.3 prüft, ob die in Architektur A2 empfohlene Laufzeit tragfähig ist:

- Next.js-Oberfläche über vinext auf Cloudflare Workers,
- eigenständige Cloudflare-Workers-API,
- PostgreSQL in Supabase Frankfurt (`eu-central-1`),
- Datenbankzugriff ausschließlich über Cloudflare Hyperdrive und einen minimal berechtigten
  Datenbankbenutzer.

Der Spike verarbeitet nur synthetische Testdaten. Produktivzahlungen, echte Bestellungen und echte
Kundendaten sind ausgeschlossen.

## Implementierter Nachweis

### Storefront

- minimale Next.js-Anwendung mit vinext und Cloudflare-Vite-Plugin,
- interne Statusseite ohne Suchmaschinenindexierung,
- `GET /api/health`,
- Worker-Konfiguration für die Preview-Umgebung.

### API

- eigenständiger Worker mit `GET /health`,
- `GET /health/database` führt über Hyperdrive `SELECT 1 AS healthy` aus,
- neue PostgreSQL-Verbindung pro Anfrage,
- keine Ausgabe von Zugangsdaten oder internen Datenbankfehlern an den Client,
- fehlende oder nicht erreichbare Datenbank liefert kontrolliert HTTP 503.

## Lokales Ergebnis

Der vollständige Workspace-Check ist grün:

- Formatierung,
- Linting,
- TypeScript-Prüfung,
- 13 automatisierte Tests,
- API-Worker-Dry-Run-Build,
- Storefront-vinext-Build.

## Beobachtete Beta-Risiken

vinext ist weiterhin Beta. Im Spike wurden zwei konkrete Integrationskanten festgestellt:

1. Der Rückgabewert von `cdnAdapter()` musste so eingebunden werden, dass optionale
   `undefined`-Werte nicht gegen die strikten TypeScript-Regeln des Projekts verstoßen.
2. Vitest benötigt eine getrennte Vite-Konfiguration, damit beim Testlauf nicht das vollständige
   Cloudflare-Build-Plugin geladen wird.

Zusätzlich meldet die statische vinext-Analyse für die Startseite derzeit eine nicht eindeutig
bestimmbare Routenklassifikation. Der Build selbst ist erfolgreich. Diese Punkte werden beim
Preview-Test beobachtet; sie reichen noch nicht aus, den vorgesehenen React-Router-Fallback
auszulösen.

## Externes Preview-Ergebnis

Der externe Nachweis wurde mit ausschließlich synthetischer Infrastruktur erfolgreich erbracht:

1. Die Storefront-Preview ist unter `https://provide-bs-storefront-preview.alpaysey.workers.dev/`
   erreichbar.
2. `GET /api/health` der Storefront antwortet mit HTTP 200 und `status: "ok"`.
3. Die API-Preview ist unter `https://provide-bs-api-preview.alpaysey.workers.dev/` erreichbar.
4. `GET /health` der API antwortet mit HTTP 200, `database: "configured"` und `status: "ok"`.
5. Hyperdrive ist über die Konfiguration `provide-bs-postgres-preview` mit der
   Supabase-Testdatenbank in Frankfurt verbunden.
6. `GET /health/database` antwortet nach erfolgreichem `SELECT 1` mit HTTP 200,
   `database: "reachable"` und `status: "ok"`.
7. GitHub-CI-Lauf 6 für Commit `b858486` ist nach 45 Sekunden erfolgreich abgeschlossen.

Der Datenbankzugang verwendet den separaten, minimal berechtigten Preview-Benutzer. Zugangsdaten
liegen weder im Repository noch in den öffentlich ausgegebenen Statusantworten. Der kontrollierte
HTTP-503-Fehlerpfad wird durch die automatisierten Tests abgedeckt.

Damit ist Arbeitsblock 1.3 abgeschlossen und die in ADR 0004 beschriebene Laufzeitentscheidung
angenommen.
