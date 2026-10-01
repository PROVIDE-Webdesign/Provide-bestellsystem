# ADR 0035: Getrennte PROVIDE-Administration und auditierte Features

Status: technischer Entwurf. Auftrag A2/O2, Paket 4, 01.10.2026. Baut auf B5/PR17 auf.

## Rechte und Zugriff

`/provide` und POST `/v1/provide/administration` bilden einen eigenen Verwaltungsschnitt.
Restaurant-Owner/Manager erhalten dadurch keine Plattformrechte. Private explizite Grants können
global, für einen Mandanten oder für einen Standort gelten. AAL2, aktive Grants und Auth-Sperre
werden bei jedem Aufruf aus der Datenbank geprüft; Actor/Scope werden nicht aus Benutzer-Metadaten
übernommen. Standort-Grants sehen nur ihre Standorte, deren Prüfungen/Audit und einen minimierten
Mandantenüberblick ohne kritische Nachweisgrundlage. Die alten Übergangsfunktionen sind interne
Helfer ohne service-role-Ausführungsrecht; der auditierte Befehl ist der einzige neue
RPC-Schreibweg.

Neue private Tabellen haben erzwungene RLS und keine direkten Browser-/Service-DML-Rechte.
Security-definer-Funktionen nutzen leeren search_path, explizite ACL und parameterisierte Aufrufe.
Per-request PG-Verbindungen, Zeitlimits, abgeschalteter Hyperdrive-Cache, serverseitiges JWT und
gleiche Origin am Dashboard-Gateway schließen den Browser von DB-Zugangsdaten aus.

## Bewusste Änderungen und Nachweise

Setup-Mandanten/Standorte anlegen, suspendieren, Pflichtprüfungen dokumentieren, Review/Freigabe,
erneute Prüfung und Startbereitschaft sind bedienbar. 9 Mandanten- und 12 Standortprüfungen decken
die A2-Minimalpunkte ab. Bestanden erfordert strukturierte Referenz und Nachweisart. Review braucht
alle Pflichtnachweise; Mandantenfreigabe zusätzlich Händlerrolle Restaurant, Auszahlungsreferenz,
Produktionsdomain, Frankfurt und verantwortliche Identität. Eingaben sind Deklarationen bzw.
Nachweisreferenzen, kein Nachweis tatsächlicher Provider-, Infrastruktur- oder Geräteabnahme.

Änderungen dieser fünf Grundlagen öffnen alle Mandanten-/Standortprüfungen erneut und sperren
Go-live. Profil-/Adressänderungen öffnen den betroffenen Umfang ebenfalls. Bereits bestehende
Aufträge/Status-/Zahlungsverläufe werden nicht gelöscht. Neue Pflichtpunkte bleiben bei vorhandenen
Mandanten zunächst offen: die Migration erteilt keine rückwirkende Freigabe.

Jeder Befehl verlangt Änderungsgrund, erwartete Revision und Anfrage-ID. Gewöhnliche Änderungen sind
atomar mit append-only Vorher-/Nachher-Audit, bestätigter Actor-ID, Revision, minimalem Outbox-
Ereignis und unveränderlichem Wiederholungsbeleg. Gleiche Anfrage ist idempotent; andere Nutzlast
unter gleicher ID oder veraltete Revision ergibt Konflikt. Berechtigung wird vor Wiederholung erneut
geprüft. Geteilte Grant-Locks und geordnete Mandanten-/Standort-Locks serialisieren Schreiben.
Privilegierte DB-Wartung ist nachvollziehbar als solche, ohne erfundene Nutzeridentität.

## Standortfeatures

Nur registrierte Schlüssel. Freigaben benötigen einen zukünftigen Ablauf von höchstens 30 Tagen,
Sperren können dauerhaft oder befristet sein; „Überschreibung entfernen“ erbt wieder. Ablauf wird
beim Lesen wirksam, kein Scheduler erforderlich. Eine Mandantensperre dominiert Standortfreigaben.
Unbekannte Schlüssel/Standorte bleiben aus. Bestehende Legacy-Flags ohne Ablauf werden unverändert
als historische Konfiguration angezeigt; jede neue Freigabe muss befristet sein.

Sechs vorhandene Gate-Funktionen für Katalog/Menü, Verfügbarkeit und Onlinezahlung benutzen den
Standortresolver. Die Migration ersetzt ausdrücklich bekannte Guards und bricht bei unbekanntem
Funktionsstand ab. Direkte service-role-Feature-DML ist entzogen. Checkout, Kapazität und bestehende
Zahlungstransaktionen bleiben in ihren bewährten Funktionskörpern.

## Grenzen und Gates

`PROVIDE_ADMIN_ENABLED=false`, `PROVIDE_ADMIN_LIVE_ENABLED=false` in allen gelieferten Defaults.
Keine echte Grant-Vergabe, Live-Freigabe, automatische Owner-Anlage oder Provider-Konfiguration.
Live-Befehle und die Wiederaktivierung eines live markierten Profils brauchen den separaten
serverseitigen Live-Schalter zusätzlich zu allen bestehenden Gates. Kein Deployment oder Merge.

Zentrale Supportverwaltung, ein Audit aller Fachaktionen, Viewer-Rolle und Provideranschlüsse
bleiben offen. Das ist keine pauschale Schließung von A2-9-3 oder Paket 4. Browserläufe prüfen die
tatsächliche Komponente mit synthetischem Transport; SQL/HTTP laufen auf isolierter echter DB.
Physische MFA/Geräte/Restaurantabnahme gehört weiterhin zu F03.
