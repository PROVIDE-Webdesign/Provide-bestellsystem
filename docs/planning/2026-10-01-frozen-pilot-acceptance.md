# Eingefrorene Pilot- und Gerätefälle

Nutzerentscheidung vom 01.10.2026: Die folgenden offenen Punkte ruhen bis der Nutzer wieder einen
Laptop hat. Sie gelten weiterhin als nicht abgenommen. Paket 3 Restaurantbetrieb kann unabhängig
davon entwickelt und automatisiert geprüft werden. Keine regelmäßigen Zugangsprüfungen, keine neuen
Testzahlungen und keine fingierten fachlichen oder praktischen Freigaben während der Pause.

Gesicherter Ausgangsstand: Entwurfs-PR #13, GitHub-Head `28df06157e823c8701f66ae37b849ed33656581b`,
identischer Implementierungsbaum `d63539a27d10cf65568cd880be64074c2527d7ca`, CI #104 mit allen fünf
Jobs erfolgreich. Lokal 281 erfolgreiche Unit-Tests; 27 pgTAP-Dateien mit 1157 erfolgreichen
Prüfungen; vollständiger synthetischer Zwölf-Gerichte-Import über HTTP/PostgreSQL geprüft. Kein
Merge oder Deployment.

| Fall                                  | Eingefrorener Stand                                                                                                                                                                       | Wiederaufnahmevoraussetzung                                                                                               | Gebündelter Abschluss                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| F01 Echte Restaurantdeklarationen     | Zwölf Quellgerichte mit Preisen und Varianten extrahiert; vollständige Rezept-/Allergen-/Zusatzstoff-/Steuerbestätigung fehlt. Reales Bundle bleibt importsperrend.                       | Laptop verfügbar und fachlich bestätigte Angaben des Restaurants vorhanden.                                               | Angaben vollständig eintragen, gegen Quelle und Auswahl prüfen; Herkunft und Bestätigung dokumentieren.                                   |
| F02 Externer Staging-Import           | Synthetisches Bundle vollständig importierbar. Externe Health-Endpunkte lieferten aus der Prüflaufzeit HTTP 403/1010; sichtbares Supabase-Projekt inaktiv und nicht eindeutig zugeordnet. | Laptop verfügbar; Ubuntu-Zugang bzw. eindeutig zugeordnetes, nutzbares Staging und tatsächliche MFA-Sitzung nachgewiesen. | Aktuellen Git-/Laufzeitstand prüfen; synthetischen Entwurf importieren und zurückvergleichen. Echte Daten erst nach F01 übernehmen.       |
| F03 Praktische Geräte-/Bedienabnahmen | Native Headless-Engines bestanden; physische iPhone-/Android-/Desktop-/assistive Prüfungen fehlen.                                                                                        | Laptop verfügbar, Staging erreichbar, benötigte Geräte und berechtigte Sitzung vorhanden.                                 | Gerätematrix pro Gerät mit Datum, Version, Szenario, Ergebnis und Beleg ausführen; Fehler korrigieren und betroffene Fälle erneut prüfen. |

Arbeitsdateien: `docs/pilot/asian-kitchen-12-0-r1-pending.json`,
`docs/pilot/asian-kitchen-staging-synthetic.json`, `docs/runbooks/order-tax-and-pilot-import.md`,
`docs/testing/device-acceptance-tax-pilot.md`. Die geschützte Websitequelle bleibt unverändert.

Wiederaufnahme erst nach Nutzerhinweis „Laptop wieder verfügbar“. Dann zuerst Arbeitsbaum,
Branch/Head, Prozesse, isolierte Datenbank, Staging-Zuordnung und MFA prüfen. Kein pauschaler
Neustart und kein Zurücksetzen vorhandener App-/Auth-Daten. Vorhandene Tests werden nur bei
geändertem Stand, Fehlern oder neuen Prüfanforderungen wiederholt. Vor einem erneuten Anbieterfall
vorhandene Aufträge/Zahlungen abgleichen, damit keine Duplikate entstehen.

Die Pause erzeugt keine Terminerinnerung und keine Freigabe für Merge, Deployment, echten Pilot,
Livezahlungen oder produktiven Checkout. Der Gesamtfortschritt bleibt zunächst 61 % über zwölf
A2-Hauptblöcke. Weitere technische Fortschritte in Paket 3 werden separat bewertet; F01–F03 bleiben
bis zu ihrem belegten Abschluss offen.
