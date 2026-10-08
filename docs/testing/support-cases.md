# O1: Zuordnung der 40 bestätigten Prüffälle

Grundlage: E22 und fachliche Bestätigung mit Umsetzungsauftrag vom 03.10.2026. Die Fachfälle sind
unverändert übernommen. Eine Quellenzuordnung ist kein Lauf-PASS. Aktuelle Laufstatus, Head/Tree und
CI stehen im O1-Prüfnachweis/Projektprotokoll.

## Belegschichten

| Kürzel | Quelle und Bedeutung                                                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| U      | Contract-/API-/Gateway-Unit-Tests: strikte Payloads, minimierte Projektion, Gates und verbotene Kommandos                                          |
| S39    | supabase/tests/0039_support_cases.test.sql: Rechte, aktuelle A4-Sitzung, Fallstatus, Fristen, Replay/Audit/DML; Auth-Fixtures synthetisch          |
| S40    | supabase/tests/0040_support_sources.test.sql: fünf Quellen, 100er-Fortsetzung, Deduplikation/Episoden, Abschlussbelege, Erhalt der Fachobjekte     |
| A      | apps/api/src/support.integration.test.ts: reale Loopback-Auth-TOTP, Produktionsverifier, HTTP/PG, Entzug, Parallelität, Replay und Fault injection |
| B      | apps/storefront/tests/browser/support.ts: echte SupportCases-Komponente, ausdrücklich synthetischer Transport, drei Engines / zwei Breiten         |
| R      | Bestehende Unit-/SQL-/Auth-/HTTP-/Browserregressionen für Payment, E-Mail, Historie, Personal, A3 und A4                                           |

## Fachfälle

| ID     | Szenario                                                | Erwartetes Ergebnis                                                                                                          | Prüfschichten / Beleggrenze                                               |
| ------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| O1-T01 | Ohne Login und ohne Supportgrant                        | Zugriff verweigert; keine Fall-/Quellinformation.                                                                            | U/S39/A                                                                   |
| O1-T02 | AAL1 trotz Supportgrant                                 | Lesen und Bearbeiten verweigert.                                                                                             | U/S39/A                                                                   |
| O1-T03 | PROVIDE-Admin ohne Supportgrant                         | Kein impliziter Supportzugriff.                                                                                              | S39                                                                       |
| O1-T04 | Owner/Manager/Kitchen/Driver/Viewer ohne Grant          | Kein Rollen-Bypass.                                                                                                          | S39 (Owner/Manager/Kitchen/Driver/Viewer ausdrücklich) / R(A3)            |
| O1-T05 | Standortgrant greift auf anderen Standort/Mandant zu    | Keine Daten oder Mutation; Cursor/Referenzen ebenfalls geprüft.                                                              | S39/S40/A/B                                                               |
| O1-T06 | Restaurantgrant und globaler Grant                      | Nur jeweiliger erlaubter Umfang; kein frei verschobener Fall.                                                                | S39                                                                       |
| O1-T07 | Grantentzug während geöffneter Sitzung                  | Nächster Aufruf verweigert; UI verwirft geladene Daten.                                                                      | S39/A/B                                                                   |
| O1-T08 | Bann, gelöschte Sitzung, Recovery-Sperre/alte Tokens    | A4-Sitzungsgrenze greift vor Supportoperation.                                                                               | S39/A/R(A4)                                                               |
| O1-T09 | Nur read-Grant versucht Mutation                        | Lesen erlaubt, Änderung verweigert.                                                                                          | S39/A/B                                                                   |
| O1-T10 | Liste, Detail und Belegaudit                            | Nur zulässige minimierte Felder; keine PII oder Tokens.                                                                      | U/S40                                                                     |
| O1-T11 | Freier Text, Rohpayload oder URL als Beleg              | Nicht im erlaubten Vertrag; keine Speicherung/SSRF.                                                                          | U/S39                                                                     |
| O1-T12 | Gastkontakt abgelaufen/physisch gelöscht                | Fallreferenz und Nicht-PII-Historie bleiben; Kontakt erscheint nie.                                                          | U/S40/R(Gastdatenablauf)                                                  |
| O1-T13 | Standortwechsel/403/Abbruch mit verspäteter Antwort     | Alte Daten werden entfernt; Antwort überschreibt neuen Scope nicht.                                                          | B                                                                         |
| O1-T14 | 100 Quellen und weitere Treffer                         | Begrenzter Lauf, stabile Fortsetzung; kein stiller Verlust weiterer Quellen.                                                 | S40/B                                                                     |
| O1-T15 | Zwei gleichzeitige Scans derselben Quelle               | Ein aktiver Fall; keine doppelten Auditereignisse.                                                                           | S40/A                                                                     |
| O1-T16 | Wiederholter Scan unveränderter Quelle                  | Kein neuer Fall und keine unbegrenzten identischen Belege.                                                                   | S40                                                                       |
| O1-T17 | Neue Episode nach resolved                              | Neuer verknüpfter Fall; alte Historie bleibt unverändert.                                                                    | S40                                                                       |
| O1-T18 | Fremde/fehlende Objekt-/Jobreferenz                     | Kein Fall mit frei erfundener oder fremder Verknüpfung.                                                                      | S40                                                                       |
| O1-T19 | Manueller standortgebundener Störungshinweis            | Gültiger Typ/Scope/Grund, kein erfundener PaymentIntent.                                                                     | U/S39                                                                     |
| O1-T20 | Erstellen, Übernehmen und Zuweisen                      | Erlaubte Übergänge; Assignee aktiv und im Scope berechtigt.                                                                  | S39/A                                                                     |
| O1-T21 | Zuweisung an gesperrten/unberechtigten Nutzer           | Verweigert; Fall kann unzugewiesen offen bleiben.                                                                            | S39                                                                       |
| O1-T22 | waiting ohne Grund oder ungültiger Status               | Verweigert; keine Änderung von Bestell-/Zahlungsstatus.                                                                      | U/S39                                                                     |
| O1-T23 | Unklare Providerwirkung wird als gelöst markiert        | Technischer Abschluss verweigert; manuelle Prüfung bleibt sichtbar.                                                          | S40                                                                       |
| O1-T24 | Aktueller terminaler Beleg versus veralteter Beleg      | Nur aktueller Beleg trägt technischen Abschluss; Konflikt bei neuer Quelle.                                                  | S40                                                                       |
| O1-T25 | Administrative Erledigung/Wiederöffnung                 | Grund, Akteur und Kennzeichnung auditiert; kein behaupteter Providererfolg.                                                  | S39/S40                                                                   |
| O1-T26 | Drei vorgeschlagene Startfristen                        | Serverzeit +30min/+4h/+24h; keine Browserzeit als Autorität.                                                                 | S39                                                                       |
| O1-T27 | DST, UTC-Grenzen und überfällige Fälle                  | Eindeutige Frist; korrekte Standortanzeige; keine Fachaktion bei Ablauf.                                                     | S39/S40/B                                                                 |
| O1-T28 | Friständerung ohne Grund, ungültig oder >30 Tage        | Verweigert; Änderung gültiger Frist auditiert.                                                                               | S39                                                                       |
| O1-T29 | Interner Abgleich eines unklaren Payment-Jobs           | Nur Fall-/Belegänderung; keine Sessionerzeugung, expiration oder refund.                                                     | S40/A                                                                     |
| O1-T30 | Uncertain/Dead-Letter-E-Mail intern abgleichen          | Keine send/lookup-/Retry-/Receipt-Wirkung durch O1.                                                                          | S40/A                                                                     |
| O1-T31 | Bestehende Jobs ändern Quelle parallel                  | O1 beobachtet neue interne Revision; laufende Jobs nicht manipuliert.                                                        | A/S40; tatsächlich konkurrierender Quellzeilen-Writer im isolierten Stack |
| O1-T32 | Verbotene Wirtschafts-/Auth-Kommandos                   | Nicht im Supportvertrag; kein indirekter Dispatch/Refund-Retry.                                                              | U/S40                                                                     |
| O1-T33 | Konkurrierende Zuweisungen/Statuswechsel                | Ein Erfolg, ein Revisionskonflikt; keine verlorene Änderung.                                                                 | S39/A                                                                     |
| O1-T34 | Request-Replay und Payload-Konflikt                     | Identischer Replay einmal; andere Payload mit gleicher ID abgewiesen.                                                        | S39/A/B                                                                   |
| O1-T35 | Auditfehler/Abbruch vor Commit                          | Vollständiger Rollback von Fall/Beleg/Audit; kein falsches PASS.                                                             | S39/A                                                                     |
| O1-T36 | Verlorene Antwort nach Commit                           | Replay liefert bestehendes Ergebnis; kein zweiter Aktionsaudit.                                                              | S39/A/B; Fault injection nach tatsächlichem Commit, identischer Replay    |
| O1-T37 | Direkte Browser-DML/RPC und Auditänderung               | Verweigert; private Serveroperationen eng berechtigt; append-only geschützt.                                                 | S39                                                                       |
| O1-T38 | Alle fünf Typen und manuelle Störung                    | Deterministische Quellenzuordnung; fehlende Quelle als unbekannt, nicht als Erfolg.                                          | U/S39/S40                                                                 |
| O1-T39 | Default aus, Tastatur, 390/1440 px, drei Engines        | Geschlossener Default; erreichbare Labels/Fokus, nachvollziehbare Konflikte; synthetische UI klar markiert.                  | U/B/R; Kennzeichnung im Harness, DST-Falldaten synthetisch                |
| O1-T40 | Bestehende Zahlungen, E-Mail, Historie, Personal, A3/A4 | Relevante Regression am finalen Head; Pflicht-CI und isolierte Auth-/HTTP-/SQL-Nachweise; praktische Abnahmen nicht ersetzt. | R/A; finalen Head und Pflichtlauf im aktuellen O1-Nachweis abgleichen     |

## Ausgeführter Implementierungsnachweis und Grenzen

### Gezielte Korrektur R22-01 (08.10.2026)

E25 reproduzierte am Head `522c93b22e5a65b2e81ca7259c05cfdbf58fee3b` den Verlust einer offenen
Scan-Fortsetzung durch eine normale Leseantwort. Scan-Receipt und Listen-/Detailprojektion werden
jetzt getrennt gehalten, ausschließlich im gemounteten Sitzungs-/Standortkontext. Timer, Fokus,
Liste, Detail, Detailaktualisierung und Listenpagination ersetzen den Scan-Cursor nicht. Es gibt
keinen automatischen Folgescan. Nur eine erfolgreiche Scan-Antwort aktualisiert den letzten
Abschnitt und die Fortsetzung; eine terminale Antwort beendet sie ausdrücklich.

Browserregressionen für T14/T39 prüfen 100 + 1 synthetische Quellen, alle genannten Lesewege,
verlorene Fortsetzungsantwort mit identischem Request-Replay, Cursor-Konflikt, 401, 403,
manage-Rechteverlust und Standortwechsel einschließlich Rückwechsel. Fehlerhafte/abgelaufene
Fortsetzung wird zusätzlich in S40 direkt gegen PostgreSQL mit anderem berechtigten Actor, anderem
berechtigten Scope, fehlendem und abgelaufenem Cursor geprüft (vier neue Assertions; S40 nun 30, O1
zusammen 90). SQL-Auth-Fixtures bleiben synthetisch. Die zusätzliche Browserprüfung weist
Unmount/Remount und eine verspätete Scan-Antwort nach. Fehlerhafte/abgelaufene Fortsetzung wird
ausdrücklich verworfen, nicht als erfolgreicher Abschluss dargestellt. Die bestehende
Abort-/Sequenzprüfung verwirft verspätete Antworten; Logout/Sessionwechsel unmountet die Ansicht.
Scan-Metadaten werden nicht in Storage persistiert. Serverseitige Actor-/Scope-/AAL2- und aktuelle
Sitzungsprüfungen, Cursor-Einmaligkeit und Ablauf bleiben unverändert.

Der erneute Nachweis ist ausschließlich am neuen Head zu bewerten. Frühere CI163 und E25 bleiben
historische Belege. CI164 brach in bestehenden Checkout-Browserfällen vor O1 ab: die synthetische
Statusreferenz lief am 04.10.2026 ab. Der Harness fixiert nun ausschließlich die Beobachtungszeit
auf den konsistenten Fixture-Tag 03.10.2026; Timer laufen weiter, produktive Ablaufregeln bleiben
unverändert. Fehlgeschlagene Vorläufe zählen nicht als finaler Browsernachweis. Frühere Belege
bleiben historische Belege. Der Korrekturauftrag enthält keine technische Endfreigabe, keinen
Ready-Wechsel, Merge oder Deployment; die erneute separate Endfreigabeprüfung folgt erst danach.

CI161 (Run 37119368549) am Head `6945c37affce039d98d4ca435e937ed72de1461d` bestand mit allen fünf
Pflichtjobs: 496 Unit-Tests, 40 SQL-Dateien / 1.760 pgTAP-Prüfungen, Security Advisors, zehn
tatsächlichen isolierten Integrationsfällen sowie Chromium, Firefox und WebKit. Darin bestanden T31
mit tatsächlichem konkurrierendem Quellzeilen-Writer und T36 mit Fault injection nach tatsächlichem
Commit und identischem Replay.

Der anschließende Nachweisabgleich ergänzt den ausdrücklichen Viewer-ohne-Grant-Fall, die physische
Entfernung gespeicherter Kontaktfelder bei unveränderter Fall-/Audithistorie, die sichtbare
synthetische Harness-Kennzeichnung und den wiederholten lokalen DST-Stundenwert mit unterscheidbarem
Offset. SQL-Datei S39 enthält 60, S40 jetzt 26 Assertions. Der finale Lauf muss diese Ergänzungen am
aktuellen PR-Head enthalten; die vorangegangene CI wird nicht als Nachweis eines späteren Heads
verwendet. Aktueller Head/Tree, finaler CI-Lauf, Bildsichtprüfung und die einzelnen 40
Fallauswertungen werden im O1-Prüfnachweis und Projektprotokoll festgehalten.

Lokal bleiben zehn umgebungsabhängige Integrationen ausdrücklich skipped. Der
PostgreSQL-WASM-Vorlauf nutzt synthetische Auth-Tabellen und No-op-Realtime-Send und ersetzt den
tatsächlichen isolierten Stack nicht. Browser prüfen die echte SupportCases-Komponente mit
synthetischem Transport und synthetischen Daten; sie sind kein Browser-End-to-End-Nachweis gegen
Auth/HTTP/DB. Der gesonderte Integrationslauf verwendet tatsächliche Loopback-Auth-TOTP und den
Produktionsverifier. Kein externer Provider-Abgleich, keine Providerzahlung und keine praktische
Geräte-/Screenreaderabnahme. F01–F03 bleiben eingefroren. Die separate technische Endfreigabeprüfung
und Nutzer-Endfreigabe sind nicht Teil dieses Implementierungsnachweises.
