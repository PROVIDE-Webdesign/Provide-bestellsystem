# API-Spike

Cloudflare-Worker mit einer abgesicherten Anfragegrundlage. Der Worker enthält weiterhin keine
Bestelllogik und keine Geschäfts-Endpunkte.

## Endpunkte

1. `GET /health` prüft Worker und Bindings ohne Datenbankzugriff.
2. `GET /health/database` führt ausschließlich `SELECT 1` aus.
3. Jede JSON-Antwort enthält eine Request-ID. Fehler verwenden einen festen Fehlercode und geben
   keine internen Verbindungs- oder Exception-Details aus.

## Anfragegrenzen

1. CORS antwortet nur für ausdrücklich konfigurierte Origins (`API_ALLOWED_ORIGINS`).
2. Die erlaubte API-Oberfläche ist exakt auf die dokumentierten `GET`-Endpunkte begrenzt.
3. Zukünftige JSON-Anfragen müssen `application/json` senden und sind auf 64 KiB begrenzt.
4. Request-IDs, Sicherheits-Header und PII-freies Fehler-Logging gelten zentral für alle späteren
   Endpunkte.

Die eingetragene Hyperdrive-ID ist absichtlich ein ungültiger Platzhalter. Vor einem Preview-Deploy
muss sie nach dem Runbook durch die ID der getrennten Preview-Konfiguration ersetzt werden.
