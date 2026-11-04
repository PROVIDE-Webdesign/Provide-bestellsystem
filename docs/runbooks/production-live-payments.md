# Block 2 · Stripe Live für den Pilotbetrieb

Stand 04.11.2026. Technische Grundlage ist der geprüfte Release-Kandidat
`candidate/p5-release-20261104` bei `b35ec509b2486ad63abe4a3979140b4112b71473`. Der Checkpoint weist
46 Datenbank-Testdateien mit 3180 Prüfungen und eine integrierte Stripe-Live-Simulation aus. Die
geschlossene Produktionskonfiguration wurde lokal geprüft. Der verbundene Stripe-Zugang zeigt
derzeit ausschließlich das Sandbox-Konto „New business“.

## Eingaben und Einrichtung

1. Produktionsziel aus Block 1 übernehmen. Den veröffentlichten API- und Shop-Ursprung sowie die
   Produktionsdatenbank dem geprüften Release zuordnen. Vor jeder Änderung den Zielmodus und die
   Trennung von der Vorschau verifizieren.
2. Den realen Pilotbetrieb und Standort mit dem Betreiber abgleichen. Für den Checkout den
   rechtlichen Betreibernamen, die ladungsfähige Anschrift, den Datenschutzkontakt und die
   freigegebene Datenschutzhinweis-URL erfassen. Die Verarbeitung für Bestellung und Zahlung mit den
   tatsächlich eingesetzten Diensten und der konfigurierten Aufbewahrung abgleichen. Der Betreiber
   bestätigt die Angaben und die Fassung.
3. Das freigegebene Stripe-Live-Plattformkonto und das verbundene Händlerkonto lesend prüfen.
   Kontoidentität, Live-Zahlungsberechtigung und offene Anforderungen abgleichen. Den Händler
   ausschließlich dem bestätigten Restaurant im Produktionsdatenbestand zuordnen. Die beiden
   Konto-IDs getrennt dokumentieren.
4. Den Live-Connect-Webhook für Ereignisse verbundener Konten auf
   `https://<Produktions-API>/v1/payments/stripe/webhook` einrichten. Abonnements gemäß geprüftem
   Handler: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `refund.created`, `refund.updated` und `refund.failed`. Den
   eingeschränkten Live-Schlüssel und das separate Signaturgeheimnis direkt im Produktions-Worker
   hinterlegen.
5. Plattform-ID in `STRIPE_LIVE_ACCOUNT_ID` und Zugangsdaten in `STRIPE_LIVE_SECRET_KEY` und
   `STRIPE_LIVE_WEBHOOK_SECRET` hinterlegen. `PAYMENT_RETURN_ORIGIN` und
   `CHECKOUT_STOREFRONT_ORIGIN` auf denselben produktiven HTTPS-Shop setzen. Datenschutzfassung
   `live-…` konsistent über `CHECKOUT_PRIVACY_NOTICE_VERSION` und
   `PUBLIC_CHECKOUT_PRIVACY_NOTICE_VERSION` setzen, die freigegebene URL über
   `PUBLIC_LIVE_CHECKOUT_PRIVACY_URL`.
6. Block 2 mit lesendem Stripe-Kontoabgleich, Händlerzuordnung, Webhook-Konfiguration,
   Negativprüfung der Signaturprüfung und erreichbarem Datenschutzhinweis abnehmen.
   Webhook-Verarbeitung über `ONLINE_LIVE_PAYMENT_PROCESSING_ENABLED` nur im abgestimmten
   Produktionsziel prüfen. Neue Live-Zahlungen und die öffentliche Anzeige bleiben bis zum
   freigegebenen Testfenster gesperrt. Der Ablauf mit einer echten Zahlung gehört zu Block 4.

Stripe-Referenzen: [API-Schlüssel](https://docs.stripe.com/keys) und
[Webhooks](https://docs.stripe.com/webhooks).
