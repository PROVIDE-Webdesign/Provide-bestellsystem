# Zahlungsgrundlage und sichere Zahlungsereignisse

## Status

Angenommen für Arbeitsblock 2.9.

## Entscheidung

PROVIDE trennt die eigene Zahlungswahrheit von einem später ausgewählten Zahlungsanbieter. Jede
Bestellung erhält atomar genau eine `order_payments`-Zeile. Sie kopiert Sollbetrag und Währung aus
dem unveränderlichen Bestell-Snapshot und legt fest, ob online oder erst bei Übergabe bezahlt wird.
Der Client darf Betrag, Währung oder einen erfolgreichen Zahlungszustand niemals bestimmen.

`private.submit_order_with_payment` ersetzt den bisherigen serverseitigen Bestelleingang. Die
Funktion erstellt Bestellung und Zahlungsanforderung in derselben Datenbanktransaktion. Identische
Wiederholungen liefern dieselbe Bestellung und dieselbe Zahlungsanforderung; ein abweichender
Zahlungsmodus unter demselben Einreichungsschlüssel wird abgewiesen. Der direkte Service-Rollen-
Zugriff auf `private.submit_order` wird entzogen, damit keine neue Bestellung ohne
Zahlungsanforderung entstehen kann.

Onlinezahlungen bleiben zusätzlich durch das bestehende, standardmäßig deaktivierte Feature
`payment.online` gesperrt. `on_fulfillment` bedeutet ausschließlich, dass der Online-Zahlungsweg
nicht erforderlich ist; die spätere Erfassung einer Bar- oder Kartenzahlung vor Ort gehört nicht zu
diesem Arbeitsblock.

## Anbietergrenze

`payment_attempts` speichert pro Versuch nur einen PROVIDE-Idempotenzschlüssel, einen normalisierten
Anbieterschlüssel und eine ungefährliche Anbieterreferenz. Geheimnisse, Checkout-Antworten,
Kartendaten und vollständige Anbieterobjekte werden nicht gespeichert.

Ein zukünftiger API-Adapter muss die Webhook-Signatur mit dem Geheimnis des jeweiligen Anbieters
prüfen, bevor er `private.apply_verified_payment_event` aufruft. Die Datenbankfunktion ist keine
Signaturprüfung. Sie bildet die zweite Schutzschicht und kontrolliert:

1. Restaurant, Standort, Bestellung, Zahlung und Zahlungsversuch gehören zusammen.
2. Anbieter und Zahlungsreferenz entsprechen dem registrierten Versuch.
3. Ereignis-ID, Ereignistyp, Betrag, Währung, Zielstatus und Payload-Digest sind formal gültig.
4. Betrag und Währung entsprechen dem gespeicherten Bestell-Snapshot.
5. Der Zustandswechsel ist erlaubt.
6. Eine wiederholte identische Ereignis-ID ist idempotent; eine veränderte Wiederholung schlägt
   geschlossen fehl.

Von einem Webhook wird nur ein SHA-256-Digest des normalisierten Rohinhalts gespeichert. Dieser
Digest unterstützt die Erkennung widersprüchlicher Wiederholungen, erlaubt aber keine Rekonstruktion
des Webhook-Inhalts.

## Zahlungszustände

Onlinezahlungen beginnen mit `created`. Ein kontrolliert angelegter Versuch wechselt zu
`pending_customer`. Danach sind diese Wege erlaubt:

1. `pending_customer` → `authorized`, `captured`, `failed`, `cancelled` oder `expired`
2. `authorized` → `captured`, `failed`, `cancelled` oder `expired`
3. `failed`, `cancelled` oder `expired` → `pending_customer` über einen neuen Versuch
4. `captured` → `partially_refunded` oder `refunded`
5. `partially_refunded` → ein höherer kumulierter Teilbetrag oder `refunded`

Bei `captured` muss der gemeldete Betrag exakt dem Bestellbetrag entsprechen. Teil- und
Vollerstattungen werden als kumulierter Erstattungsbetrag gespeichert und dürfen die erfasste
Zahlung niemals überschreiten. `on_fulfillment` verwendet ausschließlich `not_required` und nimmt
nicht am Onlinezustandsmodell teil.

## Bestellfreigabe

`private.transition_order_status` prüft vor `accepted` die Zahlungsanforderung. Eine Bestellung ohne
Zahlungsanforderung wird abgewiesen. Eine Onlinebestellung darf erst mit `captured` angenommen
werden. Eine Bestellung mit `on_fulfillment` kann ohne Onlinezahlung in den Restaurantablauf
wechseln.

Ablehnung oder Stornierung einer bereits erfassten Onlinezahlung löst in diesem Arbeitsblock noch
keine Anbietererstattung aus. Der bestehende Bestellstatus und das Outbox-Ereignis bilden dafür den
Eingang eines späteren, ausdrücklich freizugebenden Refund-Adapters. Bis dahin bleiben echte
Zahlungen gesperrt.

## Verlauf, Ereignisse und Rechte

`payment_provider_events` dedupliziert ausschließlich API-verifizierte Anbietermetadaten.
`payment_status_events` bildet jeden erfolgreichen internen oder verifizierten Zustandswechsel als
geordneten, append-only Verlauf ab. Minimierte Outbox-Ereignisse enthalten Beträge und fachliche
IDs, aber keine Anbieterreferenzen, Payload-Digests, Kunden- oder Kartendaten.

Browserrollen und die Service-Rolle besitzen keine direkten Schreibrechte auf Zahlungstabellen. Die
Service-Rolle darf nur die drei kontrollierten Einstiegspunkte für Bestellung, Versuch und
verifiziertes Ereignis ausführen. RLS-Lesezugriffe auf die fachliche Zahlungsanforderung und den
Statusverlauf sind auf aktive Owner und Manager mit ihrer Standortgrenze beschränkt; Küchenpersonal
und Fahrer sehen keine Zahlungsdaten. Technische Versuche, Anbieterreferenzen und
Provider-Ereignismetadaten bleiben vollständig serverseitig.

## Folgen

1. Zahlungsbeträge bleiben an den unveränderlichen Bestell-Snapshot gebunden.
2. Wiederholte API-Aufrufe und Webhooks erzeugen keine doppelten Zahlungen oder Verläufe.
3. Onlinebestellungen gelangen erst nach bestätigter Erfassung in die operative Annahme.
4. Der konkrete Zahlungsanbieter kann später über einen API-Adapter ergänzt oder gewechselt werden.
5. Das Repository benötigt noch keine Zahlungsgeheimnisse und verarbeitet keine echten Zahlungen.

## Nicht Bestandteil

1. Auswahl oder Integration eines konkreten Zahlungsanbieters
2. API-Schlüssel, Webhook-Geheimnisse oder produktive Endpunkte
3. Checkout-Sitzungen, Zahlungslinks oder kundenbezogene Zahlungsoberflächen
4. Namen, E-Mail-Adressen, Telefonnummern, Lieferadressen oder Zahlungsinstrumente
5. Automatische Refund-Ausführung, Chargebacks, Streitfälle oder Auszahlungen
6. Trinkgeld, Gutscheine, Rabatte, Gebühren, Steuernachweise oder Rechnungsstellung
7. Produktivzahlungen, Preview-Rollout oder Änderungen an der Asian-Kitchen-Website
