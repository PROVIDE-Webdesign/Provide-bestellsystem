# Umgebungs- und Secret-Runbook

## Zweck

Dieses Runbook legt fest, wie Konfigurationen und Geheimnisse getrennt werden. Es gilt für
Storefront, Dashboard, API, CI und spätere Hintergrundprozesse.

## Umgebungen

| Umgebung      | Zweck                          | Daten                | Zahlungen           | Freigabe         |
| ------------- | ------------------------------ | -------------------- | ------------------- | ---------------- |
| `development` | Lokale Entwicklung             | Nur synthetisch      | Keine               | Entwickler       |
| `test`        | Automatisierte Prüfungen       | Kurzlebige Testdaten | Keine               | CI               |
| `preview`     | Staging und Asian-Kitchen-Demo | Nur synthetisch      | Nur spätere Sandbox | Interne Prüfung  |
| `production`  | Echter Restaurantbetrieb       | Erst nach Go-live    | Erst nach Go-live   | Gesondertes Gate |

Zwischen den Umgebungen werden weder Datenbanken noch Secrets wiederverwendet. Ein Export echter
Produktionsdaten in Development, Test oder Preview ist ausgeschlossen.

## Variablenvertrag

| Variable                               | Sichtbarkeit | Zweck                                                 |
| -------------------------------------- | ------------ | ----------------------------------------------------- |
| `APP_ENV`                              | Öffentlich   | Aktuelle Laufzeitumgebung                             |
| `PUBLIC_STOREFRONT_URL`                | Öffentlich   | Basisadresse der Kundenoberfläche                     |
| `PUBLIC_DASHBOARD_URL`                 | Öffentlich   | Basisadresse des Dashboards                           |
| `PUBLIC_API_URL`                       | Öffentlich   | Öffentliche API-Basisadresse                          |
| `DATABASE_URL`                         | Nur Server   | PostgreSQL-Verbindung der jeweiligen Umgebung         |
| `AUTH_SESSION_SECRET`                  | Nur Server   | Signierung und Schutz von Sitzungen                   |
| `API_ALLOWED_ORIGINS`                  | Öffentlich   | Kommagetrennte CORS-Allowlist der API                 |
| `ORDER_STATUS_READ_ENABLED`            | Nur Server   | Explizites Laufzeit-Gate für öffentliche Statusabrufe |
| `ORDER_STATUS_TOKEN_SECRET`            | Nur Server   | Aktuelles HMAC-Secret für Statusberechtigungen        |
| `ORDER_STATUS_TOKEN_SECRET_PREVIOUS`   | Nur Server   | Optionales vorheriges Secret während Rotation         |
| `DASHBOARD_AUTH_ENABLED`               | Nur Server   | Explizites Laufzeit-Gate für den Personalzugang       |
| `DASHBOARD_ORDER_OPERATIONS_ENABLED`   | Nur Server   | Separates Gate für operative Dashboard-Bestellungen   |
| `NOTIFICATION_DISPATCH_ENABLED`        | Nur Server   | Explizites Gate für den Benachrichtigungs-Worker      |
| `SUPABASE_AUTH_ISSUER`                 | Nur Server   | Erwarteter Aussteller der Supabase-Zugriffstokens     |
| `SUPABASE_AUTH_AUDIENCE`               | Nur Server   | Erwartetes Publikum der Supabase-Zugriffstokens       |
| `NEXT_PUBLIC_SUPABASE_URL`             | Öffentlich   | Reine HTTPS-Origin des Supabase-Projekts              |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Öffentlich   | Öffentlicher Schlüssel für den Supabase-Auth-Client   |
| `DASHBOARD_API_BASE_URL`               | Nur Server   | Feste API-Origin des Dashboard-Gateways               |

Neue Variablen werden erst nach Einordnung als öffentlich oder serverseitig ergänzt. Anbieterwerte
für Stripe, Supabase, E-Mail oder Adressprüfung werden erst mit dem jeweiligen Technikblock
aufgenommen.

Die API-Lesewege verlangen zusätzlich `HYPERDRIVE_CACHE_DISABLED=true` nach Prüfung der
tatsächlichen Hyperdrive-Konfiguration. Die Variable enthält kein Secret und schaltet den entfernten
Cache nicht selbst aus. Die Storefront verwendet `PUBLIC_API_URL` ausschließlich als feste
öffentliche API-Basisadresse. Details und lokale Overrides:
[Storefront-Runbook](public-storefront.md).

Status-Secrets müssen mindestens 32 Byte lang sein und werden ausschließlich im Secret-Speicher der
Laufzeit hinterlegt. Sie dürfen nicht als Wrangler-`vars`, öffentliche Bindings oder echte Werte in
Beispieldateien gelangen. Rotation und lokale Prüfung stehen im
[Status-Runbook](public-order-status.md).

Der Dashboard-Publishable-Key ist ausdrücklich kein Secret; Service-Role-Key, Zugriffstokens,
Refresh-Tokens und TOTP-Daten bleiben hingegen geheim. Das Dashboard vertraut keinem ungeprüften
Cookie und verwendet die öffentliche Supabase-JWKS zur Signaturprüfung. Einrichtung und
Fehlergrenzen stehen im [Dashboard-Auth-Runbook](dashboard-authentication.md).

Der Benachrichtigungs-Worker bleibt ohne explizites Gate und konfigurierten Adapter geschlossen.
Anbieterkennung, API-Schlüssel und andere spätere Versandwerte sind serverseitige Secrets und werden
erst in einem getrennt freigegebenen Anbieterblock ergänzt. Das Repository enthält weder echte
Empfänger noch Anbieterzugangsdaten. Details stehen im
[Benachrichtigungs-Runbook](order-notifications.md).

## Lokale Einrichtung

1. `.env.example` nach `.env.local` kopieren.
2. Ausschließlich lokale, ungefährliche Werte verwenden.
3. `.env.local` niemals committen.
4. Vor jedem Commit `pnpm check` ausführen.

## Preview und Produktion

1. Werte ausschließlich im Secret- beziehungsweise Variablenbereich der Hostingplattform
   hinterlegen.
2. Für jede Umgebung eigene Schlüssel und Datenbanken verwenden.
3. Secrets niemals in Pull Requests, Issues, Logs oder Screenshots einfügen.
4. Produktionswerte werden erst nach dokumentiertem Go-live-Gate angelegt.
5. Nach vermuteter Offenlegung den Schlüssel sofort sperren, ersetzen und den Vorfall dokumentieren.

## Prüfung

`@provide/config` validiert Pflichtwerte beim Start. Browsercode importiert ausschließlich
`@provide/config/public`; Serverprozesse verwenden `@provide/config/server`. Die getrennten
Einstiegspunkte und zugehörigen Tests verhindern, dass serverseitige Werte versehentlich in die
öffentliche Konfiguration gelangen.

## Lieferbestellungen

`DELIVERY_ORDERING_ENABLED=false` sperrt standardmäßig die Lieferpreisvorschau und den
Liefercheckout. Für die Übermittlung müssen zusätzlich Checkout, Gaststatus und eine überprüft
cachedeaktivierte Hyperdrive-Verbindung verfügbar sein. Regeln und Feature-Flags im Datenbankstand
bleiben weitere Voraussetzungen. In AB3.8 werden ausschließlich synthetische lokale/CI-Daten
verwendet.

## Bestellsystem-Produktion vorbereiten

Der gemeinsame Release-Stand enth?lt Shop, Dashboard und API. Die Produktionsdatenbank liegt in
einem separaten Supabase-Projekt. Preview, Testzug?nge und synthetische Restaurants bleiben im
Preview-Projekt. Produktionsdaten entstehen erst im freigegebenen Betrieb.

### Geschlossene Bereitstellung proben

Nach `pnpm check` die Worker-Konfigurationen f?r eine geschlossene Produktionsumgebung erzeugen.
`<absoluter-neuer-ordner>` steht f?r einen neu anzulegenden lokalen Ordner. Die Ausgabe enth?lt
weder Routen noch DB-Bindings, Zeitpl?ne, Anbieterzug?nge oder Asian-Kitchen-Demodateien. Den
Probelauf aus dem Repository-Stamm starten.

```sh
node scripts/prepare-closed-production.mjs <absoluter-neuer-ordner>
pnpm --filter @provide/api exec wrangler deploy --dry-run --config <absoluter-neuer-ordner>/api.json
pnpm --filter @provide/dashboard exec wrangler deploy --dry-run --config <absoluter-neuer-ordner>/dashboard.json
pnpm --filter @provide/storefront exec wrangler deploy --dry-run --config <absoluter-neuer-ordner>/storefront.json
```

### Produktionsumgebung anbinden

1. Supabase-Projekt in Frankfurt bereitstellen. Projektkennung und Zielregion mit dem freigegebenen
   Auftrag abgleichen. Die Migrationen aus dem gepr?ften Release anwenden.
   `private.synthetic_test_environment` und `private.synthetic_test_locations` m?ssen leer sein.
   Migrationen, Berechtigungen und Auth-Weiterleitungen abgleichen.
2. Einen eigenen Cloudflare-Hyperdrive f?r die Produktionsdatenbank mit deaktiviertem Cache
   einrichten und den tats?chlichen Cache-Zustand best?tigen. Erst dann
   `HYPERDRIVE_CACHE_DISABLED=true` setzen. Die geschlossenen Worker-Konfigurationen um die
   freigegebenen Produktionsdomains, die Produktionsbindung und die n?tigen Laufzeitwerte erg?nzen.
   API, Dashboard und Shop haben getrennte Namen und feste Origins.
3. Auth-Issuer und Dashboard-Publishable-Key auf das Produktionsprojekt setzen. Shop-Origin,
   Checkout-Origin und `PAYMENT_RETURN_ORIGIN` m?ssen ?bereinstimmen. Die freigegebene
   Datenschutzerkl?rung im Shop verlinken. Dieselbe mit `live-` beginnende Hinweisversion in API und
   Shop hinterlegen. Turnstile und produktive Checkout-Secrets setzen. Die API und der Shop teilen
   sich den Gateway-Schl?ssel. Fingerprint-, Netzwerk-, Status- und Zahlungszugriffsschl?ssel haben
   jeweils ihren eigenen Zweck.
4. Gesundheitspr?fungen von au?erhalb der Plattform f?r API, Datenbank, Shop und Dashboard
   einrichten. Einen separaten Alarmcheck mit Eskalationskontakt und vereinbarten Reaktionszeiten
   einrichten. Eine St?rung und die Entwarnung nachweisen. Vor der ersten Freigabe eine
   verschl?sselte Produktionssicherung in einer getrennten Umgebung wiederherstellen und
   Migrationen, Datenbest?nde und Berechtigungen vergleichen. Sicherungsziel, Schl?ssel und
   Aufbewahrung dokumentieren.

### Stripe Connect und kontrollierte Abnahme

1. Betreiber, Standort und Stripe-Live-H?ndlerkonto f?r genau das Pilotrestaurant best?tigen. Auf
   der Plattform das richtige Live-Konto ausw?hlen und die Kartenf?higkeit des verbundenen H?ndlers
   unter `configuration.merchant.capabilities.card_payments` pr?fen. Die Zuordnung in
   `private.restaurant_live_payment_accounts` eintragen und zun?chst deaktiviert lassen.
2. Den eingeschr?nkten Live-Schl?ssel als `STRIPE_LIVE_SECRET_KEY` hinterlegen. Die Plattform-ID als
   `STRIPE_LIVE_ACCOUNT_ID` setzen. F?r Ereignisse verbundener Konten den Connect-Endpunkt
   `/v1/payments/stripe/webhook` der Produktions-API einrichten und das zugeh?rige Geheimnis als
   `STRIPE_LIVE_WEBHOOK_SECRET` speichern. Der Endpunkt abonniert `checkout.session.completed`,
   `checkout.session.expired`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `payment_intent.amount_capturable_updated`,
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `refund.created`, `refund.updated`,
   `refund.failed`.
3. Abgleich und Zeitplan zuerst bei geschlossenem Bestelleingang pr?fen. Anschlie?end nach Freigabe
   die H?ndlerzuordnung und Live-Bestellung ausschlie?lich f?r den Pilotstandort ?ffnen. Bei
   weiteren Standorten desselben Restaurants dort `payment.online` ausdr?cklich deaktivieren und im
   Shop pr?fen, an welchen Standorten Online-Zahlung angeboten wird. Nach der kontrollierten
   Bestellung Stripe-Konto, Betrag, Reservierung, genau eine Abbuchung nach Annahme, Bestellstatus
   und Erstattung vergleichen. Bestell- und Zahlungsreferenzen ohne Kundendaten im Freigabeprotokoll
   dokumentieren.
4. Zum Stoppen neuer Zahlungen `ONLINE_LIVE_PAYMENT_ENABLED` in der API und
   `PUBLIC_LIVE_ONLINE_PAYMENT_ENABLED` im Shop deaktivieren. Die Live-Verarbeitung, den Zeitplan
   und den Webhook bis zur Abwicklung laufender Zahlungen und Erstattungen aktiv lassen. Bei einem
   Rollback muss der API-Stand Live-Auftr?ge weiterhin abgleichen k?nnen. Der externe
   Bestellmail-Versand bleibt bis zur separaten Abnahme deaktiviert.
