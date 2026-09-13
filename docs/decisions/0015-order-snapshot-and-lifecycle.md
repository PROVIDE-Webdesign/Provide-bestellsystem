# Bestell-Snapshot und Bestelllebenszyklus

## Status

Angenommen für Arbeitsblock 2.8.

## Entscheidung

Eine Bestellung wird beim Absenden als unveränderlicher fachlicher Snapshot gespeichert. Sie
referenziert weiterhin Restaurant, Standort, veröffentlichte Speisekartenversion, wirksame
Zeitplanversion und die atomar beanspruchte Kapazität. Zusätzlich kopiert sie die für die spätere
Abwicklung notwendigen Artikelbezeichnungen, Mengen und Preise. Nachträgliche Änderungen am
Speisekartenkatalog verändern deshalb keine bereits angenommene Bestellung.

`orders` enthält den Bestellkopf mit technischer Einreichungsreferenz, Erfüllungsart,
Wunschzeitpunkt, Währung, Summen und aktuellem Status. `order_lines` enthält ausschließlich die
unveränderlichen Positions-Snapshots. `order_status_events` bildet jede erfolgreiche Statusänderung
als geordneten, append-only Verlauf ab.

Dieser Arbeitsblock verarbeitet ausdrücklich keine Namen, E-Mail-Adressen, Telefonnummern,
Lieferadressen, Zahlungsdaten oder freien Kundenkommentare. Solche Daten benötigen vor einer
Einführung ein eigenes Datenminimierungs-, Aufbewahrungs- und Sicherheitskonzept.

## Einreichung und Idempotenz

Bestellungen entstehen ausschließlich über `private.submit_order`. Die Funktion normalisiert die
Positionsliste, sperrt den mandanten- und standortbezogenen Einreichungsschlüssel und behandelt eine
inhaltlich identische Wiederholung als Erfolg mit derselben Bestell-ID. Wird derselbe Schlüssel mit
anderen Daten wiederverwendet, schlägt der Vorgang geschlossen fehl.

Vor dem Schreiben prüft die Funktion:

1. Erfüllungsart, Einreichungsschlüssel, Positionsanzahl und Mengen.
2. Dass keine Artikelidentität doppelt vorkommt.
3. Dass genau die angegebene Speisekartenversion am Standort öffentlich wirksam ist.
4. Dass alle Positionen in dieser Version aktiv und am Standort verfügbar sind.
5. Dass die Bestellbarkeit und die benötigte Slot-Kapazität aus Arbeitsblock 2.7 weiterhin gegeben
   sind.

Kapazitätsreservierung, Bestellkopf, Positionen, erster Status und Outbox-Ereignis entstehen in
derselben Datenbanktransaktion. Schlägt ein Teilschritt fehl, bleibt keiner dieser Datensätze
zurück.

## Preise und Summen

Preise werden als ganzzahlige kleinste Währungseinheit gespeichert. Währung und Einzelpreise stammen
ausschließlich aus der veröffentlichten Speisekartenversion; der aufrufende Client darf sie nicht
vorgeben. Die Datenbank berechnet jede Positionssumme sowie die Gesamtmenge und Gesamtsumme.
Rabatte, Gutscheine, Liefergebühren, Steuernachweise und Trinkgeld gehören noch nicht zu diesem
Modell. Deshalb entspricht die Gesamtsumme in diesem Arbeitsblock der Artikelsumme.

## Statusmodell

Der kontrollierte Lebenszyklus lautet:

1. `submitted` → `accepted`, `rejected` oder `cancelled`
2. `accepted` → `preparing` oder `cancelled`
3. `preparing` → `ready` oder `cancelled`
4. `ready` → `completed`
5. `completed`, `rejected` und `cancelled` sind terminal

Statussprünge und unveränderte Wiederholungen werden abgewiesen. Ablehnung oder Stornierung erzeugt
in derselben Transaktion genau eine Gegenbuchung für die zuvor reservierte Kapazität. Alle
erfolgreichen Übergänge erzeugen einen Statusverlauf und ein minimiertes Outbox-Ereignis.

## Rollen und Sicherheit

1. Nur die serverseitige Service-Rolle darf die kontrollierten Funktionen ausführen.
2. Auch die Service-Rolle besitzt keine direkten Schreibrechte auf Bestellkopf, Positionen oder
   Statusverlauf.
3. Owner und Manager benötigen für Statusänderungen `aal2`; Manager bleiben auf zugewiesene
   Standorte beschränkt.
4. Kitchen darf mit `aal1` oder `aal2` ausschließlich an ausdrücklich zugewiesenen Standorten
   arbeiten.
5. Driver und Browserrollen dürfen den internen Küchenlebenszyklus nicht ändern.
6. RLS begrenzt Lesezugriffe auf aktive, rollen- und standortberechtigte Beschäftigte.
7. Restaurant-, Standort-, Menü-, Zeitplan- und Kapazitätsbeziehungen werden durch zusammengesetzte
   Fremdschlüssel gegen Mandantenvermischung abgesichert.

## Folgen

- Historische Positionen und Beträge bleiben trotz späterer Katalogänderungen nachvollziehbar.
- Wiederholte Übertragungen erzeugen weder doppelte Bestellungen noch doppelte Kapazitätsbelegung.
- Statusänderungen sind vollständig geordnet und revisionsfest nachvollziehbar.
- Ablehnung und Stornierung geben Kapazität kontrolliert frei.
- Nachgelagerte Küchen-, Benachrichtigungs- und Integrationsprozesse können die Outbox verwenden.

## Nicht Bestandteil

- Kundendaten, Lieferadresse, Freitext oder Zustimmungstexte
- Warenkorb- oder Checkout-Oberfläche
- Zahlung, Trinkgeld, Gutschein, Rabatt, Steuer- oder Rechnungslogik
- Liefergebiet, Lieferkosten oder Fahrerzuweisung
- Automatische Benachrichtigungen oder externe Integrationen
- Produktvarianten, Extras, Allergene und Zusatzstoffe
- Produktive Bestellungen, Preview-Rollout oder Änderung der Asian-Kitchen-Website
