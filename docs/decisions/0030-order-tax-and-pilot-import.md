# ADR0030: Steueraufteilung und geprüfter Menüimport

Status: umgesetzt im Entwurfs-PR #13; keine Laufzeitaktivierung. Datum: 01.10.2026.

## Entscheidung

Bruttopreise werden ausschließlich serverseitig bepreist. Jede konfigurierte Bestellposition
speichert Grundpreis, Variantenaufpreis und ausgewählte Extras mit Bruttobetrag, explizitem
Steuersatz und Steueranteil. Auswahlaufpreise erben den Produktsatz, solange kein eigener Satz für
genau diesen Aufpreis bestätigt ist. Fehlende Angaben werden niemals als 0 % interpretiert.

Inklusive Steuer wird mit ganzzahliger bzw. exakter numerischer Arithmetik kaufmännisch auf Cent
**je Bestellposition und Steuersatz** gerundet. Die Steuer wird dann nach größten Nachkommaresten
auf Komponenten verteilt; bei Gleichstand entscheidet deren feste Reihenfolge. Damit bleiben
bestehende Positionen mit einem einzigen Satz auch bei mehreren Auswahlen centgleich. Buckets
summieren die gerundeten Positionsanteile, nicht eine neue Rundung über die gesamte Bestellung.

Die Liefergebühr erhält eine ausdrücklich bestätigte Regel: eigener fester Satz oder Verteilung nach
den Bruttoanteilen der deklarierten Artikelsätze. Bei proportionaler Verteilung werden alle
Gebührencents nach größten Resten zugeteilt; Satz aufsteigend entscheidet Gleichstände. Sobald
Artikeldeklarationen fehlen, bleibt die proportionale Gebühr undeklariert. Nullgebühren benötigen
keinen geratenen Satz. Diese technischen Verfahren legen keine fachlich zutreffenden Steuersätze
fest.

Jede Änderung der Liefersteuer erzeugt eine neue Lieferregel mit denselben Zonen. Alte Regeln und
Bestellungen bleiben unveränderlich; offene Lieferquotes müssen die neue Regel bestätigen. Der
vollständige Auftragssnapshot enthält Artikelbrutto, Rabatt (derzeit 0), Liefergebühr, Gesamtbrutto,
bestätigtes Netto, Steuer nach Satz und undeklariertes Brutto. Er entsteht innerhalb des
Bestell-INSERTs und wird im Warenkorb, Gaststatus und berechtigten Dashboard angezeigt. Historische
Aufträge ohne Snapshot bleiben unbekannt; es gibt keine rückwirkende Berechnung. Die Anzeige ersetzt
keinen Kassenbeleg und erweitert den vereinbarten Umfang nicht um Fiskalisierung.

## Pilotimport

JSON wird begrenzt und mit dem gemeinsamen Menüvertrag geprüft. Eine Vorschau darf unvollständige
Quelldaten enthalten; aktive Artikel dürfen nur mit bestätigter Produkt-, Auswahl-, Allergen-,
Zusatzstoff- und Steuerkonfiguration importiert werden. Owner bzw. zugewiesene Standortmanager
benötigen AAL2. Der Server legt und füllt einen neuen Entwurf atomar an, protokolliert Quelle,
Quellhash, Version und Akteur und veröffentlicht ihn niemals automatisch.

Der Quellhash bezeichnet die deklarierte Herkunft, nicht eine kryptographische Authentifizierung der
Datei durch den Restaurantbetrieb. UI-Artikel erhalten beim Import neue IDs. Veröffentlichung,
Vorschau, Revisionen, Stopps und Rollback verwenden die bestehende gesicherte Menüverwaltung.

Asian Kitchen 12.0 R1 liefert zwölf Gerichte und drei Kategorien. Quellpreise und Varianten sind
reproduzierbar übernommen; Steuersätze, vollständige Zusatzstoff- und Rezeptdeklarationen sind nicht
vorhanden. Das vorbereitete Bundle bleibt deshalb gesperrt. Diese Daten werden weder als synthetisch
erfunden noch als fachlich freigegeben ausgegeben.

## Nachweis und Grenzen

Gemeinsame Vertrags-, pgTAP-, HTTP/PostgreSQL- und Browserprüfungen decken Mischung, Rundung,
Unbekanntstatus, Importgrenzen, Rechte, Revisionskonflikte und historische Unveränderlichkeit ab.
Chromium, Firefox und WebKit laufen jeweils bei 390 und 1440 Pixeln. Reale Geräte, Betriebssysteme,
assistive Technik, tatsächliche MFA-Sitzungen und Providerabnahmen bleiben eigene Nachweise.
Details: [Runbook](../runbooks/order-tax-and-pilot-import.md) und
[Arbeitsprotokoll](../work-blocks/3.13-tax-pilot-acceptance.md).
