# Öffentlicher Gast-Bestellstatus

## Status

Angenommen für Arbeitsblock 3.4. Der fachliche Umfang wurde am 15. September 2026 ausdrücklich
freigegeben.

## Entscheidung

Eine erfolgreiche Gast-Abholbestellung erhält eine kurzlebige Statusberechtigung. Das API-Backend
signiert Bestell-ID, Restaurant-Slug und Standort-Slug mit HMAC-SHA-256. Der Browser sendet
Bestell-ID und Token ausschließlich im JSON-Körper an
`POST /v1/storefront/{restaurantSlug}/{locationSlug}/order-status`. Token oder Bestell-ID stehen
weder in URL noch Query-Parametern.

Das aktuelle serverseitige Secret muss mindestens 32 Byte lang sein. Eine optionale vorherige
Secret-Version hält bereits ausgegebene Berechtigungen während einer kontrollierten Rotation gültig.
Neue Bestätigungen werden ausschließlich mit dem aktuellen Secret signiert. Kein Secret wird im
Repository, Browser oder in Logs gespeichert.

Der Checkout bleibt geschlossen, wenn der Statusweg nicht gleichzeitig sicher konfiguriert ist.
Dadurch entsteht keine bestätigte öffentliche Bestellung ohne abrufbare Statusberechtigung.

## Öffentliche Daten

`private.read_public_guest_order_status` erhält den bereits API-verifizierten Bereich und die
Bestell-ID. Die nur für `service_role` ausführbare Funktion gibt ausschließlich Bestell-ID,
aktuellen Status, Abholart, Zahlungsmodus, Abholzeitpunkt, Währung, Gesamtsumme, Artikelanzahl,
Aktualisierungszeitpunkt und Ablaufzeitpunkt zurück. Kontakt-, Liefer-, Positions-, Mitarbeiter- und
Statusverlaufsdaten fehlen vollständig.

Eine gültige Berechtigung zeigt eine bestehende Bestellung auch dann weiter an, wenn Restaurant,
Standort oder Speisekarte später pausiert werden. Gäste müssen den Stand einer bereits angenommenen
Bestellung weiterhin sehen können. Der Statuszugriff endet serverseitig 48 Stunden nach dem
Abholzeitpunkt.

## Browser und Aktualisierung

Die Storefront hält ausschließlich Bestell-ID, Status-Token und Ablaufzeitpunkt in `sessionStorage`.
Namen, Telefonnummern und E-Mail-Adressen werden nicht gespeichert. Die Statusanzeige aktualisiert
sich höchstens alle 20 Sekunden, nur in einem sichtbaren Tab, bricht veraltete Anfragen ab und
stoppt bei `completed`, `rejected` oder `cancelled`. Eine manuelle Aktualisierung bleibt möglich.

## Sicherheitsgrenzen

1. Ungültige Berechtigungen, unbekannte Bestellungen und falsche Bereiche erhalten einheitlich
   `404 not_found`.
2. Fehlende Laufzeitfreigabe, fehlendes aktuelles Secret, ungeprüfter Hyperdrive-Cache oder fehlende
   Datenbankbindung führen zu `503 service_unavailable`.
3. Die Statusanfrage ist auf 4 KiB UTF-8-JSON und eine exakte Feld-Allowlist begrenzt.
4. Alle Antworten verwenden `no-store`; Gateway und API rekonstruieren die Ausgabe-Allowlist.
5. Die API protokolliert ausschließlich Ereignisname und Request-ID, niemals Token oder
   Bestellwerte.

## Nicht Bestandteil

1. Restaurant-Dashboard, Login, MFA oder operative Statusänderungs-API
2. Benachrichtigungen, öffentliche Statushistorie oder Teilen eines Statuslinks
3. Lieferung, Onlinezahlung, echte Daten oder externe Integrationen
4. Preview-/Produktionsaktivierung oder Änderungen an der Asian-Kitchen-Demo
