# Aktualisierter A2-Abgleich – 1. Oktober 2026

## Ergebnis und Geltungsbereich

Der aktualisierte Umsetzungsstand beträgt **57 %** (rechnerisch 56,547619 %). Bewertet werden alle
zwölf A2-Hauptblöcke 0–11; Unterarbeitsblöcke vergrößern den Nenner nicht. Grundlage sind 82
nachvollziehbare Prüfpositionen. Der Wert umfasst vorhandene Umsetzung einschließlich der geprüften,
noch nicht zusammengeführten Entwurfs-PRs #8, #10 und #11. Er bedeutet weder 57 % produktiv
ausgelieferte Funktionen noch 57 % bestandene praktische Abnahme.

Die bisher genannten 50 % ±10 Prozentpunkte waren eine grobe historische Schätzung (5¾/12 = 47,9 %,
gerundet). Sie werden für den aktuellen Umsetzungsstand durch diesen Abgleich ersetzt. Die alte und
die neue Zahl verwenden unterschiedliche Bewertungsauflösungen; daraus lässt sich kein belastbarer
Arbeitszuwachs von exakt sieben Prozentpunkten ableiten. Die engere historische README-MVP-Bewertung
von 84 % verwendet einen anderen Umfang und ist ebenfalls kein aktueller A2-Gesamtwert.

## Methode

Jeder Hauptblock zählt gleich viel: 1/12. Innerhalb eines Blocks zählen seine aufgeführten
Prüfpositionen gleich viel. Eine Position erhält 1 bei vollständig vorhandener Umsetzung im
beschriebenen Anforderungsumfang, 0,5 bei einem belegten, noch unvollständigen Teil und 0 bei
fehlender Umsetzung. Abhängigkeiten werden ihrer jeweiligen fachlichen Wirkung zugeordnet:
beispielsweise Auswahlmodell im Menü, Preisprüfung im Warenkorb und historischer Auswahlsnapshot in
der Bestellung.

Formel: Gesamtwert = 100 × Summe über alle Blöcke (erreichte Punkte / Prüfpositionen) / 12. Block 0
bewertet dokumentierte Entscheidungen; dort ist kein Produktcode erforderlich. 100 % Fundament
bedeutet vollständige Umsetzung der sechs Fundamentpositionen, keine formale Freigabe des gesamten
Produkts.

Die Aufteilung und Halbpunktbewertung bleiben eine fachliche Schätzung, kein objektiver
Fertigstellungsgrad oder Zeitaufwand. Würden sämtliche Halbpunktpositionen stattdessen mit 0,25
beziehungsweise 0,75 bewertet, läge der Gesamtwert zwischen 50,5 % und 62,6 %. Das ist eine
Sensitivität der Bewertungsmethode, kein statistisches Vertrauensintervall.

Automatische Prüfungen werden als Nachweise für vorhandene Teilumfänge geführt. Testanzahlen werden
nicht in Fertigstellungsprozente umgerechnet. Praktische Abnahmen stehen separat; eine
Gesamt-Abnahmequote wird mangels einer vollständig belegten, gleichartig bewerteten Fallmatrix nicht
erfunden.

## Übersicht aller zwölf Hauptblöcke

| Block                                      | Umsetzung | Punkte / Positionen | Prüf- und Abnahmestand                                                                                                                          |
| ------------------------------------------ | --------: | ------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 – SoT und Entscheidungen                 |   100,0 % |               4 / 4 | Dokumentarische Nutzerfreigabe in V2/E01; keine Laufzeittests erforderlich.                                                                     |
| 1 – Technisches Fundament                  |   100,0 % |               6 / 6 | CI und historischer Cloudflare-/Postgres-Preview-Spike belegt; keine daraus abgeleitete Produktionsfreigabe.                                    |
| 2 – Mandanten, Auth und Onboarding         |    71,4 % |               5 / 7 | RLS/Auth/Onboarding automatisiert geprüft; keine vollständige Onboarding-/Admin-Bedienabnahme.                                                  |
| 3 – Menü und Verfügbarkeit                 |    50,0 % |               4 / 8 | Versions-/Auswahl-/Preis-/Konkurrenztests belegt; Editor, Kundenauswahl und Pilotparität offen.                                                 |
| 4 – Warenkorb und Regeln                   |    66,7 % |               6 / 9 | Manipulations-/Zeit-/Kapazitäts-/Lieferprüfungen belegt; echte Adressprüfung und vollständiger Warenkorbpfad offen.                             |
| 5 – Bestellung, Status und Ereignisse      |    71,4 % |               5 / 7 | Transaktions-/Status-/Snapshot-/Idempotenztests belegt; garantiert eindeutige lesbare Bestellnummer und externe Zustellung offen.               |
| 6 – Restaurant-Dashboard und Betriebsmodus |    50,0 % |               4 / 8 | API-/Datenbankbefehle geprüft; Realtime, Ton, Mehrgeräte- und vollständige Betriebsbedienabnahme offen.                                         |
| 7 – Zahlung                                |    57,1 % |               4 / 7 | Automatisierte Sandbox-Grenztests und einzelne echte Abhol-/Erstattungs-/verzögerte Zahlungsfälle belegt; vollständige Stripe-Fallmatrix offen. |
| 8 – Kundenstatus und Nachrichten           |    78,6 % |             5,5 / 7 | Vorlagen-/Retry-/DLQ-/Statusprüfungen mit synthetischem Adapter belegt; echte Brevo-Zustellung offen.                                           |
| 9 – Betrieb, Support und Auswertung        |    33,3 % |               3 / 9 | Teilnachweise für Logs, Jobs und Fachverläufe; Support-, Alarm- und Restore-Abnahme offen.                                                      |
| 10 – Asian-Kitchen-Pilot                   |     0,0 % |               0 / 5 | Keine vollständige Pilotabnahme.                                                                                                                |
| 11 – Produktivfreigabe                     |     0,0 % |               0 / 5 | Keine Produktivfreigabe.                                                                                                                        |

## Fortschritt seit der bisherigen groben Bestandsaufnahme

- Der erfolgreiche externe Preview-Spike vom 8. September ist im technischen Fundament ausdrücklich
  berücksichtigt. Diese Korrektur betrifft bereits früher erbrachte Arbeit.
- Paket 1 ergänzt verpflichtende Gast-E-Mail, Vorlagen, dauerhafte Versandaufträge, sichere
  Wiederholung, DLQ, bestätigte Zeiten, Zeitkorrektur und Liefer-Unterwegs-Kommunikation. Echte
  Providerzustellung bleibt offen.
- Der erste Schnitt von Paket 2 ergänzt Varianten-/Extra-Konfiguration, deklarierte
  Produktinformationen, gemeinsame serverseitige Preis-/Steuerprüfung, unveränderliche
  Auswahl-Snapshots und Cart-Quote. Menüeditor, Auswahlbedienung, Warenkorbspeicherung und
  Pilotparität bleiben offen.
- Der Zahlungsabgleich berücksichtigt einzelne belegte echte Sandbox-Fälle und sichere
  Fristbehandlung. Connect, bevorzugte manuelle Erfassung und die vollständige praktische
  Fehlermatrix bleiben offen.

## Nachweisstand und Freigabegrenzen

Technischer Bewertungsstand ist der Codebaum von PR #11 am Commit
`7703d45e7df26ad935cfd9780b208ee14effcc15`, Baum `c21e82007df1cb65f0cbb8b150b16f6adae9e886`. Dieser
enthält die vorangehenden Zahlungs- und E-Mail-Schnitte. Lokaler Implementierungsbaum, GitHub-Head
und CI-Mergebaum wurden abgeglichen.

[CI-Lauf 36766533426](https://github.com/PROVIDE-Webdesign/Provide-bestellsystem/actions/runs/36766533426)
ist erfolgreich: check/database, 236 Unit-/Contracttests, 1.087 pgTAP-Prüfungen in 25 Dateien und
separate API/PostgreSQL-Integration. Die lokale isolierte Supabase-Sicherheitsprüfung meldet keine
Befunde. Das belegt die getesteten Grenzen dieses Codebaums, keine vollständige Sicherheits-,
Geräte-, Provider- oder Produktionsabnahme.

PR #10: `484ec2d1aa5e602f76476cc82fc65ca6692f078e`,
[CI 36753000640](https://github.com/PROVIDE-Webdesign/Provide-bestellsystem/actions/runs/36753000640).
PR #8: `4e422f5b9ce7324e56bdb2b4e8d4cbd76ca3c8cc`,
[CI 36573239896](https://github.com/PROVIDE-Webdesign/Provide-bestellsystem/actions/runs/36573239896).
Zusammengeführte Basis: `c3530b2dacdb814cfc2cc47664ab23b11ce878d0` (PR #7). Eine separate neue
Prozentzahl allein für den zusammengeführten main-Zweig wird hier nicht berechnet.

Die dokumentarische Freigabe von Hauptblock 0 ist belegt. Freigaben einzelner technischer
Unterblöcke sind in ADRs/Arbeitsblockprotokollen dokumentiert; daraus wird keine pauschale
Endfreigabe aller übrigen Hauptblöcke abgeleitet. PRs #8, #10 und #11 bleiben Entwürfe. Dieser
Abgleich erteilt keine Merge-, Deployment-, Provider- oder Live-Freigabe.

## Einzelbewertung

### Block 0 – SoT und Entscheidungen

Anforderung: A2 §§1–3,16–17; V2/E01.

| ID     | Prüfposition                                         | Punkte | Beleg und verbleibender Umfang |
| ------ | ---------------------------------------------------- | -----: | ------------------------------ |
| A2-0-1 | Produktumfang, Referenz und Projekttrennung          |      1 | A2; V2/E01                     |
| A2-0-2 | Rollen, Anbieterzuständigkeiten und Pilotgrenzen     |      1 | V2/E01                         |
| A2-0-3 | Bestätigte Richtungsentscheidungen und Startfreigabe |      1 | V2/E01                         |
| A2-0-4 | Gebündelter Ablauf und getrennte Freigabeschritte    |      1 | V2/E01; PR9                    |

### Block 1 – Technisches Fundament

Anforderung: A2 §§4,14–15.

| ID     | Prüfposition                                                 | Punkte | Beleg und verbleibender Umfang                           |
| ------ | ------------------------------------------------------------ | -----: | -------------------------------------------------------- |
| A2-1-1 | Monorepo, gemeinsame Verträge und Build                      |      1 | ADR0002; CI90                                            |
| A2-1-2 | Umgebungs- und Secret-Grenzen                                |      1 | ADR0003; Laufzeit-Gates                                  |
| A2-1-3 | CI mit Unit-, Datenbank- und API-Integration                 |      1 | CI90                                                     |
| A2-1-4 | Cloudflare-/Postgres-Spike und reproduzierbarer Preview-Pfad |      1 | docs/spikes/0001-cloudflare-postgres.md; Preview-Runbook |
| A2-1-5 | Migrationen, transaktionale Outbox-Basis                     |      1 | ADR0005/0006; Tests0001–0003                             |
| A2-1-6 | Serverseitige Feature-Basis mit sicherem Standard            |      1 | ADR0007; Test0004                                        |

### Block 2 – Mandanten, Auth und Onboarding

Anforderung: A2 §§5,7,11,13.1.

| ID     | Prüfposition                                              | Punkte | Beleg und verbleibender Umfang                                                     |
| ------ | --------------------------------------------------------- | -----: | ---------------------------------------------------------------------------------- |
| A2-2-1 | Restaurants, Standorte und mandantensichere Beziehungen   |      1 | ADR0008; Tests0002/0005                                                            |
| A2-2-2 | Personalrollen und Standortgrenzen                        |    0,5 | ADR0009; Restaurantrollen vorhanden, getrennte PROVIDE-Administration/Viewer offen |
| A2-2-3 | Einladungen, Suspendierung und Personalpflege             |    0,5 | ADR0010; Datenbankabläufe vorhanden, Verwaltungsoberfläche offen                   |
| A2-2-4 | Verifizierte Auth-Sitzungen und privilegierte MFA         |      1 | ADR0011/0022; Tests0008/0018                                                       |
| A2-2-5 | Revisionsfähige Onboarding-Prüfpunkte und Statusübergänge |      1 | ADR0012; Test0009                                                                  |
| A2-2-6 | Fail-closed Go-live-/Suspendierungs-Gate                  |      1 | ADR0012; Test0009                                                                  |
| A2-2-7 | PROVIDE-Freigabe und Wiederöffnung kritischer Prüfpunkte  |      0 | ADR0012 verwendet Restaurant-Owner/Manager; gesonderter Rücksetzablauf offen       |

### Block 3 – Menü und Verfügbarkeit

Anforderung: A2 §§3.1,7,8.1.

| ID     | Prüfposition                                                             | Punkte | Beleg und verbleibender Umfang                                                     |
| ------ | ------------------------------------------------------------------------ | -----: | ---------------------------------------------------------------------------------- |
| A2-3-1 | Versionsgebundene Kategorien, Artikel und öffentliche Grundkarte         |      1 | ADR0013/0019; Tests0010/0015                                                       |
| A2-3-2 | Unveränderliche Entwürfe, Veröffentlichung, Zeitaktivierung und Rollback |      1 | ADR0013; Test0010                                                                  |
| A2-3-3 | Varianten und Extras mit serverseitigen Auswahlgrenzen                   |    0,5 | ADR0028; Test0025; Daten/API vorhanden, Kundenauswahl offen                        |
| A2-3-4 | Allergene, Zusatzstoffe und deklarierte Produktsteuer                    |    0,5 | ADR0028; Daten/Validierung vorhanden, vollständige Anzeige/Pilotdaten offen        |
| A2-3-5 | Ausverkauft und befristete Artikel-/Variantenverfügbarkeit               |    0,5 | ADR0013; Artikelzustände vorhanden, zeitliche Variantenstopps offen                |
| A2-3-6 | Menüpflege und bewusste Freigabe im Dashboard                            |      0 | Interne Schreiber vorhanden; Editor und verifizierter API-Bedienweg offen          |
| A2-3-7 | 12.0-R1-Import und nachgewiesene Menüparität                             |      0 | Pilotimport/Paritätsprüfung offen                                                  |
| A2-3-8 | Neuprüfung laufender Warenkörbe bei Veröffentlichung                     |    0,5 | ADR0028; Cart-Quote und Konkurrenztest vorhanden, bewusste Kundenbestätigung offen |

### Block 4 – Warenkorb und Regeln

Anforderung: A2 §§2,3.1,8,15.

| ID     | Prüfposition                                                   | Punkte | Beleg und verbleibender Umfang                                                               |
| ------ | -------------------------------------------------------------- | -----: | -------------------------------------------------------------------------------------------- |
| A2-4-1 | Serverpreise, Auswahlregeln, Cent-Beträge und Steuerberechnung |      1 | ADR0028; Test0025; API-Integration                                                           |
| A2-4-2 | Gastcheckout, Pflichtkontakte und Datenminimierung             |      1 | ADR0017/0020/0027; Tests0014/0016/0023                                                       |
| A2-4-3 | Abholung und Lieferung samt Mindestwert und Gebühr             |      1 | ADR0025; Test0021; API-Integration                                                           |
| A2-4-4 | Echte Adressnormalisierung und Geokoordinaten                  |      0 | Nur formale deutsche Adresse/PLZ; Google-Adapter nicht umgesetzt                             |
| A2-4-5 | Öffnungszeiten, Sondertage, Zeitzonen und Zeitfenster          |      1 | ADR0014; Test0011                                                                            |
| A2-4-6 | Atomare Kapazitätsprüfung bei paralleler Bestellung            |      1 | ADR0014/0025; Tests0011/0021; API-Integration                                                |
| A2-4-7 | Verständliche Warenkorb-Neubewertung und Auswahlbedienung      |    0,5 | Grundcheckout/Lieferquote vorhanden; Variantenbedienung und Menüänderungsbestätigung offen   |
| A2-4-8 | Lokaler 24-Stunden-Warenkorb                                   |      0 | Statusberechtigungsspeicher ersetzt keinen Warenkorbspeicher                                 |
| A2-4-9 | Kurzlebige Checkout-Sitzung und Missbrauchsschutz              |    0,5 | Idempotenz, enge Payloads und Gates vorhanden; allgemeine Sitzung/Rate-Limit/Turnstile offen |

### Block 5 – Bestellung, Status und Ereignisse

Anforderung: A2 §§6–8.2.

| ID     | Prüfposition                                                   | Punkte | Beleg und verbleibender Umfang                                                                                                      |
| ------ | -------------------------------------------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------- |
| A2-5-1 | Atomare Abgabe, Bestellnummer und Idempotenz                   |    0,5 | Atomare Abgabe/Idempotenz belegt; lesbarer UUID-Kurzsuffix ohne eigene Eindeutigkeitsgarantie. Siehe Nachprogrammierungsprüfung B7. |
| A2-5-2 | Unveränderliche Artikel-, Auswahl-, Preis- und Adresssnapshots |      1 | ADR0015/0025/0028; Tests0012/0021/0025                                                                                              |
| A2-5-3 | Serverseitige Statusmaschine und lückenloser Verlauf           |      1 | ADR0015/0023/0027; Tests0012/0019/0024                                                                                              |
| A2-5-4 | Zeitkorrektur, Gründe und Liefer-Unterwegs-Ereignis            |      1 | ADR0027; Test0024                                                                                                                   |
| A2-5-5 | Transaktionale, minimierte Outbox und interne Idempotenz       |      1 | ADR0006/0024/0027; Tests0003/0020/0023                                                                                              |
| A2-5-6 | Vollständige A2-v1-Ereignisnamen und Umschlagverträge          |    0,5 | Interne Ereignisse vorhanden; alle kanonischen A2-Verträge/Kompatibilität offen                                                     |
| A2-5-7 | Signierte externe Zustellung, Retry, DLQ und Replay            |      0 | E-Mail-Consumer deckt keine allgemeine externe Integrationszustellung ab                                                            |

### Block 6 – Restaurant-Dashboard und Betriebsmodus

Anforderung: A2 §§9,9.1,14–15.

| ID     | Prüfposition                                                        | Punkte | Beleg und verbleibender Umfang                                         |
| ------ | ------------------------------------------------------------------- | -----: | ---------------------------------------------------------------------- |
| A2-6-1 | Authentifizierter Eingang, Details und rollenbegrenzte Statuspflege |      1 | ADR0022/0023/0025/0027; Tests0018/0019/0024                            |
| A2-6-2 | Annahme, Ablehnung, Zeitkorrektur und Zahlungs-Gates                |      1 | ADR0027; Tests0022/0024                                                |
| A2-6-3 | Private Realtime-Kanäle                                             |      0 | OrderBoard nutzt 15-Sekunden-Polling                                   |
| A2-6-4 | Akustischer/visueller Alarm, Stummschaltung und Eskalation          |    0,5 | Bestellübersicht vorhanden; Ton, Stummschaltung und Eskalation offen   |
| A2-6-5 | Zeitlich begrenzte getrennte Kanalpausen                            |    0,5 | ADR0014; Test0011; Datenbank vorhanden, operative Bedienung offen      |
| A2-6-6 | Temporäre Vorlaufzeit und maximale offene Bestellungen              |      0 | Vollständige auditierte Betriebsübersteuerung offen                    |
| A2-6-7 | Pflege von Zeiten, Kapazität und Lieferregeln im Dashboard          |    0,5 | Serverkonfiguration/Prüfung vorhanden; Bedienoberfläche offen          |
| A2-6-8 | Automatisches Regelende und konkurrierende Gerätebefehle            |    0,5 | Ablauf-/Konflikttests vorhanden; Mehrgeräte-/Wiederanlaufabnahme offen |

### Block 7 – Zahlung

Anforderung: A2 §§6.2,8,12,16 DEC005.

| ID     | Prüfposition                                                  | Punkte | Beleg und verbleibender Umfang                                                      |
| ------ | ------------------------------------------------------------- | -----: | ----------------------------------------------------------------------------------- |
| A2-7-1 | Stripe Connect, Restaurant-Onboarding und Auszahlung          |      0 | ADR0026: ausdrücklich außerhalb Sandbox-Schnitt                                     |
| A2-7-2 | Hosted Checkout/PaymentIntent und Betrag-/Account-Prüfung     |    0,5 | ADR0026; Test0022; kein Connected-Account-Pilotpfad                                 |
| A2-7-3 | Signierte Webhooks, Inbox-Idempotenz und sichere Wiederholung |      1 | ADR0026; Test0022; Sandbox-Eingänge dokumentiert                                    |
| A2-7-4 | Autorisierung und Erfassung nach Restaurantannahme            |      0 | Soforterfassung in Sandbox; bevorzugte A2-Logik nicht umgesetzt                     |
| A2-7-5 | Zahlungs-/Bestelltrennung, Annahmesperre und Fristabgleich    |      1 | ADR0026; Test0022; rechtzeitige Sandbox-Zahlung bei verspäteter Verarbeitung belegt |
| A2-7-6 | Erstattung, unklare Zustände und berechtigter Retry           |    0,5 | Vollerstattung vorhanden; Teilrückzahlung/Supportprozess offen                      |
| A2-7-7 | Konfigurierbare Zahlung vor Ort und getrennte Zahlungs-Gates  |      1 | ADR0016/0020/0025/0026; Tests0013/0016/0021/0022                                    |

### Block 8 – Kundenstatus und Nachrichten

Anforderung: A2 §§3.1,5,8,14–15.

| ID     | Prüfposition                                                     | Punkte | Beleg und verbleibender Umfang                                                  |
| ------ | ---------------------------------------------------------------- | -----: | ------------------------------------------------------------------------------- |
| A2-8-1 | Zeitbegrenzter, mandanten-/bestellgebundener Statuszugang        |      1 | ADR0021/0027; Test0017; Fragmentlink                                            |
| A2-8-2 | Kundenstatusanzeige einschließlich bestätigter Zeit/Lieferstatus |      1 | ADR0021/0027; Tests0017/0024                                                    |
| A2-8-3 | E-Mail-Anlässe und Text-/HTML-Vorlagen                           |      1 | ADR0027; Tests0023/0024                                                         |
| A2-8-4 | Durable Versandaufträge, Idempotenz und PII-arme Fanout          |      1 | ADR0027; Test0023                                                               |
| A2-8-5 | Retry, unbekannte Annahme, DLQ und kontrollierte Wiederaufnahme  |      1 | ADR0027; Test0023; synthetischer Adapter                                        |
| A2-8-6 | Cloudflare-Queue-Anbindung und Ausfall-Wiederherstellung         |    0,5 | Postgres-Jobs implementiert; Cloudflare Queues und realer Ausfallnachweis offen |
| A2-8-7 | Brevo, Absenderdomain, Zustellrückmeldung und reale Zustellung   |      0 | Default unkonfiguriert; nur .invalid-Testadapter                                |

### Block 9 – Betrieb, Support und Auswertung

Anforderung: A2 §§9–11,14–15.

| ID     | Prüfposition                                                 | Punkte | Beleg und verbleibender Umfang                                                        |
| ------ | ------------------------------------------------------------ | -----: | ------------------------------------------------------------------------------------- |
| A2-9-1 | Bestellhistorie und fachliche Suche                          |    0,5 | Dashboardliste/Cursor vorhanden; Suchfilter und vollständige Historienbedienung offen |
| A2-9-2 | Tages-/Wochenkennzahlen                                      |      0 | Auswertung nicht umgesetzt                                                            |
| A2-9-3 | Audit für administrative und operative Änderungen            |    0,5 | Append-only Fachverläufe vorhanden; zentrale vollständige Auditabdeckung offen        |
| A2-9-4 | Supportfälle, Verantwortliche und kontrollierte Fachaktionen |      0 | Supportmodell/-oberfläche nicht umgesetzt                                             |
| A2-9-5 | Zahlungs-/Benachrichtigungs-Abgleichsjobs                    |    0,5 | Payment-/E-Mail-Jobs vorhanden; übergreifende Ausnahmefälle offen                     |
| A2-9-6 | Feature-Verwaltung mit Standort, Ablauf und Freigabegrund    |    0,5 | Tenantflags vorhanden; Standort/Ablauf/Adminbedienung offen                           |
| A2-9-7 | Monitoring und getestete Alarmierung                         |    0,5 | Minimierte technische Logs vorhanden; Betriebsalarme offen                            |
| A2-9-8 | Backup/PITR, RPO/RTO und Wiederherstellungsprüfung           |      0 | Kein belastbarer Restore-Nachweis                                                     |
| A2-9-9 | Runbooks für Provider-/Internet-/Dashboardausfall            |    0,5 | Preview-/Sandbox-/lokale Runbooks vorhanden; vollständiger Restaurantfallback offen   |

### Block 10 – Asian-Kitchen-Pilot

Anforderung: A2 §§1,13–15.

| ID      | Prüfposition                                             | Punkte | Beleg und verbleibender Umfang               |
| ------- | -------------------------------------------------------- | -----: | -------------------------------------------- |
| A2-10-1 | Integration in geschützte 12.0-R1-Website                |      0 | Nicht umgesetzt                              |
| A2-10-2 | Echter Menüimport und verbindliche Standortkonfiguration |      0 | Nicht durchgeführt                           |
| A2-10-3 | Restaurant-/Personal-Onboarding und Schulung             |      0 | Nicht abgenommen                             |
| A2-10-4 | Staging-Abnahme mit Geräten und Zugänglichkeit           |      0 | Vollständige Gerätematrix/WCAG-Abnahme offen |
| A2-10-5 | Restaurant-/Nutzerfreigabe und Pilotbetrieb              |      0 | Nicht erteilt                                |

### Block 11 – Produktivfreigabe

Anforderung: A2 §§11–15.

| ID      | Prüfposition                                           | Punkte | Beleg und verbleibender Umfang                                 |
| ------- | ------------------------------------------------------ | -----: | -------------------------------------------------------------- |
| A2-11-1 | Produktionssicherheit, Last- und Release-Prüfung       |      0 | Lokale/CI-Schutztests sind keine Produktionsfreigabe           |
| A2-11-2 | Datenschutz, AVV, Rechtstexte und Betroffenenprozesse  |      0 | Technische Minimierung ersetzt fachliche Freigabe nicht        |
| A2-11-3 | Händlerrolle, produktive Provider und Zahlungsfreigabe |      0 | Sandboxnachweise ersetzen Live-Freigabe nicht                  |
| A2-11-4 | Support-, Backup- und Betriebsfreigabe                 |      0 | Nicht abgenommen                                               |
| A2-11-5 | Vollständiges Go-live-Gate und dokumentierte Freigabe  |      0 | Gate-Fundament vorhanden; tatsächliche Produktivfreigabe offen |

## Quellen und Grenzen

Verbindlich: „PROVIDE Bestellsystem – Systemarchitektur und verbindlicher Arbeitsplan A2“, Stand
31.08.2026, insbesondere §§2–15; organisatorisch Projektprotokoll V2 mit E01. Historischer
Vergleich: Übergabe vom 27.09.2026. Diese Quellen wurden für den Abgleich vollständig eingelesen.

Repositorybelege: `docs/decisions/0002–0028`, `docs/spikes/0001-cloudflare-postgres.md`,
Preview-/Betriebsrunbooks, Arbeitsblockprotokolle, Implementierung in API/Storefront/Dashboard und
zugehörige `supabase/tests/0001–0025`. Fehlende Oberflächen und Integrationen wurden zusätzlich
durch begrenzte Code-Suchen geprüft; bloße Nichtauffindbarkeit wird nicht als Nachweis einer
absoluten projektweiten Abwesenheit verwendet.

Echte Stripe-Nachweise stammen aus dokumentierten lokalen Sandbox-Abgleichen. Insbesondere sind
signierter Ereigniseingang, endgültiger Zahlungszustand und einzelne Abhol-/Erstattungsfälle nicht
gleichbedeutend mit einer vollständig bestandenen Liefer-, 3DS-, Wiederlade-, Frist- und
Webhook-Abnahmematrix. Ein historisch abgeschlossener Fristfall ist kein neuer kontrollierter
Zehn-Minuten-Test.

Die Bewertung erfüllt keine rechtliche, steuerliche oder produktive Anbieterfreigabe.
Legacy-Datensätze erhalten keine erfundenen Steuer-/Allergenwerte. Synthetische Testdaten sind keine
Asian-Kitchen-Pilotparität.

## Priorisierte Fortsetzung

1. Menüpflege und bewusste Veröffentlichung im Dashboard einschließlich verifizierter Akteurs-,
   Standort- und MFA-Prüfung.
2. Kundenauswahl, verständliche Warenkorb-Neubewertung und 24-Stunden-Speicherung.
3. Verbindlicher Pilotimport und Paritätsprüfung, anschließend verbleibende Restaurantbetriebs- und
   Supportpakete.

Reale Providerzustellung, Stripe-Abnahmematrix und Geräteprüfungen werden als eigene offene
Nachweise weitergeführt. Sie blockieren nicht die unabhängige technische Arbeit an den nächsten
Oberflächen.

Validierung dieses Abgleichs: rechnerische Auswertung der 82 Positionen, Abgleich der zwölf
Blockquoten, Quellen-/Codeprüfung und Repository-Prettier-Prüfung. Keine Laufzeitänderung;
vorhandene CI-Nachweise wurden wiederverwendet.

## Vertiefte Nachprogrammierungsprüfung vom 01.10.2026

Die [projektweite Programmierungslückenprüfung](2026-10-01-missing-implementation-audit.md)
konkretisiert fehlende Bedienwege, Provideranschlüsse und Betriebsabläufe. Sie korrigiert A2-5-1 auf
0,5, weil der sichtbare UUID-Kurzsuffix keine eigene Eindeutigkeitsgarantie besitzt. Atomare Abgabe
und Idempotenz bleiben belegt. Der ursprüngliche Rechenwert 57,142857 % ist damit durch 56,547619 %
ersetzt; der gerundete Umsetzungsstand bleibt 57 %.
