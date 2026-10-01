# Gerätematrix: Menü, Warenkorb, Steuer und Pilot

Stand: 01.10.2026. Automatisierte Browserläufe und praktische Geräteabnahmen werden separat
bewertet.

| Umgebung                           | Automatischer Nachweis                                    | Praktische Abnahme                     |
| ---------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| Chromium/Linux, 390 und 1440 Pixel | CI-Browsermatrix, Komponenten mit synthetischen Antworten | kein Android- oder Edge-Gerätenachweis |
| Firefox/Linux, 390 und 1440 Pixel  | CI-Browsermatrix, Komponenten mit synthetischen Antworten | echte Desktop-Sitzung offen            |
| WebKit/Linux, 390 und 1440 Pixel   | CI-Browsermatrix, Komponenten mit synthetischen Antworten | iPhone-/macOS-Safari offen             |
| iPhone/iOS/Safari                  | noch keiner auf dem echten Gerät                          | offen                                  |
| Android/Chrome                     | noch keiner auf dem echten Gerät                          | offen                                  |
| Desktop/Chrome, Edge, Firefox      | vollständige Plattform-/Sitzungsprüfung ausstehend        | offen                                  |
| Tastatur, NVDA bzw. VoiceOver      | praktische Bedienprüfung ausstehend                       | offen                                  |

## Ein gebündelter Durchlauf je echtem Gerät

Voraussetzungen: erreichbare freigegebene Staging-URL, vollständig deklariertes synthetisches
Testbundle, synthetischer Gastkontakt und Testzahlung. Dafür steht
`docs/pilot/asian-kitchen-staging-synthetic.json` bereit. Echte Rezeptbestätigungen sind für diesen
synthetischen Durchlauf nicht nötig; sie bleiben Voraussetzung für einen späteren echten Pilot.
Keine echten Kunden- oder Live-Zahlungsdaten verwenden.

1. Alle zwölf Pilotgerichte/Kategorien, Variantenpreise und Deklarationen vergleichen; Auswahl- und
   Pflichtgrenzen, Artikel-/Auswahlstopp und Freigabe prüfen.
2. Abholwarenkorb erstellen, Seite neu laden, Namen und aktuelle Preise prüfen. Zum festgelegten
   Testtermin Quote bewusst bestätigen. Gemischte Steuern und Summen müssen auf kleinem Bildschirm
   lesbar sein; bei unvollständigen Testdeklarationen muss der unbekannte Anteil erkennbar bleiben.
3. Lieferadresse/Postleitzahl, Gebiet, Mindestwert und Gebühr testen. Warenkorbquote, gespeicherten
   Auftrag und Restaurantdetails centgenau vergleichen. Eine geänderte Liefersteuerregel verlangt
   erneut bestätigte Quote; bereits gespeicherter Auftrag behält seinen alten Steuerstand.
4. Menüänderung und abgelaufenen Warenkorb testen. Ein Preiswechsel darf keine stillschweigende
   Bestellung erzeugen. Doppelte Abgabe bzw. Verbindungsunterbrechung darf keinen Doppelauftrag
   erzeugen.
5. Im Restaurant mit tatsächlicher MFA-Sitzung Importvorschau, fehlende Angaben, neuen Entwurf,
   Vorschau, Veröffentlichung und Rollback prüfen. Rechte eines fremden Standorts sowie Küche müssen
   die Menüpflege sperren. Steuerangaben im Gaststatus dürfen keine Kontaktdaten offenlegen.
6. Hoch-/Querformat, Zoom, lange Artikelnamen, Bildschirmtastatur, Fokusfolge und Screenreader
   prüfen. Audioalarm/Realtime werden im separaten Restaurantbetriebspaket abgenommen.

## Ergebnisbogen

Pro Durchlauf erfassen: Staging-URL, Git-Head, Datum/Uhrzeit, Prüfer, Gerät/Modell, OS-Version,
Browser/Version, Szenarionummer, erwartet, tatsächlich, bestanden/fehlgeschlagen,
Fehler-/Screenshot- Referenz. Ein offener oder fehlgeschlagener Fall wird nicht als bestanden
markiert. Keine Übertragung früherer Website- oder Urlaubssystemabnahmen auf das Bestellsystem.

Aktuell fehlen tatsächlicher Gerätezugriff, ein nutzbarer Staging-Zugang und die vollständige
Staging-Endabnahme. Die dokumentierten Health-Endpunkte lieferten bei der Zugangsprüfung am
01.10.2026 aus der Prüflaufzeit HTTP 403 / Code 1010. Echte Pilotdeklarationen bleiben separat
offen. Diese Matrix ist vorbereitet; sie enthält keine erfundenen Ausführungsnachweise.
