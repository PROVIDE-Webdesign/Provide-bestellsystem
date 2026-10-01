# ADR0034: Restaurant-Historie, Betriebskennzahlen und Gastdatenablauf

Status: technischer Entwurf vom 01.10.2026. Auftrag: B5 gemeinsam mit fachlich zugehörigem
Paket-4-Schnitt. Verbindlich: Architektur A2 §§9–11; Projektprotokoll V2/E06; ursprüngliches Audit
in Planungs-PR #9.

## Umfang und Rechte

B5 ergänzt die bestehende Nummernsuche und das aktuelle Bestellboard durch eine eigenständige
Historienansicht. Owner/Manager benötigen verifizierte Beareridentität, AAL2, aktive Mitgliedschaft
und passende Standortrechte; Owner dürfen ihre Restaurantstandorte lesen. Keine Such- oder
Kennzahlenerweiterung für Küche/Fahrer. Viewer bleibt A3, keine verdeckte neue Berechtigung.
Suspendierte Restaurantbetriebe behalten Historie; suspendierte Mitgliedschaften verlieren Zugriff.

Der POST-Leseweg hält Suchnamen aus URLs, Browserhistorie und Zugriffslogs. Gateway prüft Session,
Origin/CSRF, Scope, 2-KiB-Eingabe, 128-KiB-Antwort, Timeout und Redirects. Datenbankfunktion ist
privat, mit leerem search_path und ausschließlich service_role-Aufrufrecht. Browser-Akteur/AAL sind
nicht akzeptiert. Hyperdrive-Cache muss ausdrücklich deaktiviert sein. Antwortverträge prüfen Scope,
Zahlen, Kalender und Ereignisse; Fehler enthalten keine Suchnamen oder Datenbankinhalte.

Zeitraum: lokaler Bestelleingang created_at, beide gewählten Kalendertage eingeschlossen, höchstens
93 Tage je Abfrage; beliebige ältere Zeiträume bleiben wählbar. Ohne Datumsangaben: Montag der
aktuellen Standortwoche bis heute. Halb-offene UTC-Grenzen entstehen aus lokalen Mitternachten,
nicht aus 24-Stunden-Arithmetik. Tage der Zeitumstellung haben 23/25 Stunden. Status, Erfüllungsart,
vollständige Nummer und literal case-insensitive Kundennamens-Teilzeichenfolge werden kombiniert.
Name 2–80 Zeichen, kein Wildcard-Vertrag; nur unpurged und nicht abgelaufen.

Absteigende Keyset-Seiten nutzen created_at/id und erhalten die vollen sechs Mikrosekundenstellen;
die bestehende auf requested_for sortierte Boardliste bleibt unverändert. Kein Offset, keine
Namensindizes oder neue PII-Kopie. Standort-/Created-Index stützt die begrenzte Kohorte. Eine
materialisierte, nach Scope und Filtern begrenzte Kohorte verhindert Join-Fanout und liefert
Gesamt-, Tages- und ISO-Wochenwerte unabhängig vom Cursor. Keine Währungsvermischung. Fehlende
Tages-/Währungsgruppen bedeuten keine Aufträge, nicht fehlgeschlagene Abfrage.

## Kennzahlenvertrag v1

Die A2-Kandidaten sind verbindlich, nicht frei gewählte Wachstums-KPIs. Bestellzahl und erfüllter
Bruttowert unterstützen Tages-/Wochenplanung; Durchschnittsbon hilft beim Größenvergleich;
Erfüllungsart ist der Kapazitätstreiber. Ablehnung und Storno/Erstattung sind getrennte Guardrails.
Keine erfundenen Restaurantziele oder Benchmarks ohne reale Baseline.

| Feld / Anzeige              | Berechnung / Nenner                                                                | Grenze                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Bestellzahl                 | Alle gespeicherten Bestellungen der gefilterten Eingangskohorte, jede genau einmal | Auch unbezahlte, offene, abgelehnte und stornierte Aufträge                              |
| Bruttobestellwert (erfüllt) | Summe unveränderlicher total_amount_minor nur bei aktuellem Status completed       | Inkl. deklarierter Steuer/Liefergebühr; kein verifizierter Vor-Ort-Umsatz/Fiskalnachweis |
| Durchschnittsbon (erfüllt)  | Erfüllter Bruttowert / completedCount, auf Cent gerundet                           | Bei Nenner 0 null/„–“, nicht künstlich 0                                                 |
| Ablehnungsquote             | rejectedCount / alle Aufträge derselben Kohorte, auf Basispunkte gerundet          | Storniert getrennt; keine Annahmefrist- oder Zahlungsfehlerquote                         |
| Abholung / Lieferung        | Anzahl pro fulfillment_type, Summe gleich Bestellzahl                              | Gleiche Filter/Zeitzone/Kohorte                                                          |
| Online erfasst / erstattet  | captured_amount_minor / refunded_amount_minor aus eindeutigem Payment je Auftrag   | Heutiger Zahlungsstand der Eingangskohorte, keine Cashflow-Buchung am Ereignistag        |

Summen bleiben Cent-Ganzzahlen und werden als sichere JavaScript-Ganzzahlen validiert. Bei
Überlauf/übergroßer Antwort scheitert der Abruf sicher, statt eine ungenaue Kennzahl zu liefern.
Zustände werden zum Abrufzeitpunkt ausgewertet; spätere Erfüllung oder Erstattung kann historische
Eingangskohorten ändern. Keine Behauptung revisionsfest abgeschlossener Buchhaltungsperioden.

## Zugehöriger Paket-4-Schnitt: Verlauf und O5

Explizit gewählte Aufträge zeigen vorhandene unveränderliche Positionen und den vollständigen
Statusverlauf mit Reihenfolge, Zeitpunkt und System/Personal-Kategorie. Kein neuer Schreibweg, keine
Positions-/Preisänderung, keine freien Zahlungsaktionen. Historie ist read-only, selbst wenn das
aktuelle Board denselben Auftrag bearbeiten darf. Kontakte/Lieferdaten werden bei Ablauf sofort aus
der Historienprojektion entfernt, unabhängig vom nächsten Löschlauf. API/UI löschen vorherige
Resultate bei Nachladung, Fehler oder Standortwechsel; verspätete Antworten werden verworfen.
Bereits dargestellte Daten sind bis zum nächsten Abruf kein Push-Rechteentzugsnachweis.

Der vorhandene Worker-Cron ruft die bestehende Purge-Funktion über eine neue private Hülle auf:
höchstens 500 terminale, abgelaufene Kontakte/Adressen je tatsächlichem Lauf; feste Serverzeit, kein
vom Browser gesetzter Stichtag. Advisory-Xact-Lock und fünfminütiger Abstand verhindern doppelte
Parallel-/Wiederholungsläufe. Nichtterminale Aufträge bleiben erhalten. Purge und append-only
Nachweis sind dieselbe Transaktion; bei Fehler kein erfolgreicher Laufnachweis, festes minimiertes
Fehlerereignis, Wiederanlauf beim nächsten Cron. Browser und service_role haben keine direkten
Tabellen-Schreibrechte. Restaurants sehen nur letzten Laufzeitpunkt, keine standortfremden
Löschzahlen. Der technische Anschluss ersetzt keinen deployed Cronbeleg oder eine rechtlich
bestätigte Aufbewahrungsfrist.

Beide Schalter bleiben standardmäßig false: DASHBOARD_HISTORY_ENABLED (API/Dashboard),
GUEST_RETENTION_PURGE_ENABLED (API). Unkonfigurierte Schalter wirken geschlossen. Keine echte
Umgebung oder Daten gelöscht, kein Deployment, Merge oder Draft-Ready-Wechsel.

Nicht geschlossen: B6, A2-PROVIDE-Verwaltung, P2/P5, O1–O4, zentraler Audit A2-9-3, Monitoring
A2-9-7, Backup/Restore, praktische Geräte/MFA und externe Nachweise F01–F03.

## Prüfstrategie und Quellen

Contract-/API-/Gateway-/CSRF-Tests; pgTAP für Rollen, Scope, Kalendergrenzen, Werte/Nenner, Cursor,
Ablauf, Purge/Audit; echte HTTP/PostgreSQL-Kohortenabgleiche und konkurrierende Scheduled-Aufrufe;
tatsächliche React-Oberfläche in drei Browserengines bei 390/1440 px mit synthetischem Transport.
Keine Restaurantgeschäftszahlen aus synthetischen Daten ableiten.

Technische Referenzen geprüft:
[PostgreSQL Kalenderfunktionen](https://www.postgresql.org/docs/current/functions-datetime.html),
[Supabase Functions](https://supabase.com/docs/guides/database/functions),
[Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

Finale Pflichtjobs und Sichtprüfung werden am finalen PR-Head separat nachgewiesen.
