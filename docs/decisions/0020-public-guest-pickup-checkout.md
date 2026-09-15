# Öffentlicher Gast-Checkout für Abholung

## Status

Angenommen für Arbeitsblock 3.3.

## Entscheidung

Der erste öffentliche Bestelleingang ist auf Gastbestellungen zur Abholung beschränkt. Der Client
sendet ausschließlich Speisekarten- und Versionskennung, Artikelkennungen mit Mengen,
Abholzeitpunkt, einen Idempotenzschlüssel, minimalen Bestellkontakt und die Version des angezeigten
Datenschutzhinweises. Preise, Währung, Zahlungsmodus, Auswertungszeitpunkt und Aufbewahrungsgrenze
werden nicht vom Browser bestimmt.

`private.submit_public_guest_pickup_order` löst Restaurant und Standort über die öffentlich
sichtbaren Slugs auf und verwendet danach die bestehenden transaktionalen Grenzen für Bestellung,
Kapazität, Zahlungsanforderung und Gastdaten. Der Zahlungsmodus ist fest `on_fulfillment`; ein
Lieferdatensatz kann nicht entstehen. Der Aufbewahrungszeitpunkt wird aus dem unveränderlichen
Erstellungszeitpunkt der Bestellung berechnet. Dadurch bleibt eine identische Wiederholung auch nach
einem verlorenen HTTP-Ergebnis idempotent.

## HTTP- und Laufzeitgrenze

Der öffentliche Endpunkt lautet `POST /v1/storefront/{restaurantSlug}/{locationSlug}/orders`. Er
akzeptiert nur UTF-8-JSON bis 64 KiB und eine explizite Feld-Allowlist. Der Schreibweg verweigert
Anfragen, solange nicht alle folgenden Einstellungen gültig sind:

1. `CHECKOUT_WRITE_ENABLED=true`
2. geprüfte Hyperdrive-Konfiguration ohne Cache
3. `CHECKOUT_PRIVACY_NOTICE_VERSION`
4. `CHECKOUT_RETENTION_DAYS` zwischen 1 und 730

Die Repository- und Preview-Vorgaben lassen `CHECKOUT_WRITE_ENABLED` standardmäßig auf `false`. Eine
spätere Aktivierung benötigt das eigene Preview-/Produktions-Gate.

## Sicherheit und Datenschutz

1. Der Browser erhält keine direkten SQL- oder Tabellenrechte.
2. Preise und Verfügbarkeit werden in derselben Transaktion erneut serverseitig geprüft.
3. Der Idempotenzschlüssel verhindert doppelte Bestellungen bei Übertragungswiederholungen.
4. Personenbezogene Werte erscheinen weder in URLs noch in Logs oder Outbox-Payloads.
5. Die Storefront speichert Kontaktdaten nicht dauerhaft im Browser.
6. Fehlerantworten enthalten keine internen IDs, Kapazitätswerte oder Datenbankdetails.
7. Unbekannte, inaktive oder mandantenfremde Bereiche werden geschlossen abgewiesen.

## Nicht Bestandteil

1. Lieferung, Liefergebiet und Liefergebühr
2. Onlinezahlung oder Zahlungsanbieter
3. Öffentliche Bestellstatusabfrage
4. Restaurant-Dashboard, Benachrichtigung oder externer Integrationsadapter
5. echte Kunden- oder Zahlungsdaten
6. Preview- oder Produktionsaktivierung
7. Änderungen am getrennten Asian-Kitchen-Projekt
