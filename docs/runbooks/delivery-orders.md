# Lieferbestellungen: Testbetrieb und Betriebsgrenzen

## Voraussetzungen

Arbeitsblock 3.8 bleibt ohne `DELIVERY_ORDERING_ENABLED=true` geschlossen. Für die Übermittlung
gelten zusätzlich die bisherigen Checkout-, Status-, Geheimnis- und Hyperdrive-Gates. Auf
Restaurantebene müssen `fulfillment.delivery`, Bestellannahme und Go-live-Voraussetzungen erfüllt
sein. Ein veröffentlichter Lieferzeitplan und freie Kapazität sind erforderlich.

Alle hier beschriebenen Aufrufe sind zunächst ausschließlich für isolierte synthetische Testdaten
vorgesehen. Dieses Dokument aktiviert weder Preview noch Produktion.

## Lieferregeln pflegen

Die Service-Rolle darf `private.create_delivery_policy(actor, aal, restaurant, location, zones)` und
`private.publish_delivery_policy(actor, aal, restaurant, location, policy)` ausführen. Beide
Funktionen prüfen Owner/Manager, AAL2 und Standortzuordnung. Browserrollen und die Service-Rolle
besitzen keine direkten Tabellen-Schreibrechte. Änderungen benötigen einen neuen Entwurf;
Zurückwechseln erfolgt durch erneute Veröffentlichung einer vorhandenen Version.

Beispiel einer synthetischen Zonenkonfiguration:

```json
[
  { "postalCodes": ["52062"], "minimumAmountMinor": 2500, "feeAmountMinor": 350 },
  { "postalCodes": ["52064"], "minimumAmountMinor": 3000, "feeAmountMinor": 0 }
]
```

Die Gebiete umfassen jeweils die vollständige PLZ. Straße, Hausnummer, Fahrzeit und tatsächliche
Zustellbarkeit werden nicht verifiziert. Teilgebiete einer PLZ sind mit dieser Konfiguration nicht
darstellbar. Die PLZ wird als Zeichenfolge einschließlich möglicher führender Nullen gespeichert.

## API und Oberfläche

POST `/v1/storefront/{restaurant}/{location}/delivery-quote` berechnet eine nicht reservierende
Preisübersicht. POST auf `delivery-orders` verlangt Lieferadresse und exakt diese `expectedQuote`.
Adressen und PLZ werden im Request-Body übertragen, nicht als URL-Parameter. Antworten tragen
`no-store`. Die Website fragt nach einer Änderung von Warenkorb, Lieferzeit oder PLZ erneut an. Bei
geändertem Preis oder Gebiet wird die Bestellübermittlung abgewiesen und erneut bestätigt. Bei einer
unklaren Netzwerkantwort bleibt der Übermittlungsschlüssel für einen identischen Retry erhalten.
Eingaben werden während der laufenden Übermittlung gesperrt.

Das Dashboard filtert serverseitig nach `fulfillmentType=pickup|delivery`. Die Küche sieht Gerichte,
Zeit und Status; berechtigte Leitung erhält zusätzlich die Adresse und Telefonnummer. `ready`
bedeutet zur Auslieferung bereit, `completed` wird von der Leitung nach der Zustellung bestätigt.
Die öffentliche Statusansicht enthält keine Lieferadresse. Der SMS-Adapter bleibt synthetisch und
der Versand deaktiviert.

## Nachweise und Rücknahme

`pnpm check` prüft Verträge, Worker, Oberflächen und Abholregressionen. `supabase test db` prüft
Gebiete, Rollen, Preise, Wiederholungen und atomare Fehlerfälle. Der bestehende CI-Integrationstest
prüft zusätzlich zwei konkurrierende Lieferbestellungen auf den letzten freien Platz, Gebühren im
Zahlungsnachweis, Lieferstatus, synthetische Benachrichtigung und die Adressbereinigung.

Bei Problemen zuerst den Liefer-Feature-Schalter deaktivieren; bestehende Bestellungen bleiben zur
Bearbeitung sichtbar. Veröffentlichte Regeln, Bestellsnapshots und Migrationen nicht rückwirkend
umschreiben. Eine Korrektur erfolgt durch eine neue Version oder Vorwärtsmigration. Eine unklare
Bestellantwort nie durch einen neuen Schlüssel automatisch wiederholen.
