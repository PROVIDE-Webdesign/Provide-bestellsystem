# Viewer Berechtigung prüfen

Der verbindliche Vertrag steht in
[Entscheidung 0037](../decisions/0037-viewer-read-only-permissions.md). Die Migration ist ergänzend;
alte Migrationen dürfen nicht umgeschrieben werden. Keine Anwendung auf ein entferntes Projekt ohne
gesonderte Freigabe.

## Isolierte Prüfung

```bash
pnpm check
supabase start -x studio,storage-api,imgproxy,postgres-meta,edge-runtime,logflare,vector,supavisor
supabase test db
supabase db advisors --local --type security --level warn --fail-on error
node scripts/ci-realtime-env.mjs
pnpm --filter @provide/api exec vitest run src/realtime.integration.test.ts
pnpm --filter @provide/api exec vitest run src/personnel.integration.test.ts
BROWSER_ENGINE=chromium pnpm --filter @provide/storefront test:browser
BROWSER_ENGINE=firefox pnpm --filter @provide/storefront test:browser
BROWSER_ENGINE=webkit pnpm --filter @provide/storefront test:browser
```

Die CI stellt die nötigen Loopback-Variablen und Browser bereit. Für manuelle lokale
Integrationsläufe zusätzlich `TEST_DATABASE_URL` auf die isolierte Loopback-DB setzen;
`ci-realtime-env.mjs` schreibt Credentials nur in die CI-Umgebung. Ohne explizite isolierte
Variablen übersprungene Integrationstests sind kein PASS. Kein Secret, JWT, Auth-Link oder echte
Kundendaten in Nachweisdateien speichern.

## Erwartung

Owner verwaltet Viewer über die vorhandene bestätigte, begründete und auditierte Personalansicht.
Mindestens ein eigener Standort ist erforderlich; Manager dürfen Viewer nicht verwalten. Empfänger
nimmt nur seine eigene Einladung bewusst an. Owner/Manager benötigen unverändert aal2; Viewer darf
mit verifiziertem aal1 lesen.

Viewer sieht ausschließlich zugewiesene Standorte, begrenzte Bestellübersichten, exakte Nummernsuche
und minimierte Snapshots. Direkte Status-/Zeit-/Liefer-/Erstattungs-,
Personal-/Menü-/Betriebs-/Konfigurationsbefehle und Plattformrechte müssen scheitern. Rohdaten
bleiben durch RLS gesperrt. Nach Standortentzug/Suspendierung/Bann scheitert der nächste Abruf; die
Ansicht wird bei 401/403 geleert. Bereits autorisierte Realtime- Verbindungen garantieren keinen
sofortigen Disconnect; keine PII in Invalidierungshinweisen.

## Rücknahme und Freigaben

Kein automatisches Down-Migrationsskript: bestehende Viewer-Mitgliedschaften/Einladungen dürfen
nicht still in eine andere Rolle umgedeutet werden. Bei einem Befund Dashboard- Feature deaktiviert
lassen oder Viewer über Owner suspendieren; produktive Eingriffe brauchen gesonderte Freigabe.
Code-/Schemaänderungen als weitere geprüfte Migration.

R20-01: Nach isoliertem Auth-Bann mit demselben noch gültigen Empfänger-Token den Zugangskontext
erneut abrufen. Erwartet: HTTP 200, `no-store`, `memberships: []`, keine Profile oder erlaubte
Mitgliedschaft; Bestellabruf HTTP 403. Nach Aufhebung/Ablauf des Banns wieder ausschließlich die
vorherige explizite Zuordnung. SQL0035 prüft beide AAL-Werte und Owner-/Manager-MFA-Gegenproben; die
tatsächliche Personal-/Auth-Integration prüft Kitchen und Viewer ohne Tokenwechsel. Browserbilder
`viewer-banned-context-390/1440.png` belegen den vorhandenen sicheren Leerzustand (synthetischer
Transport, keine Live-Auth-Abnahme).

Fünf grüne Pflichtjobs müssen zum finalen PR-Head passen. Browserbilder visuell prüfen;
synthetischer Browsertransport ersetzt die tatsächlichen Integrationsketten nicht. Draft,
Nutzer-Endfreigabe, Ready, Merge, Deployment und Livebetrieb bleiben getrennt. F01–F03 sind
weiterhin eingefroren.
