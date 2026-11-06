# Technische Gesamtprüfung vor Veröffentlichung – 2026-11-04

## Stand und Ergebnis

Geprüft wird der zusammengeführte Release-Kandidat `candidate/p5-release-20261104`, ausgehend von
`0e1d94ec0f93c3608441210530eb207b1395e7ef`. Er enthält sowohl die bisherigen
Bestellsystem-Funktionen einschließlich der Shop-/Warenkorbübergabe aus Bestellsystem 16 als auch
die vorbereitete Stripe-Live-Integration. Diese Prüfung beschränkt sich nicht auf das letzte
Arbeitspaket.

**Gesamtprüfung abgeschlossen: Alle aufgeführten abschließenden Prüfungen bestanden. Die gefundenen
Funktionsfehler sind im Release-Kandidaten korrigiert. Keine Veröffentlichung, keine produktive
Migration und keine echte Zahlung ausgeführt. Der Echtbetrieb bleibt an die unten genannten
Voraussetzungen gebunden.**

## Behobene Befunde

1. **Bestätigte Abbuchung bei inzwischen entzogenem Personalzugriff.** Bisher konnte die
   Statusübernahme fehlschlagen und dabei den lokal bereits bestätigten Zahlungseintrag
   zurückrollen. Die neue Migration `20261104195000_capture_authorization_loss.sql` erhält die
   bestätigte Abbuchung und veranlasst bei fehlender Berechtigung Stornierung und Rückzahlung.
   Regressionen prüfen gesperrte Mitarbeiter, Leserechte und fehlende Standortzuweisung; keine
   doppelte Abbuchung und kein unberechtigter Annahmeeintrag.
2. **Gastanzeige nach erneut gestarteter Rückzahlung.** Bei unverändertem Bestellstatus startete die
   automatische Abfrage nach einem Wechsel von fehlgeschlagener zu laufender Rückzahlung nicht
   wieder. Der Effekt berücksichtigt jetzt auch den Zahlungsstatus. Browserregression: erneute
   Abfrage bis „Erstattet“, danach keine weiteren Abfragen.
3. **Abhängigkeiten mit bekannten Sicherheitsmeldungen.** Vite, Vitest und betroffene transitive
   Pakete wurden aktualisiert beziehungsweise auf bereinigte Versionen festgelegt. Die vollständige
   installierte Abhängigkeitsprüfung meldet zum Prüfzeitpunkt null bekannte Schwachstellen; Build
   und Funktionstests wurden damit erneut ausgeführt.
4. **Prüfungen nach einem Build.** Generierte Demo- und Nachweisdateien störten wiederholte
   Format-/Lintprüfungen. Ausschlüsse betreffen nur erzeugte Ausgaben; die Quelldateien bleiben
   geprüft.
5. **Prüfbarkeit in Git-Worktrees.** Die Warenkorbübergabeprüfung schrieb ihre Nachweise in einen
   als Verzeichnis angenommenen `.git`-Pfad. Die Ausgabe liegt jetzt im bereits ignorierten
   `output/cart-handoff`; dadurch funktioniert sie auch mit einer `.git`-Verweisdatei.
6. **Gleiche Datenbank-Hauptversion.** Lokale Projektkonfiguration auf PostgreSQL 17 angeglichen.
   Die Gesamtprüfung und Migrationen liefen auf derselben Hauptversion wie die gehostete Vorschau.

## Prüfumfang und Nachweise

| Bereich                        | Ergebnis                                                                                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit-/Komponententests         | 719 bestanden: Contracts 241, Config 6, Storefront 110, Dashboard 68, API 294                                                                                                                                                                              |
| Echte Datenbanktests           | 3.180 pgTAP-Prüfungen in 46 Dateien; 55 Migrationen; PostgreSQL 17                                                                                                                                                                                         |
| Zusätzliche Integrationstests  | Alle 19 bestanden; im Unitlauf bewusst übersprungen und anschließend getrennt mit Datenbank/Auth/Realtime ausgeführt                                                                                                                                       |
| Zahlungsabläufe                | Autorisierung, Annahme/Abbuchung, Wiederholung, Ablehnung, Storno, Rückzahlung, Test-/Live-Trennung, signierte Webhooks und nachträglicher Rechteentzug; Stripe-Antworten im integrierten Lauf simuliert                                                   |
| Rechte und Konten              | Rollen-/Standorttrennung, Personalverwaltung, echte lokale Auth-/TOTP-/Recovery-Abläufe, Sitzungsentzug, Support und geschützte Realtime-Kanäle                                                                                                            |
| Checkout                       | Katalog, Verfügbarkeit, Preise, Varianten, Abholung/Lieferung, Schutzmechanismen, Wiederholungen und Wiederherstellung nach Verbindungsfehlern                                                                                                             |
| HTTP-/Browserintegration       | Echte lokale API und PostgreSQL hinter dem Testgateway; Challenge-/Edge-Dienste lokal simuliert                                                                                                                                                            |
| Browser                        | Chromium, Firefox und WebKit vollständig bestanden; jeweils Desktop 1440 px und mobile Breite 390 px                                                                                                                                                       |
| Restaurant-Website → Shop      | Zwei vollständige Integrationsläufe bestanden: beide Restaurants, Desktop/Mobil, Übernehmen/Behalten/Ersetzen, abgelaufener/fremder Link und deaktivierter Sitzungsspeicher; echte PostgreSQL-Preisanfragen, keine unbeabsichtigte Bestellung oder Zahlung |
| Ältere Demo-/Buildadapter      | 36 Node-Prüfungen bestanden                                                                                                                                                                                                                                |
| Monitoringlogik                | 14 isolierte Fälle bestanden: Erfolg, falsche Umgebung, ungültige Antworten, Timeout, wiederholter Fehler und Erholung; kein Alarmversand ausgelöst                                                                                                        |
| Format, Lint, Typen, Build     | Bestanden, einschließlich erneuter Format-/Lintprüfung nach dem Build                                                                                                                                                                                      |
| Geschlossener Produktionsbuild | Drei Wrangler-Dry-Runs und echte lokale Workerstarts bestanden; Produktion als Umgebung, DB ohne Anbindung 503, Demo entfernt/404                                                                                                                          |
| Verschlüsselter Restore        | Bestanden: 32 Bestellungen, 32 Zahlungsdatensätze, 7 Rückzahlungen, 55 Migrationen, 91 RLS-Tabellen und 72 Policies unverändert; manipuliertes Archiv abgewiesen                                                                                           |
| Abhängigkeiten                 | Keine bekannten Meldungen im vollständigen Audit zum Prüfzeitpunkt                                                                                                                                                                                         |
| Geheimnissuche                 | Keine Treffer in 576 getrackten Dateien und 53 Clientartefakten für private Schlüsselblöcke, lange Provider-Secret-Tokens oder Service-Role-JWTs; heuristische Prüfung                                                                                     |
| Speisekartenimport             | Alle zwölf Gerichte, Kategorien, Varianten und Preise entsprechen dem vorhandenen Import; nur der Datei-Hash der inzwischen weiterentwickelten Demo unterscheidet sich vom archivierten Original                                                           |

Die native Browserprüfung umfasst außerdem Bestellboard, Alarmbedienung, Speisekartenpflege,
Standortbetrieb, Historie, Personal, Support, Administration, zwei getrennte Restaurants sowie
Tastatur-/Fokus-/Fehleranzeigen. Mobile Breiten sind Browseremulationen, keine Prüfung jedes realen
Endgeräts. Der akustische Test mit Null-Audiogerät belegt den Browserablauf; der vorhandene
Hörnachweis des Nutzers bleibt der Nachweis am Restaurantgerät.

## Bestehende Vorschau und Grenzen

Die gehostete Vorschau wurde nur lesend kontrolliert: 53 angewendete Migrationen, 22 Bestellungen,
keine öffentliche Tabelle ohne RLS. Die 55 Migrationen des korrigierten Kandidaten sind dort **noch
nicht** angewendet.

Der gehostete Sicherheitsberater meldet deaktivierten Schutz gegen bereits kompromittierte
Passwörter. Das muss bei der Produktions-Auth-Konfiguration geklärt beziehungsweise aktiviert
werden. Die lokalen Datenbank-Sicherheitsprüfungen melden keine Warnungen oder Fehler.
Informationshinweise zu privaten Tabellen ohne Client-Policies entsprechen der beabsichtigten
Zugriffssperre. Hinweise zu fehlenden FK-Indizes beziehungsweise ungenutzten Indizes wurden nicht
durch pauschale Schemaänderungen beantwortet; dieser Lauf ist kein Lastnachweis für einen großen
Echtbetrieb.

Vorhandene Vorschau-Monitoringdienste und täglicher Sicherungszeitplan wurden lesend überprüft. Eine
Produktionsüberwachung mit Zuständigkeit und Überwachung des Sicherungsalters muss bei der
Produktionseinrichtung ergänzt werden. Die Restoreprobe nutzt synthetische Daten auf einer
isolierten, anschließend entfernten Datenbank ohne Netzwerk. Beim Wiederherstellen müssen
Supabase-Rollen und Eigentümer korrekt berücksichtigt werden: Bootstrap-Rolle `supabase_admin`,
Rollenexport ohne Passwörter, benötigte Erweiterungen und bereinigte Schema-Erzeugung. Ein einfaches
Rückspielen in eine abweichend initialisierte PostgreSQL-Instanz genügt nicht.

## Verbleibende Voraussetzungen für den Echtbetrieb

- Getrennte Produktionsdatenbank, Worker, Domains, Bindings und Secrets einrichten;
  Kosten-/Organisationswahl vor einer kostenpflichtigen Bereitstellung klären.
- Produktive Restaurant-/Stripe-Live-Zuordnung, Schlüssel, Connect-Webhook und freigegebene
  Checkout-Datenschutzhinweise hinterlegen.
- Produktionskonfiguration einschließlich Auth, Monitoring und Sicherung prüfen.
- Kontrollierte echte Live-Zahlung einschließlich Annahme, genau einer Abbuchung und Rückzahlung
  nach ausdrücklicher Freigabe nachweisen.
- Bestellmail-Nachweis bleibt auf ausdrücklichen Wunsch des Nutzers zurückgestellt. Der
  unkonfigurierte Versandadapter darf nicht als funktionierender Mailversand ausgewiesen werden. Die
  bestätigten Gmail-Monitoringalarme sind davon getrennt.

## Belegablage

Rohbelege und isolierte Prüftreiber liegen auf dem Projektserver unter
`/srv/provide-bs-p5-20261104/full-audit-20261104/verified`. Wesentliche Dateien:
`quality-build.log`, `code-check.log`, `db-tests.log`, `integration-*.log`, `http-browser.log`,
`browser-*.log`, `dependency-audit.log`, `restore-report.json`, `closed-runtime-report.json`,
`monitor-regression.json`, `secret-scan.json` und `hosted-preview-audit.json`.

Der erste kombinierte Codecheck scheiterte nach bestandenen 719 Tests an einer inzwischen
korrigierten Lintstelle im neuen Browsertest. Die nachfolgenden getrennten
Typ-/Lint-/Format-/Buildprüfungen bestanden. Erstläufe der Restore- und Runtime-Prüftreiber
erforderten Korrekturen ihrer lokalen Testumgebung; die abschließenden Ergebnisse stehen in den
genannten Berichten.
