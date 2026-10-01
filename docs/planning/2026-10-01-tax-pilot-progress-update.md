# Fortschrittsabgleich: Steuer, Pilot und Geräte

Basis bleibt der positionsweise A2/V2-Abgleich aus Planungs-PR #9 und das belegte
[Menü-/Warenkorbdelta](2026-10-01-menu-cart-progress-update.md). Die frühere pauschale
84-%-Schätzung ist kein gültiger aktueller Fortschrittswert. Zwölf Hauptblöcke werden gleich
gewichtet; deren Unterpositionen zählen jeweils 0, 0,5 oder 1. Implementierung und praktische
Abnahme werden getrennt.

| Bereich                             | Neuer technischer Nachweis                                               | Verbleibende Grenze                                                          | Bewertung                       |
| ----------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------- |
| M7 / A2-3-4                         | Vollständiger Steuermechanismus, Liefergebühr, historische Header und UI | reale fachlich bestätigte Pilotdeklaration fehlt                             | A2-3-4 bleibt 0,5               |
| O6 / Pilotimport                    | realer Quellenparser, zwölf vorbereitete Artikel, geschützter Importweg  | bestätigte Konfiguration, tatsächlicher Staging-Import und Endparität fehlen | weiterhin teilweise offen       |
| Browserbedienung                    | Chromium, Firefox und WebKit, jeweils 390/1440 Pixel                     | echte iPhone-/Android-/Desktop-/assistive Prüfung fehlt                      | keine Geräteabnahme angerechnet |
| Restaurantbetrieb und übrige Pakete | in diesem Schnitt nicht verändert                                        | jeweilige Anforderungen aus bestehendem Audit                                | unverändert                     |

Der konservative technische Mittelwert bleibt **60,540675 %, gerundet 61 %**. Block 3 bleibt 6,5/8,
Block 4 bleibt 7,5/9; alle weiteren Blockwerte bleiben unverändert. Die zusätzliche Technik schließt
einen Implementierungsteil innerhalb einer bereits halb bewerteten Position. Ein kompletter A2-Punkt
darf deshalb noch nicht zusätzlich angerechnet werden. Es wurden reale Teilaufgaben abgeschlossen,
auch wenn die gerundete Gesamtzahl gleich bleibt.

Von den 23 nach PR #12 offenen/teiloffenen Umsetzungslücken ist M7 technisch geschlossen; 22 bleiben
offen oder teilweise offen. O6 darf trotz fertig programmiertem Importweg nicht als vollständig
abgenommen gelten. Quelle und Herkunft werden dokumentiert; Steuer-/Rezeptfreigaben, Stagingimport,
physische Geräte und Providerfälle bleiben offen. Eine Zählung technischer Lücken ist nicht
identisch mit den 82 einzeln bewerteten A2-Anforderungen.

Nächste unabhängige Gruppe: Paket 3 Restaurantbetrieb. Work / Sol / hoch. Kein Merge, kein
Deployment, keine Live-Schaltung. Endgültige Pflichtprüfungen und Nachweise stehen in PR #13.
