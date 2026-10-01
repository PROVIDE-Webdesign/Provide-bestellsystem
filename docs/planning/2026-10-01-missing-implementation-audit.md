# Projektprüfung: vorbereitete, noch fehlende Programmierung

Stand: 01.10.2026, Europe/Brussels. Auftrag: vollständigen A2-Projektumfang auf vorbereitete, noch
nicht programmierte Funktionen prüfen.

## Ergebnis

**Ja: Im Bestellsystem muss noch wesentliche Programmierung folgen.** Die Prüfung erfasst 29
gebündelte Umsetzungslücken über die zwölf A2-Hauptblöcke. Das sind Aufgabenbereiche, keine 29
gleich großen Projekte und keine neue Fortschrittsformel. Viele sind Anschlussarbeit an vorhandene,
getestete Grundlagen; andere sind bisher nur in A2 spezifiziert. Die Liste enthält auch notwendige
Integration und Betriebsautomatisierung.

Der heutige Code ist kein reines Konzept: Bestellkern, Mandantentrennung, Auth/MFA,
Menüversionierung, serverseitige Preise, Abholung/Lieferung, Status, Sandboxzahlung und synthetisch
geprüfte E-Mail-Verarbeitung sind bereits programmiert. Noch nicht zusammengeführter Code wird als
Umsetzung mitgezählt, nicht als ausgelieferter Produktivstand.

Wichtigste direkt anschließende Lücken:

1. Menüpflege und bewusste Veröffentlichung im Dashboard.
2. Kundenauswahl von Varianten/Extras einschließlich Request-/Gatewayweitergabe.
3. Lesende Serverquote, Änderungsbestätigung und 24-Stunden-Warenkorb.
4. Auswahl-Snapshots in der Restaurantanzeige.
5. Echte E-Mail-Provideranbindung und sichere Zustellrückmeldungen.

## Prüfbasis und Vorgehen

Verbindliche Quelle: A2 vom 31.08.2026, vollständig eingelesen; organisatorisch V2/E01. Dazu
Planungsdokumente, ADR0001–0028, Arbeitsblockprotokolle, Runbooks und der aktuelle Code in Apps,
Paketen, Migrationen und Tests.

Aktuelle GitHub-Heads wurden abgefragt: PR #8 `4e422f5b9ce7324e56bdb2b4e8d4cbd76ca3c8cc`, PR #10
`484ec2d1aa5e602f76476cc82fc65ca6692f078e`, PR #11 `7703d45e7df26ad935cfd9780b208ee14effcc15`. Alle
sind unverändert offene Entwürfe. Der lokal geprüfte HEAD `427f72be61f40458c4d3e8802c3829dafaf2e964`
hat denselben Codebaum `c21e82007df1cb65f0cbb8b150b16f6adae9e886` wie PR #11. Unterschiedliche
Commit-IDs erklären sich aus der lokal rekonstruierten Historie.

Geprüft wurden insbesondere API-Routen und Worker-Verdrahtung, Dashboard-/Storefront-Komponenten,
Warenkorb-/Ausgabeverträge, Providerimplementationen, Scheduler, Migrationsfunktionen und bestehende
Testabdeckung. Dokumentationsvermerke „später“/„nicht Bestandteil“ wurden gegen spätere Umsetzung
abgeglichen. Die Treffer in älteren ADRs sind allein kein Fehlend-Nachweis.

Diese Prüfung ändert ausschließlich Dokumentation. Vorhandene CI-Nachweise am unveränderten Codebaum
werden wiederverwendet:
[CI 36766533426](https://github.com/PROVIDE-Webdesign/Provide-bestellsystem/actions/runs/36766533426),
236 Unit-/Contracttests, 1.087 pgTAP-Prüfungen und API/PostgreSQL-Integration. Keine neue Laufzeit-,
Geräte-, Provider- oder Produktionsprüfung wird behauptet. Extern eingerichtete Scheduler, WAF- oder
Backupkonfigurationen wurden hier nicht live inspiziert; ihr Fehlen im Repository ist entsprechend
als fehlender Anschluss/Nachweis gekennzeichnet.

## Nachprogrammierung nach Bereich

Status **Teil**: ein belegter Teil ist programmiert, der beschriebene Anschluss fehlt. Status
**Plan**: Anforderung/Entscheidung vorhanden, die konkrete Fähigkeit im geprüften Produktpfad nicht
implementiert. „Plan“ bedeutet nicht, dass bereits alle Detailverträge umsetzungsfertig spezifiziert
sind.

### Menü und Warenkorb

| ID  | Stand | Anforderung                                                                  | Vorhanden                                                                                     | Fehlende Programmierung                                                                                                                                                    | Beleg                                                                                         | Einordnung                         |
| --- | ----- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| M1  | Teil  | Menüeditor mit Entwurf, Änderungsvorschau, Sofort-/Zeitfreigabe und Rollback | Datenbankversionierung und Konfigurationsschreiber stehen; Editor fehlt.                      | Verifizierte Dashboard-API, Editor und Freigabedialog ergänzen; vorhandene Versionierung nutzen.                                                                           | ADR0013/0028; apps/api/src/router.ts; apps/dashboard/app/components/DashboardClient.tsx       | Paket 2                            |
| M2  | Teil  | Varianten-/Extra-Auswahl vom Kunden bis Checkout                             | API/SQL akzeptieren Auswahl-IDs; CartLine und Storefront senden nur Artikel/Menge.            | Auswahlelemente, konfigurierte Positionsidentität, Mengenänderung und vollständige Gateway-/Requestweitergabe ergänzen.                                                    | apps/storefront/app/storefront/cart.ts; Storefront.tsx; ADR0028                               | Paket 2                            |
| M3  | Teil  | Servervorschau und bewusste Warenkorb-Neubewertung                           | Cart-Quote-API vorhanden; kein Kunden-/Gatewayanschluss für diese Route.                      | Quote weiterleiten, current/changed/unavailable anzeigen, neue Werte bestätigen lassen und finale Prüfung erhalten.                                                        | apps/api/src/cart-quote.ts; apps/api/src/router.ts; apps/storefront/app/storefront/gateway.ts | Paket 2                            |
| M4  | Plan  | 24-Stunden-Warenkorberhalt                                                   | Gespeichert werden Status-/Zahlungsberechtigungen; Warenkorb nur im Arbeitsspeicher.          | Mandanten-/Standortbindung, Ablauf und sichere Wiederherstellung ohne Kontaktablage; danach Server-Neuprüfung.                                                             | apps/storefront/app/storefront/cart.ts; Storefront.tsx; A2 §2                                 | Paket 2                            |
| M5  | Teil  | Allergene, Zusatzstoffe und Auswahl im Restaurantauftrag                     | Konfiguration und selection_snapshot vorhanden; DashboardOrderLine enthält nur Grundposition. | Deklarationen kundenfreundlich anzeigen und unveränderliche Varianten-/Extra-Details in die rollenbegrenzte Restaurantprojektion übernehmen.                               | ADR0028; packages/contracts/src/dashboard-orders.ts; OrderBoard.tsx                           | Paket 2                            |
| M6  | Teil  | Befristete Produkt-/Varianten-/Optionsstopps                                 | Artikelzustände/Aktivkennzeichen stehen; zeitliche Auswahlsperren fehlen.                     | Start/Ende, Akteur/Grund und prüfwirksame Ablaufregeln in Pflege, Vorschau und finalem Checkout ergänzen.                                                                  | ADR0013/0028; Menü-/Auswahlmigration                                                          | Pakete 2/3                         |
| M7  | Teil  | Vollständige Summen-/Steuerdeklaration                                       | Konfigurierte Positionen enthalten einen deklarierten Steuersatz; Legacy unbekannt.           | Bestellkopf-Steueraufteilung und Liefergebühr prüfen/ergänzen; bei tatsächlich unterschiedlichen Steuern Auswahlmodell ausbauen. Fachliche Restaurantwerte nicht erfinden. | A2 §7 Punkte 6–8; ADR0028                                                                     | Paket 2; fachliche Werte vor Pilot |

### Restaurantbetrieb

| ID  | Stand | Anforderung                                         | Vorhanden                                                                                          | Fehlende Programmierung                                                                                                                                                         | Beleg                                                               | Einordnung         |
| --- | ----- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------ |
| B1  | Plan  | Private Echtzeitverteilung                          | Dashboard aktualisiert alle 15 Sekunden.                                                           | Private mandanten-/standortgebundene Realtime-Anbindung, Wiederverbindung und Duplikatschutz ergänzen.                                                                          | OrderBoard.tsx; ADR0023; A2 §§4,8,9                                 | Paket 3            |
| B2  | Teil  | Neueingang mit Ton, Stummschaltung und Annahmefrist | Bestellliste vorhanden; kein akustischer Alarm-/Eskalationsablauf.                                 | Interaktionsfreigabe für Ton, Stummschalter, priorisierten Neueingang und auditierten Timeout-/Eskalationspfad bauen. Zahlungsfrist und Restaurantannahmefrist getrennt halten. | OrderBoard.tsx; A2 §§9–10                                           | Paket 3            |
| B3  | Teil  | Stoßzeitsteuerung                                   | Zeitpläne, Slotkapazitäten und befristete Kanalpausen stehen in SQL.                               | Temporäre Vorlauf-/Kapazitätsüberschreibung, maximale offene Bestellungen, transaktionale Prüfung, Grund/Restdauer und sichere Bedienung ergänzen.                              | ADR0014; A2 §9.1                                                    | Paket 3            |
| B4  | Teil  | Standortkonfiguration im Dashboard                  | Öffnungszeiten, Sondertage und Lieferregeln sind serverseitig modelliert.                          | Zeit-, Vorlauf-, Slot-, Mindestwert- und Gebührenpflege mit Veröffentlichung, MFA und Audit anbinden.                                                                           | ADR0014/0025; Dashboard-/Routerinventar                             | Paket 3            |
| B5  | Teil  | Historie, Suche und Kennzahlen                      | Status-/Bestellart-/Standortfilter sowie Cursorliste existieren.                                   | Bestellnummer-, Zeitraum- und zulässige Kundennamensuche, Historienansicht und definierte Tages-/Wochenkennzahlen ergänzen.                                                     | apps/api/src/dashboard-orders.ts; OrderBoard.tsx; A2 §9 Punkte 9–10 | Pakete 3/4         |
| B6  | Teil  | Nachträgliche fachliche Korrekturen                 | Zeitkorrektur, Gründe und Lieferdispatch sind programmiert.                                        | Separaten bestätigten Korrekturvorgang für Positions-/Preisänderungen nach Annahme samt Zahlungsfolge und Audit ergänzen; historische Positionen nicht überschreiben.           | ADR0027; A2 §10                                                     | Paket 4            |
| B7  | Teil  | Garantiert eindeutige lesbare Bestellnummer         | UUID ist eindeutig; sichtbare Kurznummer nutzt orderId.slice(-8), ohne eigene Eindeutigkeitsregel. | Lesbare Nummer atomar vergeben, eindeutig im definierten Restaurant-/Standortumfang sichern und konsistent in Bestätigung, Status, Dashboard, Mail und Suche ausgeben.          | orders-Schema; OrderBoard.tsx; email-notifications.ts; A2 §7        | Paket 3; vor Pilot |

### Personal und Plattformverwaltung

| ID  | Stand | Anforderung                                 | Vorhanden                                                                               | Fehlende Programmierung                                                                                                              | Beleg                                                     | Einordnung                               |
| --- | ----- | ------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------- |
| A1  | Teil  | Personaleinladung und Mitgliedschaftspflege | Einladungs-/Mitgliedschaftslogik steht in SQL; keine vollständige Admin-API/Oberfläche. | Supabase-Auth-Einladung orchestrieren, Annahme sicher anbinden, Rollen/Standorte/Suspendierung bedienen.                             | ADR0010; apps/api/src/router.ts; apps/dashboard/README.md | Verwaltungsschnitt vor Pilot             |
| A2  | Teil  | PROVIDE-Administration und Go-live-Prüfung  | Restaurant-/Standort-Gates und Prüfpunkte stehen; Übergänge nutzen Owner/Manager.       | Getrennte PROVIDE-Berechtigung, Checklistenoberfläche, Freigabe und Wiederöffnung kritischer Prüfpunkte ergänzen.                    | ADR0009/0012; A2 §§5,13.1                                 | Paket 4; vor Pilot                       |
| A3  | Plan  | Viewer-Berechtigung                         | Vier Restaurantrollen owner/manager/kitchen/driver; A2 nennt zusätzlich viewer.         | Read-only-Rolle mit minimalem Standort-/Datenumfang modellieren und durch API/UI/RLS testen; keine Fahreroberfläche daraus ableiten. | ADR0009; A2 §9 Punkt 1                                    | Verwaltungsschnitt                       |
| A4  | Teil  | Konto-/MFA-Wiederherstellung                | Login, TOTP-Einrichtung und Challenge stehen.                                           | Auditierten Recovery-Prozess und sichere Wiederherstellung/letzten Faktor ergänzen; vorhandene MFA nicht umgehen.                    | ADR0022; MfaPanel/LoginForm                               | Vor Pilot; Details noch zu spezifizieren |

### Provider und Zustellung

| ID  | Stand | Anforderung                                         | Vorhanden                                                                         | Fehlende Programmierung                                                                                                                                                                                                     | Beleg                                                          | Einordnung                   |
| --- | ----- | --------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------- |
| P1  | Teil  | Echte transaktionale E-Mail                         | Vorlagen, Outbox, Claims, Retry/DLQ und interne Receipt-/Retryfunktionen stehen.  | Brevo-Adapter tatsächlich implementieren und verdrahten; Providerstatus sicher auf Receiptfunktion abbilden; berechtigten Wiederaufnahmeweg anbinden.                                                                       | apps/api/src/email-notifications.ts; index.ts; Router; ADR0027 | Provideranschluss zu Paket 1 |
| P2  | Teil  | Cloudflare Queues und allgemeine Ereigniszustellung | Scheduled Worker verarbeitet dauerhafte Postgres-Jobs; Outbox-Basis steht.        | A2-Queue-Anbindung sowie kanonische v1-Verträge, signierte externe Delivery, Retry/DLQ/Replay ergänzen. Gleichwertigen Architekturwechsel nur ausdrücklich dokumentiert übernehmen; vorhandene Jobs nicht grundlos doppeln. | apps/api/src/index.ts; wrangler.jsonc; ADR0006; A2 §§4,8.2     | Paket 4                      |
| P3  | Plan  | Echte Adressvalidierung/Geokoordinaten              | Formale Adresse und veröffentlichte PLZ-Regeln stehen.                            | Google-Provideradapter mit Normalisierung, Koordinaten, sicheren Ausfällen und serverseitiger Gebietsauswertung ergänzen.                                                                                                   | ADR0025; A2 §§2,4,16 DEC007                                    | Lieferausbau vor Pilot       |
| P4  | Teil  | Restaurantbezogene Zahlung und Erfassungszeitpunkt  | Stripe-Sandbox-Checkout, signierte Webhooks, Fristjobs und Vollerstattung stehen. | Connect-Onboarding/Accountzuordnung und restaurantbezogenen Zahlungsweg ergänzen; bevorzugte Autorisierung/Erfassung nach Annahme umsetzen. Sandbox-Soforterfassung ist keine freigegebene A2-Ersetzung.                    | apps/api/src/stripe-sandbox.ts; ADR0026; A2 §6.2               | Zahlungsausbau vor Pilot     |
| P5  | Teil  | Teilrückzahlung und berechtigte Supportkorrektur    | Vollerstattung/Refund-Retry vorhanden.                                            | Teilbeträge, Gründe, Berechtigungen, wiederholbaren Providerabgleich und Kundennachricht ergänzen.                                                                                                                          | ADR0026; A2 §10; Stripe-/Dashboard-Verträge                    | Paket 4 / Zahlungsausbau     |

### Support, Schutz und Pilotintegration

| ID  | Stand | Anforderung                                   | Vorhanden                                                                                       | Fehlende Programmierung                                                                                                                                                                      | Beleg                                                                        | Einordnung                 |
| --- | ----- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------- |
| O1  | Plan  | Supportfälle und übergreifende Abgleichsfälle | Einzelne Payment-/E-Mail-Jobs stehen; Supportfallmodell/Bedienweg fehlt.                        | Typ, Schweregrad, Verantwortliche, Frist, Aktionsverlauf, minimierte Sicht und eng begrenzte Korrekturbefehle bauen.                                                                         | A2 §10; Router-/Migrationsinventar                                           | Paket 4                    |
| O2  | Teil  | Feature-Verwaltung mit Standort/Ablauf/Audit  | Restaurantflags und sichere serverseitige Auflösung stehen.                                     | Standortüberschreibung, Freigabegrund, Ablaufprüfung und privilegierte Verwaltung/Audit ergänzen.                                                                                            | Migration 20260909040000; ADR0007; A2 §§7,11                                 | Paket 4                    |
| O3  | Teil  | Checkout-Sitzung und Missbrauchsschutz        | Idempotenz, Requestgrenzen, Tokens und Gates stehen.                                            | Kurzlebigen allgemeinen Checkout-Kontext, Rate-Limit-/Turnstile-Anbindung und sichere Abschaltung ergänzen; vorhandene Schutzmechanismen behalten.                                           | A2 §§5,8,11; index.ts/router.ts/wrangler.jsonc                               | Vor Provider-/Pilotöffnung |
| O4  | Teil  | Überwachung, Alarme und Störungsbehandlung    | Minimierte Logs und Worker-Observability stehen.                                                | Betriebsmetriken/Schwellen, alarmierte unklare Vorgänge, Circuit-Breaker-/Wiederanlaufpfade und Supportanzeige ergänzen; Alarmlieferung konfigurieren und testen.                            | logger.ts; wrangler.jsonc; A2 §§10–11                                        | Paket 4                    |
| O5  | Teil  | Automatisches Löschen abgelaufener Gastdaten  | Purge-Funktion und Integrationstest stehen; kein Aufruf im regulären Worker-Scheduler gefunden. | Berechtigten periodischen Purge-Aufruf mit begrenzter Batchgröße, Fehlerbehandlung und Betriebsnachweis anbinden oder bestehenden externen Scheduler nachweisen. CI-Testaufruf genügt nicht. | private.purge_expired_guest_checkout_data; index.ts; delivery.integration.ts | Paket 4; vor echten Daten  |
| O6  | Plan  | Asian-Kitchen-Import und Websiteanschluss     | Generische Storefront und synthetische Fixtures stehen.                                         | Validierten Import-/Initialisierungsweg und separaten Bestellapp-Anschluss an die geschützte 12.0-R1-Referenz umsetzen; echte Menü-/Steuerdaten und Parität danach prüfen.                   | A2 §§1,13–14; fixtures; Storefront.tsx                                       | Paket 2 / Pilotblock 10    |

## Kein erneutes Programmieren bereits vorhandener Grundlagen

| Frühere Vorbereitung                                             | Heutiger Stand                                                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Versioniertes Menü, geplante Aktivierung und Rollback            | SQL-Funktionen und Tests stehen. Für den Editor wiederverwenden.                                                                                   |
| Varianten-/Extra-Regeln und serverseitige Preisprüfung           | Im ersten Paket-2-Schnitt implementiert; nicht nochmals als neues Backend planen.                                                                  |
| Positions-/Adress-Snapshots, Idempotenz und Kapazität            | Implementiert; neue Bedienwege müssen die bestehende Transaktionsgrenze nutzen.                                                                    |
| Anmeldung, TOTP-Einrichtung und Challenge                        | Implementiert; offen ist der geregelte Wiederherstellungsprozess.                                                                                  |
| Zeitkorrektur, Ablehnungsgründe und Lieferdispatch               | Durch das E-Mail-Paket inzwischen implementiert; alte Ausschlussvermerke sind historisch.                                                          |
| E-Mail-Vorlagen, Claims, Retry, DLQ und Anbieterannahme-Abgleich | Implementiert und synthetisch geprüft; offen sind Provideradapter und Bedienanschluss.                                                             |
| Stripe-Sandbox-Checkout, Webhooks und Vollerstattung             | Implementiert; echte restliche Sandboxfälle sind zunächst Prüfaufgaben, kein Anlass für eine Neuprogrammierung.                                    |
| Gemeinsames UI-Paket                                             | README ist eine vorbereitete Ablage. Eigene geteilte Komponenten sind nur bei tatsächlicher Wiederverwendung nötig, kein separates Pflichtprojekt. |

Standardmäßig geschlossene Feature-Gates, Platzhalter für Preview-Konfiguration und
`unconfiguredEmailAdapter` sind absichtliche sichere Grenzen. Beim E-Mail-Adapter fehlt allerdings
der konkrete Provideranschluss: Ein Secret allein macht ihn nicht funktionsfähig.

## Konfiguration, Daten, Nachweise und Freigaben zusätzlich zur Programmierung

| Offene Aufgabe                                                                      | Art                                     | Abgrenzung                                                                                                                          |
| ----------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Brevo-Konto, Absender, SPF/DKIM/DMARC und Secrets                                   | Konfiguration                           | Ersetzt P1 nicht; erst danach reale Zustellung prüfen.                                                                              |
| Google-/Stripe-Accountdaten, Providerrechte und Sandbox-/Produktionsgrenzen         | Konfiguration/Freigabe                  | Ersetzt Connect-/Adresscode nicht.                                                                                                  |
| Verbindliche Asian-Kitchen-Preise, Steuern, Allergene und Betriebsdaten             | Fachliche Daten                         | Nicht aus synthetischen Fixtures ableiten.                                                                                          |
| Pilotimport und Menüparität                                                         | Umsetzung plus Datenprüfung             | O6 umsetzen; danach tatsächlichen Datenstand vergleichen.                                                                           |
| Noch offene Stripe-Fälle, Zustellung, Mehrgeräte, Tastatur/Screenreader und Geräte  | Praktische Prüfung                      | Nur gefundene Fehler erzeugen weitere Programmierung; kein neuer Test wird hier als bestanden eingetragen.                          |
| Backup/PITR, tägliche Sicherung, RPO/RTO und Wiederherstellung                      | Betriebsentscheidung/Konfiguration/Test | Providerbackup ist nicht pauschal ein fehlendes selbst geschriebenes Backupsystem; Automatisierung/Runbook gegebenenfalls ergänzen. |
| Datenschutz, AVV, Rechtstexte, Händlerrolle, Schulung und Restaurantzuständigkeiten | Fachliche Freigabe                      | Technische Minimierung oder CI ersetzen diese Nachweise nicht.                                                                      |
| Technische Endfreigabe, Merge, Deployment und Live-Aktivierung                      | Freigabe                                | Diese Prüfung führt keine dieser Aktionen durch.                                                                                    |

## Architekturabweichungen bewusst schließen

Der Sandbox-Schnitt verwendet Soforterfassung und legt offene Bestellungen vor endgültiger Zahlung
an. A2 beschreibt bevorzugt Autorisierung vor beziehungsweise bei Abgabe und Erfassung nach Annahme.
Restaurantbezogene Connect-Konten fehlen. Das ist weder durch die Sandbox-Erlaubnis noch durch diese
Bestandsaufnahme stillschweigend als produktiver Architekturwechsel genehmigt; im Zahlungsausbau ist
der Zielvertrag explizit zu schließen.

Die dauerhaften Postgres-Versandjobs sind echte Implementation. A2 nennt zusätzlich Cloudflare
Queues. Ein gleichwertiger, formal dokumentierter Zielwechsel kann doppelte Infrastruktur vermeiden;
bis dahin ist die A2-Anbindung offen. Es wird hier kein neuer Queue-Anbieter eingeführt.

Liefer-„Unterwegs“ ist bereits als Kommunikationsereignis programmiert. Die interne Statusmaschine
verwendet weiterhin `ready` und nicht alle wörtlichen A2-Statuswerte. Beim endgültigen
Status-/Integrationsvertrag muss die semantische Zuordnung dokumentiert werden; Namen allein
begründen keine erneute Implementierung einer bereits erfüllten Handlung.

## Korrektur am Fortschrittsabgleich

Die tiefere Prüfung zeigt: Die sichtbare „Bestellnummer“ ist derzeit der obere UUID-Suffix aus acht
Hexzeichen. Die vollständige UUID ist eindeutig, der Kurzsuffix besitzt keine eigene
Eindeutigkeitsgarantie. Daher wird Prüfposition A2-5-1 von 1 auf 0,5 korrigiert; atomare Abgabe und
Idempotenz bleiben belegt.

Block 5 erreicht damit 5/7 = 71,4 %. Der Gesamtwert ist nach derselben Formel 56,547619 %, weiterhin
**57 % gerundet**. Die bisherige rechnerische Angabe 57,142857 % war für diese Position zu
großzügig. Die aktualisierte Halbpunkt-Sensitivität beträgt 50,5–62,6 %. Weitere technische Lücken
werden hier innerhalb der bereits teilweise/offen bewerteten Positionen konkretisiert; sie erzeugen
keine automatisch zusätzliche Prozentgutschrift.

## Empfohlene Bündelung und Reihenfolge

1. **Paket 2 fertigstellen:** M1–M6, M7 im tatsächlichen Deklarationsumfang, O6 vorbereiten.
   Menüeditor und Kundenauswahl zusammen mit Preisquote, Snapshotanzeige, Konflikten und
   Warenkorberhalt durchgängig anschließen. Keine Veröffentlichung konfigurierter Artikel als
   vollständig bedienbar behaupten, bevor Kundenauswahl und Küchendetails funktionieren.
2. **Paket 3 Restaurantbetrieb:** B1–B5/B7 und die notwendigen Personalrechte. Realtime, Alarm,
   Betriebsregeln, Konfiguration und lesbare Bestellnummer gemeinsam mit passenden
   Konflikt-/Ablauftests umsetzen.
3. **Provideranschlüsse gezielt ergänzen:** P1/P3/P4 mit der jeweils nötigen Konfiguration und
   getrennten echten Tests. Providerkonten/Livefreigaben nicht zur Voraussetzung für unabhängige
   Oberflächenarbeit machen.
4. **Paket 4 Support/Betriebsnachweise:** A2, B6, P2/P5 und O1–O5. Account-Recovery und
   Verwaltungsanschlüsse vor Pilot vervollständigen.
5. **Pilot und Produktivgate:** importierte reale Daten, Schulung, vollständige
   Geräte-/Providerfälle, Datenschutz und dokumentierte Freigaben.

Vor jedem Umsetzungsschnitt werden die Detailverträge innerhalb dieser bereits autorisierten
Produktgrenzen konkret festgehalten. Empfehlungen und Routineentscheidungen sind delegiert;
Endfreigaben bleiben getrennt. „Vorbereitet“ wird künftig nur mit Zusatz verwendet: **fachlich
beschrieben**, **Backend implementiert**, **Bedienweg angeschlossen** oder **praktisch abgenommen**.

## Validierung und Protokolleintrag

Projektweiter A2-/Code-Abgleich und Dokumentationsformatprüfung; Codebaum unverändert. Die Liste
umfasst 29 gruppierte Lücken, davon 23 mit vorhandener Teilumsetzung und 6 bisher auf Planungsebene.
Sie ist die aktuelle Nachprogrammierungsliste; keine Aufwandsschätzung oder Abnahmequote.
