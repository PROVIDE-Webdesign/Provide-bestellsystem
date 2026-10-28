# Bestelltexte im internen Asian-Kitchen-Piloten

Stand: 28.10.2026, Europe/Berlin. Folgeauftrag nach E101. Zuordnung: A2-10-1, A2-4-7, unterstützend
A2-8-2.

## Problem und Änderung

Die angeschlossene Pilotfassung speichert ausdrücklich abgesendete synthetische Bestellungen. Ihr
älterer Bestellbereich bezeichnete den Vorgang dennoch als unverbindliche Anfrage ohne
Speicherung/Versand und verwies auf WhatsApp/Telefon. Der aktive Abschlussbutton sprach außerdem von
einer zahlungspflichtigen Bestellung.

Die erzeugte Pilotseite benennt nun Testbestellung, Abholzeit, Bestellabschluss und Speicherung nach
dem Absenden. Sie verlangt erfundene Testdaten und stellt klar, dass keine echte
Restaurantbestellung oder Onlinezahlung stattfindet. Reservierung und Kontakt bleiben separate
Demos. Der Button heißt „Testbestellung absenden“; Abschluss- und Statusüberschriften bezeichnen den
Testauftrag ausdrücklich.

Die geschützte Original-HTML bleibt bytegleich. Der bestehende Assetbuild setzt die Pilottexte
ausschließlich in der erzeugten Fassung um und verweigert mehrdeutige oder fehlende
Ersetzungspunkte. Im Bridge-Modul ändern sich nur fünf Textliterale. Keine Preis-, Bestell-,
Status-, Zahlungs-, Auth-, Gateway- oder Sicherheitslogikänderung.

## Durchgeführte Prüfung

- Node 24.22.1: Assetbuild erfolgreich, 13 Vertragsmodule erzeugt.
- Vorhandene isolierte Vertrags-/Transporttests: 14 PASS, 0 FAIL.
- Syntaxprüfung des Bridge-Moduls erfolgreich.
- Vergleich der erzeugten alten/neuen Fassung: nur index.html und bridge.mjs ändern sich.
- Speisekarten-, Reservierungs- und Kontaktabschnitt sowie sämtliche eingebetteten Skripte bleiben
  identisch; der Original-HTML-Hash bleibt
  20feee61f68711da0ffb938ff0752da8a65cb74f7c6363df3cb4cb90c2cbc3bc.
- Die alten widersprüchlichen Haupttexte fehlen im erzeugten Bestellbereich; Speicherung, Testdaten
  und eingeschränkter Pilotumfang sind dort benannt.

## Bindung und Grenzen

Ausgangsbranch: codex/pilot-20261028. Ausgangscommit: bb082c5be985426e3b3f5b1100c4d87767df9a60.
Ausgangstree: 6c387307d0e0014f3a2fc603a66516e90e86cd16. Alle 67 Dateien des lokalen Quellausschnitts
stimmen mit den entsprechenden Blobs des frisch gelesenen vollständigen Remote-Trees überein. Kein
vollständiger lokaler Klon.

Keine neue Bestellung, Menüanlage, externe Browserprüfung oder Datenbankänderung. Lokale visuelle
Browserprüfung NOT_RUN: Playwright-Paket vorhanden, Browserlaufzeit nicht installiert. Keine neue
vollständige check/database-/Browsermatrix ausgeführt. E101s gezielte Pilotpriorität und alle
bestehenden Pausen bleiben erhalten.

Der Änderungsvorschlag wird auf einem eigenen Reviewbranch gesichert. Kein PR nach main, kein
Ready-/Retarget-/Mergewechsel und keine Fortschrittsneubewertung. Der bestehende Pilotbranch bleibt
unverändert, bis die separate Veröffentlichung genehmigt ist. Dessen Änderung löst automatisch den
bestehenden Cloudflare-Build aus; eine erfolgreiche Auslieferung wird erst nach einem tatsächlichen
Buildbeleg behauptet.
