# Onlinezahlungen: isolierter Stripe-Sandbox-Nachweis

## Stand und Voraussetzung

Die Implementierung ist ausschließlich für synthetische Bestellungen in einem Stripe-Testkonto
bestimmt. Ein echter Anbieter-Durchlauf ist noch **nicht nachgewiesen**. In der Arbeitsumgebung sind
keine Stripe-Testzugänge konfiguriert. CI verwendet einen kontrollierten Anbieterersatz und ruft
Stripe nicht auf. Die technische Endfreigabe bleibt bis zum dokumentierten echten Test offen.

Voraussetzungen: isolierte migrierte Testdatenbank, synthetisch veröffentlichter Standort samt Menü
und Kapazität, Stripe-Sandbox-Zugang sowie lokal laufende Storefront, API und Dashboard. Die
bestehenden Checkout-, Status- und Dashboard-Runbooks gelten ergänzend. Es erfolgt kein
automatisches Deployment. Ein gemeinsamer Preview-Test wird erst nach separater Deployment-Freigabe
eingerichtet; ein lokaler Test benötigt diese nicht.

## Sichere Konfiguration

Serverseitig im lokalen ignorierten Secret-Speicher oder im freigegebenen Test-Secret-Store setzen:

| Name                         | Inhalt                                                              |
| ---------------------------- | ------------------------------------------------------------------- |
| `STRIPE_TEST_SECRET_KEY`     | Geheimschlüssel des gewählten Testkontos mit Präfix `sk_test_`      |
| `STRIPE_TEST_ACCOUNT_ID`     | Zugehöriges Konto mit Präfix `acct_`                                |
| `STRIPE_TEST_WEBHOOK_SECRET` | Signiergeheimnis des tatsächlich verwendeten Webhook-Endpunkts      |
| `PAYMENT_ACCESS_SECRET`      | Eigenes zufälliges Geheimnis mit mindestens 32 Zeichen              |
| `PAYMENT_RETURN_ORIGIN`      | Exakter Ursprung der Storefront ohne Pfad oder abschließenden Slash |

Keine Geheimnisse in Chat, Repository, Browser-Variablen, Screenshots oder Logs übernehmen. Für die
API sind `APP_ENV=test`, `ONLINE_PAYMENT_PROCESSING_ENABLED=true`, `ONLINE_PAYMENT_ENABLED=true`,
`CHECKOUT_WRITE_ENABLED=true`, `ORDER_STATUS_READ_ENABLED=true` und `HYPERDRIVE_CACHE_DISABLED=true`
sowie die bestehenden Status-, Datenschutz- und Datenbankeinstellungen nötig. Für Lieferung
zusätzlich `DELIVERY_ORDERING_ENABLED=true`. Am synthetischen Restaurant muss `payment.online` über
die bestehende Feature-Verwaltung aktiviert sein. Die Storefront benötigt
`PUBLIC_ONLINE_PAYMENT_ENABLED=true`. Das Dashboard benötigt seine bereits dokumentierte
Authentifizierung und Operations-Freigabe.

Stripe CLI mit dem ausgewählten Testkonto anmelden. Danach lokale Zustellung starten:

```bash
stripe listen --forward-to http://localhost:8787/v1/payments/stripe/webhook
```

Das von diesem Listener ausgegebene Signiergeheimnis lokal hinterlegen. Bei einem konfigurierten
Test-Webhooks-Endpunkt dessen eigenes Geheimnis verwenden. Erlaubte Events:
`checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`,
`payment_intent.payment_failed`, `refund.created`, `refund.updated`, `refund.failed`. Den Scheduled
Handler lokal regelmäßig auslösen; im Preview ist der vorhandene Minuten-Cron erforderlich. Nur
Webhook-Zustellung genügt nicht, weil auch Fristablauf und verlorene Events abgeglichen werden
müssen. Wiederaufnahme über die Storefront verarbeitet den eigenen Auftrag ebenfalls, ersetzt aber
den Scheduled Handler nicht.

## Auszuführende Abnahmematrix

Nur offizielle [Stripe-Testkarten](https://docs.stripe.com/testing) und synthetische Kontaktdaten
verwenden. Je Prüffall Bestell-ID und UTC-Zeit sowie Ergebnis festhalten; Konto- und
Anbieterreferenzen gehören ausschließlich in ein zugriffsbeschränktes Nachweisprotokoll, nicht in
öffentliche PRs.

1. Abholung reservieren, Zahlungslink öffnen und erfolgreich bezahlen. Vor Bestätigung keine Annahme
   und keine Bestellbenachrichtigung. Danach genau einmal erfasster Betrag, Annahme möglich.
2. Lieferbestellung aus gültiger PLZ aufgeben. Stripe-Gesamtbetrag entspricht Artikelwert plus
   bestätigter Liefergebühr. Unzulässige PLZ und konkurrierende letzte Kapazität bleiben gesperrt.
3. Abgelehnte Testkarte und zusätzliche Authentifizierung prüfen. Ablehnung darf keine Zahlung
   bestätigen; erfolgreicher Abschluss der Authentifizierung muss korrekt abgeglichen werden.
4. Zur Storefront zurückkehren, denselben Tab neu laden und Testzahlung wieder aufnehmen.
   Wiederholungen erzeugen keine weitere Bestellung oder Session. Gast-Lesetoken allein kann keinen
   Zahlungslink abrufen. Manipulierter Betrag und fremde Bestell-ID scheitern.
5. Nicht bezahlen und lokale Frist ablaufen lassen. Nach bestätigter Session-Beendigung steht der
   Slot wieder zur Verfügung. Bei unterbrochener Anbieterkommunikation bleibt er gesperrt.
6. Erfolgreich bezahlte Bestellung als Leitung ablehnen oder stornieren. Bestellstatus bleibt
   beendet; volle Erstattung einschließlich Liefergebühr wird erst nach Anbieterbestätigung
   angezeigt.
7. Webhook mehrfach und nach Unterbrechung zustellen; einmalige Buchung und Erstattung nachweisen.
   Zustellung mit falscher Signatur ablehnen. Nach absichtlich verpasstem Event muss der periodische
   Abgleich denselben Zustand herstellen. Browser-Erfolgsrückkehr allein darf nichts buchen.
8. Neuerstellung über `ONLINE_PAYMENT_ENABLED=false` sperren. Vorhandene Zahlung und Erstattung
   müssen bei weiterhin aktivem Processing-Gate fertig verarbeitet werden.

Verlorene Erstellungsergebnisse, vertauschte Events, bestätigte Erstattungsfehler mit
protokolliertem Retry sowie späte Zahlung nach Stornierung werden zusätzlich deterministisch in CI
geprüft. Wo die Sandbox einen Fehlerfall nicht zuverlässig auslösen kann, diesen als synthetischen
Nachweis markieren und niemals als beobachteten echten Anbieterfall ausweisen.

## Betrieb, Störung und Abschluss

Neue Bestellungen zuerst über `ONLINE_PAYMENT_ENABLED=false` sperren; Processing eingeschaltet
lassen, solange offene Vorgänge bestehen. `manual_review`, offene abgelaufene Reservierungen und
`refund_failed` benötigen Prüfung durch berechtigte Leitung. Anbieterantwortverlust rechtfertigt
keine manuelle neue Session oder neue Erstattung. Eine bestätigte fehlgeschlagene Erstattung lässt
sich über den Dashboard-Befehl wiederholen; dabei bleiben Akteur und vorherige Referenz erhalten.

Nachweisvorlage für die Abschlussprüfung:

| Feld                                                     | Eintrag               |
| -------------------------------------------------------- | --------------------- |
| Getesteter Commit                                        | offen                 |
| Testdatum und verantwortliche Person                     | offen                 |
| Testkonto korrekt geprüft                                | offen                 |
| Abholung und Lieferung erfolgreich                       | offen                 |
| Ablehnung und Authentifizierung geprüft                  | offen                 |
| Abbruch, Ablauf und Wiederaufnahme geprüft               | offen                 |
| Vollständige echte Sandbox-Erstattung bestätigt          | offen                 |
| Event-Wiederholung und Abgleich geprüft                  | offen                 |
| Pflichtprüfungen `check` und `database` am PR-Stand grün | separat im PR belegen |
| Technische Endfreigabe und Merge-Erlaubnis               | ausstehend            |

Erst nach erfolgreicher Matrix und grünen Pflichtprüfungen technische Endfreigabe und
Merge-Erlaubnis anfordern. Modell/Modus für diese Prüfung: Astra hoch. Reale Zahlungen bleiben einem
späteren, gesondert freizugebenden Arbeitsblock vorbehalten.
