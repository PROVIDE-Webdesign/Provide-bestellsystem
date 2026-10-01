# Fortschrittsdelta: Menüpflege bis Warenkorb

Basis: A2/V2/E01, Fortschrittsabgleich und 29-Lücken-Audit vom 01.10.2026 in Planungs-PR #9. Dieses
Delta verändert ausschließlich die unten belegten Positionen; der vollständige alte Abgleich bleibt
als historischer Ausgangsstand erhalten. Prozentwerte messen technische Umsetzung, keine
Produktionsreife oder vollständige praktische Abnahme.

## Bedingung und Berechnung

Technischer Nachweis: Check, Datenbank und Browser von
[CI #97](https://github.com/PROVIDE-Webdesign/Provide-bestellsystem/actions/runs/36803396177) sind
gemeinsam erfolgreich. Der abschließende Dokumentationscommit wird im PR erneut geprüft.

| Position | Bisher | Danach | Neuer Nachweis                                                                      |
| -------- | -----: | -----: | ----------------------------------------------------------------------------------- |
| A2-3-3   |    0,5 |      1 | Varianten-/Extrasbedienung und vollständige Gateway-/Checkoutweitergabe             |
| A2-3-5   |    0,5 |      1 | Befristete Artikel-/Varianten-/Optionsstopps in Katalog und finaler Preisprüfung    |
| A2-3-6   |      0 |      1 | Verifizierter Editor, Entwurf, Konfliktprüfung, Vorschau, Veröffentlichung/Rollback |
| A2-3-8   |    0,5 |      1 | Server-Neuprüfung und ausdrückliche Kundenbestätigung                               |
| A2-4-7   |    0,5 |      1 | Verständliche Neuquote und Auswahlbedienung                                         |
| A2-4-8   |      0 |      1 | Begrenzter standortgebundener 24-Stunden-Speicher mit erneuter Prüfung              |

Block 3: 4/8 → 6,5/8 = 81,25 %. Block 4: 6/9 → 7,5/9 = 83,333333 %. Der Mittelwert der zwölf Blöcke
steigt von 56,547619 % um `(2,5/8 + 1,5/9) / 12 × 100` auf **60,540675 %, gerundet 61 %**. Alle
anderen Blockwerte bleiben unverändert. A2-3-4 bleibt 0,5: die Deklarationsanzeige ist
angeschlossen, aber reale Pilotwerte und vollständige Steuerdeklaration sind noch offen.

## Abgleich der Umsetzungslücken

M1–M6 sind technisch geschlossen. Von 29 gruppierten Umsetzungslücken bleiben 23 offen oder
teilweise offen. M7 und O6 werden ausdrücklich weitergeführt. Browserprüfungen verwenden
synthetische Daten; sie ersetzen keine reale Geräte-, Login-, Provider- oder Restaurantabnahme. Die
vollständigen Pflichtprüfungen sind für den Implementierungsstand bestanden.

Nächste empfohlene Gruppe: Paket 3 Restaurantbetrieb. Modus Work / Sol / hoch.
