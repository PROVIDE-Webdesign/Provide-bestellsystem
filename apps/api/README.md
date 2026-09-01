# API-Spike

Cloudflare-Worker zur Prüfung der PostgreSQL-Verbindung über Hyperdrive. Der Worker enthält nur
technische Gesundheitsendpunkte und keine Bestelllogik.

## Endpunkte

1. `GET /health` prüft Worker und Bindings ohne Datenbankzugriff.
2. `GET /health/database` führt ausschließlich `SELECT 1` aus.

Die eingetragene Hyperdrive-ID ist absichtlich ein ungültiger Platzhalter. Vor einem Preview-Deploy
muss sie nach dem Runbook durch die ID der getrennten Preview-Konfiguration ersetzt werden.
