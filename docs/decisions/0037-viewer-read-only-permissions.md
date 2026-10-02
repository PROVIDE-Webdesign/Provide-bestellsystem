# Viewer Berechtigung

## Status

Umsetzung A3 gemäß Architektur A2 Abschnitt 9 und Projektprotokoll E11. Getrennter Arbeitsblock 3.21
auf dem technisch endfreigegebenen PR19-Head `454352973d5cca1d5e00a41e01eada80d7f9658d`. Kein
Ready-Wechsel, Merge oder Deployment.

A2 führt Viewer als Restaurantrolle auf, legt jedoch keine eigenen Detailrechte fest. Diese
Entscheidung konkretisiert A3 nach dem Prinzip minimaler Berechtigung. Sie gewährt keine zusätzliche
Historien-, Kennzahlen-, Verwaltungs- oder Kundendatenberechtigung.

## Vertrag

| Fähigkeit                              | Viewer                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| Standortzugriff                        | Nur ausdrücklich zugewiesene Standorte desselben Restaurants                               |
| Anmeldung                              | Verifizierte Auth-Identität, aktive Mitgliedschaft, aal1 oder aal2, kein aktiver Auth-Bann |
| Bestellübersicht                       | Begrenzte Listen, Status-/Erfüllungsfilter, exakte Bestellnummernsuche                     |
| Bestelldetail                          | Unveränderliche Artikel-/Auswahl-/Betrags-/Steuer-Snapshots und Status                     |
| Kundendaten                            | Kein Name, Telefon, E-Mail, Lieferempfänger oder private Lieferadresse                     |
| Onlinezahlung                          | Nur Erhebungsart; keine Zahlungs-/Providerdetails oder Erstattungsaktion                   |
| Kommunikation                          | Keine Kommunikationsrevision, bestätigte Zeit oder Versandaktion                           |
| Statuswechsel                          | Keine erlaubten Übergänge; jeder bestehende Schreibbefehl bleibt gesperrt                  |
| Bestelleingang und Realtime            | Nur datensparsame Hinweise und aktuelle autorisierte Leseprojektionen                      |
| Historie und Kennzahlen                | Gesperrt; kein Kundennamensuchen, Export oder Gesamtaudit                                  |
| Personal, Menü, Betrieb, Konfiguration | Verwaltung gesperrt; auch keine administrative Leseprojektion                              |
| PROVIDE-Administration                 | Keine Plattformrechte durch Restaurantmitgliedschaft                                       |
| Viewer-Verwaltung                      | Bestehender auditierter Owner-Ablauf mit aal2 und ausdrücklichem Standortumfang            |

Manager behalten ihre bestehende Grenze auf Kitchen/Driver. A3 erweitert ihre
Personalverwaltungsrechte nicht. Einladung, bewusste Annahme durch den Empfänger, Suspendierung,
Reaktivierung und Standortwechsel nutzen den A1-Revisions-/Audit-/Replayvertrag. Die Annahme einer
eigenen Einladung und Auth-Anmeldung/Abmeldung sind persönliche Zugangsabläufe, keine fachlichen
Viewer-Schreibrechte.

## Sicherheitsgrenzen

`private.dashboard_order_reader_role` ist eine neue interne Lesefähigkeit. Der bisherige
`dashboard_order_actor_role` bleibt unverändert und erlaubt Viewer niemals Schreibzugriff. Listen,
Nummernsuche, Detail, Alarmprojektion und Broadcast-Autorisierung verwenden die Lesefähigkeit;
bestehende Status-, Kommunikations-, Menü-, Betriebs-, Personal- und Zahlungsbefehle verwenden
weiterhin ihre bisherigen engeren Gates.

Details werden aus einer ausdrücklichen Feldauswahl aufgebaut, nicht durch Entfernen einiger
Schlüssel aus einer privilegierten Antwort. Der bestehende Detailpfad mit allen Anreicherungen
bleibt für Owner/Manager/Kitchen erhalten. Viewer-Rohdatenzugriff auf Bestellungen, Positionen,
Kundenkontakte und Lieferdetails bleibt unter bestehender RLS gesperrt. Allgemeine
Mitgliedschafts-/Standort-RLS-Helfer werden nicht erweitert. Die eigene Mitgliedschaft/Zuordnung
bleibt nach den bestehenden Selbstlesepolicies sichtbar.

Neue interne Funktionen verwenden ein leeres `search_path`, vollständig qualifizierte Tabellen und
widerrufene Standard-EXECUTE-Rechte. Nur bereits bestehende, begrenzte Serverprojektionen bleiben
für service_role ausführbar. Der Browser kann weder Identität noch Rolle für eine SQL-Projektion
vorgeben. Rolle stammt aus aktueller Mitgliedschaft, nicht aus `user_metadata` oder einem vom
Browser gesendeten Rollenwert.

Jeder neue Datenabruf prüft aktuelle Mitgliedschaft, Standortzuweisung und Auth-Bann. Entzug
verweigert sofort weitere Snapshots mit demselben Token. Das Dashboard entfernt Daten und beendet
die Verbindung bei 401/403. Realtime prüft Kanalrechte beim Join bzw. erneuter Autorisierung;
bereits verbundene Kanäle sind nicht als sofortiger serverseitiger Disconnect-Nachweis zu verstehen.
Nachrichten enthalten ausschließlich zufällige Invalidierungs-IDs, keine fachlichen Daten.
Client-Senden/Presence bleibt gesperrt.

R20-01 ergänzt den Zugangskontext um denselben aktuellen Auth-Bann-Abgleich. Bei aktivem Bann
liefert der bestehende HTTP-200-Vertrag `{ aal, memberships: [] }`: keine erlaubte Mitgliedschaft,
Restaurant- oder Standortprofile. Die Oberfläche zeigt ihren bestehenden Zustand ohne
Mitgliedschaften und keine Bestellansicht. Mitgliedschaften/Zuordnungen werden nicht geändert; nach
Aufhebung oder Ablauf des Banns gelten wieder die bisherigen Rollen-/MFA-Gates. Die additive
Migration schreibt keinen früheren Migrationsstand um. Ein gültiges JWT allein umgeht den aktuellen
Datenbankabgleich nicht. Der Kontext ist kein erfolgreicher fachlicher Bestellzugriff; Bestellabrufe
bleiben während des Banns HTTP 403.

Das Dashboard kennzeichnet Viewer als „nur lesen“ und sperrt Änderungsaktionen zusätzlich zur
Serverprüfung, auch bei einer synthetisch überprivilegierten Antwort. Alle bestehenden
Feature-Defaults und Betriebsfreigaben bleiben unverändert.

## Nachweis und Grenzen

SQL0035 prüft Tenant/Standort/AAL/Bann, minimierte Antworten, direkte Schreibverbote, tatsächliche
Lieferadresse und Onlinezahlungszustand mit positiven Owner-Gegenproben, Rohdaten-RLS,
Broadcast-Grenzen sowie Owner-Einladung/Annahme und Entzug. Die tatsächliche isolierte
Auth-/HTTP-/PostgreSQL-Kette prüft Kitchen und Viewer getrennt; private Realtime prüft Viewer-Join,
echte Zustellung, Fremdkanal-/Sendeverbot und Neuauthorisierung nach Entzug. Browserregressionen
prüfen echte Komponenten mit synthetischem Transport in Chromium/Firefox/WebKit bei 390/1440 px.

F01–F03 bleiben bis „Laptop wieder verfügbar“ eingefroren. Keine native Safari-/NVDA-, Geräte-,
Live- oder Produktionsabnahme wird aus automatisierten Tests abgeleitet. Technischer Abschluss
benötigt fünf erfolgreiche Pflichtjobs am finalen A3-Head und visuelle QA der dazugehörigen
Artefakte.

## Referenzen

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase Changelog](https://supabase.com/changelog), geprüft am 02.10.2026.

Keine SDK-/Postgres-/OrioleDB-Umstellung. Die aktuellen Hinweise zu PostgreSQL 15.19/17.11, ltree,
Legacy-PGP, float/NaN-btree_gist und eigenen Operatoren führen für die A3-Migration zu keiner
Änderung; diese Funktionen/Indexarten werden hier nicht neu eingesetzt.
