# Lieferadressprüfung und Geokoordinaten

Bestellsystem 19 · Zusatzpaket nach E175 · A2-4-4

## Verhalten

Die geschützte Warenkorbprüfung verwendet bei Lieferung die vollständige deutsche Lieferadresse. Der
Server validiert Straße, Hausnummer, PLZ und Ort über den in A2 vorgesehenen Google-Adapter. Der
Adapter gibt intern die normalisierte Anschrift und Koordinaten zurück. Er verlangt bestätigte
Straße und Hausnummer sowie Gebäudepräzision der Prüfung und Geokoordinaten. Geänderte PLZ oder
Länder und Antworten, die eine Bestätigung oder Korrektur erfordern, führen zu einer
Korrekturmeldung. Nur die mit der Eingabe übereinstimmende bestätigte PLZ geht in die bestehende
Standortprüfung ein.

Die veröffentlichten PLZ-Gebiete, Mindestwerte, Gebühren und Zeitregeln der Datenbank entscheiden
weiterhin. Die Koordinaten belegen die Adressauflösung. Eine Routen- oder Teil-PLZ-Prüfung ist eine
eigene Anforderung. Wenn die Datenbank keine lieferbare Kombination bestätigt, zeigt der Shop den
gemeinsamen Fehler für Liefergebiet, Warenkorb und Termin.

Die Preisbestätigung ist an die eingegebene Adresse gebunden. Beim Absenden wird vor der Erstellung
einer neuen Lieferbestellung erneut validiert, bei Zahlung vor Ort und beim Onlinezahlungsweg.
Bereits bestätigte Wiederholungen lesen den bestehenden Beleg. Der ursprüngliche Auftrag und sein
Fingerabdruck bleiben kompatibel. An die Datenbank geht weiterhin die vom Gast eingegebene
Anschrift. Koordinaten und normalisierte Anbieteranschrift erscheinen weder im Browser noch in der
Datenbank oder den Protokollen. Google erhält nur die für die Prüfung erforderlichen Adressfelder.

## Integration durch Chat 18

1. API und Storefront zusammen in eine isolierte Vorschau übernehmen. Der optionale neue
   Request-Schlüssel `deliveryAddress` gehört bei aktivierter Lieferprüfung zu `cart-quote` und
   `delivery-quote`. Er verwendet das vorhandene Format der Lieferadresse und muss dieselbe
   `postalCode` enthalten. Codes `delivery_address_incomplete`, `delivery_address_ambiguous` und
   `delivery_address_unverified` verwenden HTTP 422. Dienstausfall verwendet HTTP 503 mit
   `delivery_address_unavailable`. Der bestehende signierte Checkout transportiert die Codes.
2. Lieferfreigabe bis zur Abnahme deaktiviert lassen. Für einen autorisierten Anbietertest einen auf
   Address Validation eingeschränkten `GOOGLE_ADDRESS_VALIDATION_API_KEY` als API Worker Secret
   hinterlegen. Projekt, Kostenrahmen, Quoten sowie passende Gast- und Datenschutzhinweise vorher im
   zuständigen Chat klären.
3. In `preview` und `production` ist die Prüfung für angebotene Lieferungen verpflichtend.
   `DELIVERY_ADDRESS_VALIDATION_ENABLED=true` aktiviert dieselbe Prüfung zusätzlich in einer
   isolierten lokalen Umgebung. Ein fehlender Schlüssel, Anbieterfehler oder Zeitüberschreitung nach
   2,5 Sekunden stoppt die betroffene Lieferanfrage. Abholung verwendet den Adapter nicht.
4. Einen erlaubten Anbietertest mit geeigneten Testadressen durchführen. Reale Lieferungen erst nach
   bestätigten Standortregeln und erfolgreicher Prüfung freigeben.

Das Paket benötigt keine Datenbankmigration. Bei Rücknahme die Lieferfreigabe deaktivieren und den
zusammengehörigen API- und Shop-Stand wiederherstellen.

Primärquellen

- https://developers.google.com/maps/documentation/address-validation/reference/rest/v1/TopLevel/validateAddress
- https://developers.google.com/maps/documentation/address-validation/policies
