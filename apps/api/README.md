# API

Cloudflare-Worker mit einer abgesicherten Anfragegrundlage. Arbeitsblock 3.2 ergänzt öffentliche,
ausschließlich lesende Katalog- und Bestellbarkeitsendpunkte sowie einen standardmäßig gesperrten
Gast-Checkout für Abholbestellungen und einen standardmäßig gesperrten Gast-Bestellstatus.

## Endpunkte

1. `GET /health` prüft Worker und Bindings ohne Datenbankzugriff.
2. `GET /health/database` führt ausschließlich `SELECT 1` aus.
3. Jede JSON-Antwort enthält eine Request-ID. Fehler verwenden einen festen Fehlercode und geben
   keine internen Verbindungs- oder Exception-Details aus.

## Anfragegrenzen

1. CORS antwortet nur für ausdrücklich konfigurierte Origins (`API_ALLOWED_ORIGINS`).
2. Die API-Oberfläche ist auf die dokumentierten Methoden und Endpunkte begrenzt.
3. JSON-Anfragen müssen `application/json` senden und sind standardmäßig auf 64 KiB begrenzt; die
   Statusanfrage besitzt eine engere 4-KiB-Grenze.
4. Request-IDs, Sicherheits-Header und PII-freies Fehler-Logging gelten zentral für alle späteren
   Endpunkte.

Die eingetragene Hyperdrive-ID ist absichtlich ein ungültiger Platzhalter. Vor einem Preview-Deploy
muss sie nach dem Runbook durch die ID der getrennten Preview-Konfiguration ersetzt werden.

## Öffentliche Storefront

1. `GET /v1/storefront/{restaurantSlug}/{locationSlug}/catalog`
2. `GET /v1/storefront/{restaurantSlug}/{locationSlug}/availability`
3. `POST /v1/storefront/{restaurantSlug}/{locationSlug}/orders`
4. `POST /v1/storefront/{restaurantSlug}/{locationSlug}/order-status`

Parameter, Datenbank-/Cachegrenze und lokale Prüfung stehen im
[Storefront-Runbook](../../docs/runbooks/public-storefront.md). Der Checkout-POST-Endpunkt ist nur
mit `CHECKOUT_WRITE_ENABLED=true`, sicher konfiguriertem Statusweg, verifizierter
Hyperdrive-Konfiguration, gültiger Datenschutzhinweis-Version und serverseitiger Aufbewahrungsdauer
verwendbar. Er erzwingt Abholung und Zahlung bei Übergabe. Ohne diese Konfiguration nimmt die API
keine Bestellung an. Der Status-POST-Endpunkt verwendet den JSON-Körper, damit seine
HMAC-Berechtigung nie in einer URL steht. Details stehen im
[Status-Runbook](../../docs/runbooks/public-order-status.md).

## Geschützter Dashboard-Zugang

`GET /v1/dashboard/access-context` akzeptiert ausschließlich ein Supabase-Zugriffstoken im
`Authorization: Bearer`-Header. Die API prüft Signatur und Claims gegen die konfigurierte
Supabase-JWKS, bevor die serverexklusive Datenbankprojektion aktuelle Mitgliedschaft, MFA-Zustand
und Standortumfang ermittelt. Ohne `DASHBOARD_AUTH_ENABLED=true`, sichere Auth-Konfiguration und
cachedeaktivierte Hyperdrive-Verbindung bleibt der Endpunkt geschlossen. Details stehen im
[Dashboard-Auth-Runbook](../../docs/runbooks/dashboard-authentication.md).
