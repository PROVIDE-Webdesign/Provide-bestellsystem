# API

Cloudflare-Worker mit einer abgesicherten Anfragegrundlage. Arbeitsblock 3.2 ergänzt öffentliche,
ausschließlich lesende Katalog- und Bestellbarkeitsendpunkte.

## Endpunkte

1. `GET /health` prüft Worker und Bindings ohne Datenbankzugriff.
2. `GET /health/database` führt ausschließlich `SELECT 1` aus.
3. Jede JSON-Antwort enthält eine Request-ID. Fehler verwenden einen festen Fehlercode und geben
   keine internen Verbindungs- oder Exception-Details aus.

## Anfragegrenzen

1. CORS antwortet nur für ausdrücklich konfigurierte Origins (`API_ALLOWED_ORIGINS`).
2. Die API-Oberfläche ist auf die dokumentierten `GET`-Endpunkte begrenzt.
3. Zukünftige JSON-Anfragen müssen `application/json` senden und sind auf 64 KiB begrenzt.
4. Request-IDs, Sicherheits-Header und PII-freies Fehler-Logging gelten zentral für alle späteren
   Endpunkte.

Die eingetragene Hyperdrive-ID ist absichtlich ein ungültiger Platzhalter. Vor einem Preview-Deploy
muss sie nach dem Runbook durch die ID der getrennten Preview-Konfiguration ersetzt werden.

## Öffentliche Storefront

1. `GET /v1/storefront/{restaurantSlug}/{locationSlug}/catalog`
2. `GET /v1/storefront/{restaurantSlug}/{locationSlug}/availability`

Parameter, Datenbank-/Cachegrenze und lokale Prüfung stehen im
[Storefront-Runbook](../../docs/runbooks/public-storefront.md). Diese Endpunkte schreiben keine
Bestellungen, persönlichen Daten oder Reservierungen.
