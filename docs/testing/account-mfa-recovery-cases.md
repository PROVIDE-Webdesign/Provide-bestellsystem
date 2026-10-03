# A4: Zuordnung der 35 bestätigten Prüffälle

Diese Zuordnung folgt unverändert A4-T01–T35 aus der fachlichen Bestätigung vom 03.10.2026. Eine
Quellenzuordnung ist kein Lauf-PASS. Finaler Commit, Tree, tatsächliche CI-Ergebnisse, visuelle QA
und Einzelstatus werden im aktuellen A4-Prüfnachweis und Projektprotokoll festgehalten. Die
historische fachliche Bestätigung bleibt unverändert.

## Belegschichten

| Kürzel | Quelle und Bedeutung                                                                                                                                                                                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S36    | [SQL0036](../../supabase/tests/0036_account_recovery_sessions.test.sql): aktuelle Sitzung/Faktor/Sperre, RLS-Gesamtheit, Beobachtung/Audit                                                                                                                                                                                  |
| S37    | [SQL0037](../../supabase/tests/0037_account_recovery_cases.test.sql): gebundene Verlustfälle, unabhängige Freigaben, echte Zustandslogik mit ausdrücklich synthetischen Auth-Fixtures                                                                                                                                       |
| S38    | [SQL0038](../../supabase/tests/0038_account_recovery_denials.test.sql): Rollen-/Scope-/AAL-/Bann-/Frist-/Snapshot-/Replay-/Abschluss-Gegenproben                                                                                                                                                                            |
| A      | [Recovery-Auth](../../apps/api/src/recovery.integration.test.ts): tatsächlicher Loopback-Provider, PKCE, Passwort, TOTP/Unenroll/Admin, Ersatz und neue Sitzung                                                                                                                                                             |
| L      | [Verlust-Auth](../../apps/api/src/recovery-loss.integration.test.ts): tatsächliche verschiedene Operatoren, parallele Freigaben, Admin-Wirkung, Fault injection, HTTP/RLS/Realtime und neue MFA                                                                                                                             |
| U      | [API](../../apps/api/src/account-recovery.test.ts), [Contract](../../packages/contracts/src/account-recovery.test.ts), [Callback](../../apps/dashboard/app/auth/recovery/route.test.ts), [Gateway](../../apps/dashboard/app/api/recovery/route.test.ts), [neutrale E-Mail](../../apps/dashboard/lib/recovery-email.test.ts) |
| B      | [Browser](../../apps/storefront/tests/browser/recovery.ts): tatsächliche UI-Komponenten, synthetischer Transport; 390/1440 px × Chromium/Firefox/WebKit                                                                                                                                                                     |
| R      | [Runbook](../runbooks/account-mfa-recovery.md): geprüfte externe Notfallgrenze; kein behaupteter ausgeführter Provider-Notfall                                                                                                                                                                                              |
| G      | Vollständige CI einschließlich bestehender A1-/A3-/Gast-/Fachregressionen und Security-Advisors                                                                                                                                                                                                                             |

## Einzelzuordnung

| ID     | Gegenprobe und erwarteter Nachweis                                                                                                                             | Quellen                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| A4-T01 | Bekannt/unbekannt gleich neutral im Produkt; tatsächlicher unbekannter Auth-Antrag erzeugt keine Identität                                                     | A, U                            |
| A4-T02 | Provider-Cooldown, ungültige Adresse; bloßer unauthentifizierter Antrag sperrt kein Konto                                                                      | A, S37, U                       |
| A4-T03 | Tatsächliches PKCE mit richtigem Browser; Recovery-AMR und gebundener Passwortbefehl                                                                           | A                               |
| A4-T04 | Tatsächlich abgelaufener Provider-Nachweis, falscher Browser und wiederholter Code; fester Fehlerneustart                                                      | A, U                            |
| A4-T05 | Feste Redirects, keine zusätzlichen type/next/Tokenparameter; normale/einladungsartige Sitzung ersetzt keine Recovery-AMR                                      | U, S38, G                       |
| A4-T06 | Tatsächlich altes Passwort abgelehnt/neues akzeptiert; Owner/Manager-MFA und unveränderte Viewer-Rolle                                                         | A, S38, G                       |
| A4-T07 | Alter Faktor zuerst gebunden, Ersatz tatsächlich verifiziert, dann offizielle Auth-Entfernung; kein Fachzugriff vor Abschluss                                  | A, L, S38                       |
| A4-T08 | AAL1, fremder/anderer alter Faktor und unbestätigter Ersatz abgelehnt; alter letzter Faktor bleibt erhalten                                                    | S38, A                          |
| A4-T09 | E-Mail-Antrag allein sperrt nicht und kann nicht ausführen; unabhängiger Kontakt nötig                                                                         | S37, S38, B                     |
| A4-T10 | Normales Konto verlangt genau einen anderen berechtigten Bearbeiter und gebundenen Fall; Zuordnungen bleiben erhalten                                          | S37, S38, L                     |
| A4-T11 | Owner/Manager/Kitchen/Driver/Viewer und globaler Plattformgrant ohne Recovery-Recht verweigert                                                                 | S38                             |
| A4-T12 | Mandantengrant statt globalem Recovery-Recht verweigert; fremder Fall bleibt unsichtbar                                                                        | S38, U                          |
| A4-T13 | Administrative Selbstfreigabe, gebannte/blockierte Identität, AAL1 und widerrufene aktuelle Sitzung verweigert                                                 | S36, S37, S38, A                |
| A4-T14 | Plattformziel braucht zwei verschiedene Personen; eine zweimal genügt nicht                                                                                    | S37, L, B                       |
| A4-T15 | Einziger gesperrter Administrator erhält keinen Selbstreset/Superuser; externer unabhängiger Notfallweg dokumentiert                                           | R, S37, S38                     |
| A4-T16 | Ziel-E-Mail, Faktoren, Mitgliedschaften, Plattform-/Recovery-Grants oder unabhängiger Kontakt veralten Freigabe; auch unerwartete Faktoren während der Wirkung | S38, L                          |
| A4-T17 | 24 Stunden/15 Minuten, Ablehnung/Abbruch; begonnene oder unklare Wirkung wird bei Ablauf nie entsperrt                                                         | S37, S38, B                     |
| A4-T18 | Vorher aktuell gültige tatsächliche AAL1-/AAL2-Sitzungen nach Sperre an Fachzugängen abgelehnt                                                                 | S36, L                          |
| A4-T19 | Weiter gültiger signierter AAL2-Token nach direktem Unenroll/Logout reicht nicht; aktueller Faktor/Session maßgeblich                                          | A, S36                          |
| A4-T20 | Alte Refresh-Tokens und neue normale Anmeldung während Sperre öffnen keine Fachrechte                                                                          | A, L                            |
| A4-T21 | Nach Abschluss bleiben alte Sitzungstokens und alte AAL1-/AAL2-Refresh-Tokens ungültig                                                                         | A, L, S37                       |
| A4-T22 | Produktions-JWT-Verifier und vollständige HTTP-Fachwege: Kontext, Liste/Details, Alarme, Menü, Betrieb, Historie, Personal, PROVIDE                            | L, G                            |
| A4-T23 | Tatsächliche Data API vor/nach Sperre; direkte geschützte private Helfer, interne frühere Helfer und Recovery-RPC-ACL                                          | L, S36, S38                     |
| A4-T24 | Tatsächlicher privater Join vorher erfolgreich, neuer Join mit altem Auth-Token gesperrt; keine Aussage über sofortigen Disconnect                             | L, G, R                         |
| A4-T25 | Offizielles direktes SDK-Unenroll erzeugt tatsächliche Sperre und ehrliche Provider-Beobachtung mit leerem Akteur                                              | A, S36                          |
| A4-T26 | Multi-Restaurant-Identität bleibt global gesperrt; aktive/suspendierte Zuordnung, Grants und Banns unverändert                                                 | L, S38                          |
| A4-T27 | Tatsächliche neue Auth-/TOTP-Verifikation; aktuelle Sitzung muss exakt den neuen Faktor bestätigen; privilegierte Rollen weiterhin AAL2                        | A, L, S38                       |
| A4-T28 | Echter Admin-Effekt mit absichtlich verlorener Antwort; tatsächlicher Zustandsabgleich, genau eine Provider-Mutation                                           | L, U                            |
| A4-T29 | Isolierter echter Auditfehler vor Wirkung und nach Auth-Commit; vorher kein Effekt, danach gespeicherte Sperre/Absicht und Abgleich                            | L                               |
| A4-T30 | Parallele tatsächliche Operatorfreigaben: eine staler Revision; Replay, andere Nutzlast und entzogene Rechte erzeugen keine zweite Auth-Wirkung                | L, S38, U                       |
| A4-T31 | Echte unterschiedliche Command-Akteure; getrennte ehrliche Provider-Beobachtung, explizite Quelle und unveränderliche Historie                                 | L, A, S36–38                    |
| A4-T32 | Nur minimale sieben Fallfelder, flüchtiges Passwort außerhalb Receipt/Audit; safe Logs und Screenshots ohne Geheimnisse/echte Daten                            | U, A, L, B, statischer Abgleich |
| A4-T33 | Exakte Origin/Method/Body-Grenze, feste Upstreams/Redirects, deaktivierte Defaults, `no-store`, keine Rechte aus Metadaten                                     | U, G, statischer Abgleich       |
| A4-T34 | Drei Engines, zwei Breiten, Tastatur, sichere Fehler, Abbruch und Wiederaufnahme; keine Fachpanels                                                             | B, visuelle QA                  |
| A4-T35 | A1-Einladung/Bestätigung, A3-Bann/Viewer, übrige Rollen, Gastcheckout und Default-false vollständig regressiert                                                | G                               |

`A` und `L` laufen nur gegen explizite wegwerfbare Loopback-Variablen. SQL-Fixture-DML ist als
synthetisch gekennzeichnet und kein Produktweg. `B` ist UI-/Transportprüfung, keine simulierte
Auth-Endfreigabe. `R` ist eine Runbook-Prüfung und bleibt von tatsächlicher Provider-Ausführung
getrennt. Die Fachfälle sind keine zusätzliche Menge von 35 Unit-Testfunktionen; ein Fall kann
mehrere Schichten und Gegenproben benötigen.

## Reproduktion

`pnpm check` prüft Format, Lint, Types, Units und Build. Ohne Loopback bleiben die Auth-Tests
ausdrücklich übersprungen. Die bestehende Datenbank-CI startet CLI 2.117.0, führt `supabase test db`
und Security-Advisors aus und prüft anschließend öffentliche API, tatsächliche private Realtime,
A1-Auth und beide A4-Auth-Testdateien. Die bestehende Browsermatrix installiert und prüft jede
Engine gesondert. Browserartefakte enthalten ausschließlich synthetische Bilder/Belege.

F01–F03 sind weiterhin eingefroren. Kein Ersatz für reale SMTP-, Geräte-, NVDA-, native Safari-,
Restaurant- oder externe Notfallabnahme. Die bestehende gewichtete Fortschrittsposition A2-2-4 ist
schon vollständig bewertet; A4 erhält keine zweite Auth-Gutschrift.
