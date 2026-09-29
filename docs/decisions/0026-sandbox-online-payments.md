# ADR 0026: Onlinezahlungen im Testbetrieb

## Status

Arbeitsblock 3.9 ist im beschriebenen Umfang formal freigegeben. Technische Endfreigabe und Merge
bleiben getrennte Schritte. Ein echter Stripe-Sandbox-Durchlauf ist Pflicht; synthetische Tests
ersetzen diesen Nachweis nicht.

## Zahlungsgrenze

Ein explizit konfiguriertes Stripe-Testkonto verwendet Hosted Checkout, Kartenzahlung und EUR.
`APP_ENV=production`, Live-Schlüssel, fehlende Geheimnisse oder gecachte Datenbankverbindungen
schließen die Integration. Der Adapter prüft das Konto sowie Testmodus, Bestellzuordnung, Währung
und Gesamtbetrag der Checkout Session. „Bezahlt“ verlangt zusätzlich einen erfolgreichen
PaymentIntent mit passendem eingegangenen Betrag. Browser-Rückleitungen und Webhook-Payloads können
allein keine Zahlung bestätigen. Karteninformationen bleiben bei Stripe; Kontakt- und
Adresssnapshots werden nicht an Stripe übertragen.

Neue Bestellungen brauchen zusätzlich `ONLINE_PAYMENT_ENABLED=true` und das Restaurantmerkmal
`payment.online`. `ONLINE_PAYMENT_PROCESSING_ENABLED` steuert Webhooks und Nachbearbeitung separat.
Das Abschalten neuer Bestellungen lässt bestehende Vorgänge weiterlaufen. Alle Gates sind im
Repository standardmäßig geschlossen.

## Reservierung und Wiederaufnahme

Bestellung, serverberechneter Betrag einschließlich Liefergebühr, Kapazität, Datenschutzsnapshot,
Zahlungsanforderung und dauerhafter Zahlungsauftrag entstehen atomar. Abholung verwendet den
bestehenden Bestellschreiber; Lieferung bestätigt die versionierte PLZ- und Preisvorschau erneut.
Identische Wiederholungen liefern denselben Auftrag; Änderungen unter demselben Schlüssel scheitern.
Ein Standort erhält höchstens 20 neue Vorgänge pro Minute beziehungsweise 20 offene Reservierungen.

Die Reservierungsfrist beträgt höchstens zehn Minuten und endet spätestens am Beginn der benötigten
Vorlaufzeit. Nicht bezahlte Bestellungen dürfen nicht angenommen werden. Ein Fristablauf oder
Dashboard-Abbruch fordert zuerst die Beendigung der Anbietersession an. Erst die bestätigte
Beendigung gibt die Kapazität frei. Bei unklarer Anbieterantwort bleibt die Reservierung erhalten.
Die Gastoberfläche zeigt dann die laufende Prüfung.

Die Zahlungsaktion hat eine eigene, kurzlebige HMAC-Berechtigung mit separatem Geheimnis und Bindung
an Restaurant, Standort, Bestellung und Frist. Der vorhandene Gast-Lesetoken reicht dafür nicht. Die
Aktion liegt ausschließlich im Session-Speicher des ursprünglichen Browsers. Die Checkout-URL wird
nur auf eine berechtigte POST-Anfrage ausgegeben, nicht gespeichert und nicht in den öffentlichen
Bestellstatus aufgenommen. Wiederaufnahme löst höchstens alle drei Sekunden Anbieterzugriffe aus.

## Dauerhafte Verarbeitung

PostgreSQL speichert den Auftrag vor jedem externen Zugriff. Ein Worker beansprucht ihn mit einer
zweiminütigen Lease. Anbieterzugriffe laufen außerhalb der Datenbanktransaktion; identische
Wiederholungen verwenden denselben Stripe-Idempotenzschlüssel und dieselben Parameter.
Fehlgeschlagene Aufrufe werden mit begrenztem Backoff erneut verarbeitet. Nach 20 Stunden ohne
gespeicherte Session stoppt die automatische Neuerstellung zur manuellen Prüfung, bevor Stripes
Idempotenzaufbewahrung abgelaufen sein könnte.

Stripe erlaubt für Checkout eine kürzeste explizite Laufzeit von 30 Minuten. Daher beendet der
Worker die Session zur kürzeren lokalen Frist aktiv. Bleibt der Worker aus, kann die Session länger
offen bleiben. Eine anschließend erkannte Zahlung aktiviert die abgelaufene Bestellung nicht: Sie
führt zur Stornierung und vollständigen Erstattung. Auch eine erstmals nach Fristablauf erkannte
Zahlung wird konservativ so behandelt. Nachbearbeitung und Überwachung sind damit
Betriebsbedingungen.

Webhooks werden über die ursprünglichen Request-Bytes mit HMAC und fünf Minuten Zeitfenster geprüft.
Nur erlaubte Ereignistypen des Testkontos werden dauerhaft als Ereignis-ID, Objekt-ID und Hash
abgelegt; keine Roh-Payloads. Die HTTP-Bestätigung folgt erst dem erfolgreichen Commit. Gleiche
Ereignisse bleiben wirkungslos; widersprüchliche Wiederholungen scheitern. Ereignisse wecken den
Auftrag. Der Worker liest den aktuellen Anbieterzustand, sodass vertauschte oder verspätete Events
keinen älteren Zahlungszustand zurückschreiben. Zusätzlich läuft periodischer Abgleich.

## Erstattung und Bedienung

Ablehnung oder Stornierung einer bezahlten Bestellung fordert genau eine vollständige Erstattung an.
Ein verlorenes HTTP-Ergebnis wiederholt denselben Auftrag. Eine bestätigte fehlgeschlagene
Erstattung bleibt im Dashboard sichtbar. Owner oder Manager mit AAL2 und passender Standortzuordnung
können einen protokollierten neuen Versuch auslösen. Jede Wiederholung benötigt einen bestätigten
Fehlschlag, bekommt eine neue Sequenz und hält vorherige Anbieterreferenz und Akteur unveränderlich
fest. Ein unbekanntes Ergebnis oder `requires_action` bleibt offen und erlaubt keinen neuen Versuch.
Erst bestätigter Erfolg erhöht die erstattete Summe.

Bestellstatus und Zahlungsstatus bleiben getrennt. Leitung und Gast erhalten reduzierte
verständliche Zahlungszustände; Küche erhält keine Finanzdetails. Benachrichtigungen über eine neue
Onlinebestellung warten auf die bestätigte Zahlung. Abholung gegen Zahlung vor Ort und Lieferung
gegen Zahlung bei Übergabe bleiben kompatibel.

## Abgrenzung und Quellen

Keine Livezahlungen, Connect-Konten, Auszahlungen, Teil-Erstattungsoberfläche, echten Nachrichten,
Produktivdaten, Deployments oder Änderungen an Asian Kitchen.

- [Stripe Checkout Session erstellen](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe Checkout Session beenden](https://docs.stripe.com/api/checkout/sessions/expire)
- [Stripe Erstattung erstellen](https://docs.stripe.com/api/refunds/create)
- [Stripe Webhooks](https://docs.stripe.com/webhooks)
- [Sandbox-Prüfanleitung](../runbooks/sandbox-online-payments.md)
