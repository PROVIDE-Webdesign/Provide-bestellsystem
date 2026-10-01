# Paket 3: Restaurantbetrieb - Bestandsaufnahme und Reihenfolge

Grundlage: A2 Abschnitt 9/9.1 und die Lücken B1-B7 aus Planungs-PR #9. Der Nutzer hat am 01.10.2026
die externen Pilot- und Gerätefälle bis zur Laptopverfügbarkeit
[eingefroren](2026-10-01-frozen-pilot-acceptance.md) und Paket 3 beauftragt.

| Baustein                     | Vorhanden                                                     | Umsetzung in diesem Schnitt / nächste Gruppe                                                               |
| ---------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| B7 Bestellnummer             | UUID mit verkürzter Anzeige, keine garantierte lesbare Nummer | Zentrale unveränderliche Nummer; Checkout, Gaststatus, Dashboard, E-Mail und genaue Nummernsuche           |
| B1 Realtime                  | Standortberechtigte REST-Listen, Polling alle 15 Sekunden     | Offen: privater Mandanten-/Standortkanal, Reconnect, Deduplizierung und sichere Nachladung                 |
| B2 Alarm                     | Statusbearbeitung, kein vollständiger Alarmablauf             | Offen: opt-in Ton, sichtbare Stummschaltung, separate Annahmefrist und protokollierte Eskalation           |
| B3 Betriebssteuerung         | Zeitfenster, Kapazitätsprüfung und Pausen-Grundlagen          | Offen: temporäre Vorlaufzeit/Kapazität/maximal offene Aufträge mit Grund, Ablauf und atomarer Durchsetzung |
| B4 Standortkonfiguration     | Bestehende Regeln, AAL2- und Rollenprüfungen                  | Offen: vollständige Pflege, Versionierung und Veröffentlichung der Betriebsregeln mit Audit                |
| B5 Historie/Suche/Kennzahlen | Aktuelle Liste, Status-/Abhol-/Lieferfilter                   | Nummernsuche hier; vollständige Historie, Zeit-/Kundensuche und Kennzahlen bleiben für Paket 3/4 offen     |

Empfohlene Reihenfolge nach B7: B1/B2 gemeinsam, danach B3/B4 gemeinsam, anschließend B5 mit dem
gemeinsamen Umfang aus Paket 4. Die bestehende Bestellstatusbearbeitung und Rechteprüfung werden
weiterverwendet. Die Rollen- und Einladungsverwaltung aus A1 ist dadurch nicht erledigt.

Alle aktuellen Arbeiten sind überprüfbare Codeentwürfe. Keine Live-Schaltung, kein Merge, keine
Wiederaufnahme eingefrorener Umgebungs- oder Geräteprüfungen.

Fortschreibung: B7 ist mit PR #14/CI #119 technisch geprüft. B1/B2 sind anschließend gemeinsam in
[Arbeitsblock 3.15](../work-blocks/3.15-realtime-order-alerts.md) implementiert; ihr technischer
Abschluss setzt die dort genannten finalen CI-Nachweise voraus. Die Ausgangsmatrix oben bleibt als
Bestandsaufnahme erhalten. Danach sind B3/B4 die nächste gebündelte Umsetzung; B5 folgt mit Paket 4.

Fortschreibung B3/B4: [Arbeitsblock 3.16](../work-blocks/3.16-location-operations-configuration.md)
führt Betriebsmodus und Standortkonfiguration gemeinsam als Entwurfs-PR #16 fort. Verbindlicher
Abschlussnachweis ist der finale CI-Head im PR/Projektprotokoll E06. B1/B2 sind mit PR #15/CI #123
technisch geprüft. Nach B3/B4 folgt B5 gemeinsam mit Paket 4; die historische Ausgangstabelle oben
beschreibt weiterhin den Zustand vor Paket 3.
