# Gast-Checkout und personenbezogene Bestelldaten

## Status

Angenommen für Arbeitsblock 2.10.

## Entscheidung

Der MVP verwendet einen Gast-Checkout ohne Kundenkonto. Personenbezogene Angaben werden nicht in den
operativen Tabellen `orders`, `order_lines`, Zahlungsdatensätzen oder Outbox-Payloads gespeichert.
Stattdessen trennt PROVIDE zwei zweckgebundene Schutzzonen:

1. `order_customer_contacts` enthält den Bestellkontakt für Owner und Manager.
2. `order_delivery_details` enthält nur die für die Übergabe einer Lieferbestellung nötigen Angaben
   und ist zusätzlich für zugewiesene Fahrer lesbar.

Küchenpersonal erhält auf beide Bereiche keinen Zugriff. Fahrer sehen weder E-Mail-Adresse noch den
allgemeinen Bestellkontakt. Für Abholbestellungen entsteht kein Lieferdatensatz.

## Datensparsamkeit

Der kontrollierte Eingang akzeptiert ausschließlich:

1. Kontaktname
2. Telefonnummer im E.164-Format
3. optionale E-Mail-Adresse
4. Version des angezeigten Datenschutzhinweises
5. bei Lieferung: Empfängername und Telefonnummer aus dem Bestellkontakt sowie Anschrift,
   Postleitzahl, Ort und Ländercode

Unbekannte JSON-Felder werden abgewiesen. Freitext für Lieferhinweise, Geburtsdatum, Kundenkonto,
Marketingeinwilligung, Zahlungsinstrumente, Standortkoordinaten und Anbieter-Payloads gehören nicht
zu diesem Arbeitsblock.

Die Version des Datenschutzhinweises dokumentiert, welche Information im Checkout angezeigt wurde.
Sie wird nicht als freiwillige Marketingeinwilligung interpretiert. Die Verarbeitung des
Bestellkontakts bleibt an den Bestellzweck gebunden.

## Kontrollierter Eingang und Wiederholungen

`private.submit_guest_order` verbindet die bestehende Bestell- und Zahlungsgrenze mit dem
personenbezogenen Snapshot in einer Datenbanktransaktion. Ein Fehler in einem Teil rollt die gesamte
Einreichung zurück. Der Browser darf die Funktion nicht direkt ausführen.

`private.store_guest_checkout_snapshot` ist ein interner Baustein und besitzt für Browser- sowie
Service-Rollen keine Ausführungsfreigabe. Eine identische Wiederholung liefert dieselbe Bestellung.
Abweichende Kontaktdaten, Lieferdaten, Datenschutzhinweis-Versionen oder Aufbewahrungszeitpunkte
unter derselben Bestellung werden abgewiesen.

Die ältere interne Bestellgrenze bleibt für bestehende Datenbanktests und zukünftige ausdrücklich
personenfreie Systemabläufe bestehen. Der spätere öffentliche Gast-Checkout muss ausschließlich
`private.submit_guest_order` verwenden.

## Unveränderlichkeit und Löschung

Aktive personenbezogene Snapshots sind unveränderlich und können nicht direkt gelöscht werden.
Dadurch lassen sich Kontaktdaten nicht unbemerkt einer bereits eingereichten Bestellung
unterschieben. Der serverseitig festgelegte Aufbewahrungszeitpunkt muss nach der Bestellung liegen
und darf höchstens 730 Tage nach ihrer Erstellung liegen. Diese Obergrenze ist eine technische
Sicherheitsgrenze und keine rechtliche Empfehlung für die tatsächliche Aufbewahrungsdauer.

`private.purge_expired_guest_checkout_data` verarbeitet höchstens 5.000 Datensätze pro Aufruf und
entfernt personenbezogene Werte nur, wenn:

1. der festgelegte Aufbewahrungszeitpunkt erreicht ist und
2. die Bestellung `completed`, `rejected` oder `cancelled` ist.

Der technische Bestell-, Zahlungs- und Ereignisnachweis bleibt erhalten. Nach der Löschung sind die
personenbezogenen Zeilen über RLS nicht mehr sichtbar. Laufende Bestellungen werden auch bei
erreichtem Aufbewahrungszeitpunkt nicht bereinigt.

## Rechte

1. `anon` und `authenticated` können weder Bestellungen mit personenbezogenen Daten direkt anlegen
   noch persönliche Datensätze schreiben.
2. Die Service-Rolle kann nur `private.submit_guest_order` und die begrenzte Löschfunktion
   ausführen.
3. Die Service-Rolle besitzt keinen direkten Lese- oder Schreibzugriff auf die personenbezogenen
   Tabellen.
4. Aktive Owner und Manager lesen Bestellkontakte nur innerhalb ihrer Standortgrenze.
5. Aktive Fahrer lesen ausschließlich Lieferdetails zu zugewiesenen Standorten.
6. Küchenpersonal und fremde Mandanten sehen keine personenbezogenen Bestelldaten.

## Folgen

1. Der spätere API-Checkout erhält eine einzelne transaktionale Eingangsgrenze.
2. Personenbezogene Werte bleiben aus operativen Bestell-, Zahlungs- und Outbox-Daten heraus.
3. Abholung und Lieferung speichern unterschiedliche, zweckgebundene Datenmengen.
4. Aufbewahrung und kontrollierte Bereinigung sind technisch prüfbar und wiederholbar.
5. Echte Kundendaten bleiben bis zu einem eigenen Datenschutz-, API- und Preview-Gate gesperrt.

## Nicht Bestandteil

1. Öffentliche Checkout-API oder Storefront-Formulare
2. E-Mail-, SMS- oder WhatsApp-Benachrichtigungen
3. Kundenkonten, Adressbücher oder Bestellhistorien für Gäste
4. Liefergebiete, Routenplanung oder Geocoding
5. Marketing, Tracking oder Analyse personenbezogener Daten
6. Auskunftsportal, Export oder fallbezogene Löschanträge
7. Auswahl einer rechtlichen Aufbewahrungsfrist für den Produktivbetrieb
8. Echte Kundendaten, Livezahlungen, Preview-Rollout oder Änderungen an der Asian-Kitchen-Website
