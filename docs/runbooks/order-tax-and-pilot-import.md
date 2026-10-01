# Steueraufteilung, Pilotdaten und praktische Abnahme

## Technischer Prüflauf

Migration `20261001024454_order_tax_and_pilot_import.sql` nur in der isolierten Prüfdatenbank
anwenden. Die bestehenden Runtime-Schalter bleiben unverändert und deaktiviert. Menüverwaltung
benötigt verifizierten Login, AAL2 und Owner-/Standortmanagerrechte. Es gibt keine neue Browser-
Datenbankfreigabe und keinen direkten Zugriff auf die private Liefersteuerdeklaration.

1. `pnpm check`: gemeinsame Verträge, 280 Unit-Tests, Typen, Lint, Format und Builds.
2. CI-Datenbankjob: alle Migrationen, komplette pgTAP-Suite, Security Advisors und reale
   HTTP/PostgreSQL-Integration. Neue Fälle liegen in `0027_order_tax_and_pilot_import.test.sql`.
3. CI-Browsermatrix: Chromium, Firefox, WebKit, je 1440×1000 und 390×844. Auswahl, Warenkorb,
   Neuquote, Bestätigung, Konflikt, Ablauf, Editor, Steueranzeige, Liefersteuerbestätigung,
   gesperrte Vorschau und atomarer Entwurfsimport werden geprüft. Screenshots sind Run-Artefakte.

Die synthetische Mischposition enthält 1450 Cent bei Testsatz 700 und 50 Cent bei Testsatz 1900: 103
Cent Steuer. Mit 450 Cent Liefergebühr bei Testsatz 1900 ergeben sich 1950 Cent brutto, 175 Cent
Steuer und 1775 Cent netto. Diese Werte sind Testfälle, keine Pilot-Steuerfreigabe.

## Reproduzierbarer Quellenabgleich

Quelle: `Asian_Kitchen_Arbeitsblock_12_0_R1.html`, SHA256
`f4bd1c373498c78e5fdaf93575fed8d40feb1d5b68d5794241a2c729ab4739ca`. Der Parser liest
HTML-Strukturen, führt keine eingebetteten Skripte aus und übernimmt keine Kontakte. Mit der
unveränderten Quelle lokal ausführen:

```bash
python3 scripts/extract-asian-kitchen-menu.py /pfad/Asian_Kitchen_Arbeitsblock_12_0_R1.html /tmp/asian-kitchen-pending.json
python3 scripts/test-pilot-extraction.py /pfad/Asian_Kitchen_Arbeitsblock_12_0_R1.html docs/pilot/asian-kitchen-12-0-r1-pending.json
```

Der Vergleich prüft den gesamten Extraktionsinhalt: zwölf Artikel, drei Kategorien, Reihenfolge,
Beschreibungen, Centpreise, Varianten und ausdrücklich offene Angaben. Bei Varianten wird der
niedrigste Quellenpreis Grundpreis; die übrigen Preise ergeben sich aus dessen Aufpreisen. Gyoza:
Gemüse 750 Cent, Hähnchen +40 Cent. Thai Green Curry: Tofu 1690 Cent, Hähnchen +100 Cent, Ente +300
Cent. Die Vorschau kennzeichnet deshalb Grundpreise mit „ab“.

## Fachliche Ergänzung und Import

Bundleformat: `provide-menu-import-v1`, `source {name, sha256}`, `sections`, `items`. Die Datei
`docs/pilot/asian-kitchen-12-0-r1-pending.json` besitzt zusätzlich `pendingDeclarations` als
Arbeitsliste; diese wird bei der UI-Vorschau nicht als fertige Konfiguration übernommen. Jede aktive
`items[].configuration` muss separat vollständig ergänzt werden:

- `schemaVersion: 1`, `informationConfirmed: true` erst nach fachlicher Prüfung.
- `taxRateBasisPoints`: ausdrücklich bestätigter Produktsatz in Basispunkten, keine Standardannahme.
- `allergens` und `additives`: geprüfte vollständige Listen; `[]` bedeutet bestätigt keine Angaben,
  nicht unbekannt. Quellen-Allergencodes sind Hinweise zur Rezeptprüfung, keine automatische
  Freigabe.
- `variants`: IDs, Namen, aktive Auswahl und Aufpreise; `optionGroups`: Auswahlgrenzen und Extras.
  Optionaler `taxRateBasisPoints` an einer Auswahl gilt ausschließlich für ihren Aufpreis; weglassen
  bedeutet erben. `null` wird abgewiesen.

Quellcodes: 1 Gluten, 2 Krebstiere, 3 Eier, 4 Fisch, 5 Erdnüsse, 6 Soja, 7 Milch, 11 Sesam.
Rezeptbestandteile, Varianten und Extras müssen vom Restaurant bestätigt werden. Die Quelle verweist
für weitere Allergene/Zusatzstoffe auf das Serviceteam; sie belegt keine vollständige Deklaration.

Im geschützten Menüeditor gewünschtes Menü wählen, Datei (maximal 512 KiB) laden und die Vorschau
prüfen. Fehlende Konfiguration sperrt die Übernahme auch serverseitig. Eine geprüfte Datei wird
bewusst als **neuer unveröffentlichter Entwurf** übernommen. Danach Kategorien, Reihenfolge, alle
Variantenpreise und Deklarationen gegen die Quelle vergleichen, Änderungen prüfen und
Veröffentlichung erst im ausdrücklich freigegebenen Staging-Betrieb durchführen. Ein Quellhash
belegt Herkunftsangabe; die fachliche Freigabe bleibt separat erforderlich.

Eine bestätigte Liefersteuerregel wird bei bereits vorhandener Lieferregel im Editor gesetzt. Fester
Satz benötigt Rate; proportionale Regel benötigt vollständige Artikelsätze. Notiz und
Bestätigungsfeld sind Pflicht. Eine Änderung erstellt eine neue Regel und verhindert stilles
Übernehmen einer alten Quote. Alte Bestellungssummen werden nicht neu gerechnet.

## Praktische Abnahme und offene Grenzen

Die [Gerätematrix](../testing/device-acceptance-tax-pilot.md) dokumentiert noch ausstehende echte
Prüfungen. Headless-WebKit ist kein Nachweis für iPhone-Safari; Chromium ist keine Android-/Edge-
Geräteabnahme. Browserfixtures ersetzen keine echte Sitzung oder Restaurantfreigabe.

Keine Live-Schaltung, keine produktiven Restaurantbestellungen, kein Merge und kein Deployment
wurden durch diesen Arbeitsblock ausgeführt. Der tatsächliche Pilotimport wartet auf bestätigte
Fachdaten; die Quellparität ist vorbereitet, die Staging-Endabnahme bleibt offen.
