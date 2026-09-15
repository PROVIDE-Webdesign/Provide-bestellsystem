# Runbook: Dashboard-Bestellbetrieb

## Sichere Aktivierung

Der Bestellbetrieb benötigt alle Voraussetzungen des Dashboard-Auth-Runbooks und zusätzlich
`DASHBOARD_ORDER_OPERATIONS_ENABLED=true`. Der Standardwert ist `false`. Vor Preview oder Produktion
müssen die feste Dashboard-API-Origin, CORS-Origin, Supabase-Issuer/Audience und die
cachedeaktivierte Hyperdrive-Verbindung gemeinsam geprüft werden.

## Endpunkte

1. `GET /v1/dashboard/restaurants/{restaurantId}/locations/{locationId}/orders`
2. `GET /v1/dashboard/restaurants/{restaurantId}/locations/{locationId}/orders/{orderId}`
3. `POST /v1/dashboard/restaurants/{restaurantId}/locations/{locationId}/orders/{orderId}/status`

Die Liste akzeptiert höchstens je einmal `status`, `cursor` und `limit`; `limit` liegt zwischen 1
und 50. Der Statuskörper enthält ausschließlich `expectedStatus` und `targetStatus`. Alle Antworten
sind `no-store`. Bearer-Token werden nur serverseitig an die feste API-Origin weitergegeben.

## Rollen

| Rolle   | AAL  | Standortumfang | Kontakt   | Statusbefehle                                     |
| ------- | ---- | -------------- | --------- | ------------------------------------------------- |
| Owner   | aal2 | alle eigenen   | Abholname | alle gültigen Vorwärtsübergänge                   |
| Manager | aal2 | zugewiesene    | Abholname | alle gültigen Vorwärtsübergänge                   |
| Küche   | aal1 | zugewiesene    | keiner    | annehmen, Zubereitung starten, abholbereit melden |
| Fahrer  | –    | keiner         | keiner    | keine                                             |

Telefon, E-Mail und Lieferdaten sind nie Teil der Projektionen. Bei `409` muss die Ansicht neu
geladen werden, bevor ein weiterer Statusbefehl gesendet wird.

## Störungsbehandlung

1. `401`: Sitzung neu aufbauen oder erneut anmelden.
2. `403`: Mitgliedschaft, AAL, Rolle und Standortzuweisung prüfen; keine Rechte umgehen.
3. `404`: Bestell- und Mandantenbezug prüfen; fremde Bestellungen bleiben verborgen.
4. `409`: Bestellung aktualisieren und den neuen Status anzeigen.
5. `503`: Feature Gate, Auth-Konfiguration und Hyperdrive prüfen; geschlossen lassen.

Logs enthalten ausschließlich generische Ereignisnamen und Request-IDs, keine Token, Kontaktwerte,
Bestellpositionen oder Datenbankfehler.

## Nachweis

`pnpm check` prüft Verträge, API, Gateway, UI-Hilfen und Builds. Das CI-Gate `database` führt die
Migration, pgTAP-Rollen-/Mandanten-/PII-/Pagination-/Statusprüfungen und den HTTP-zu-PostgreSQL-Test
in einer frischen synthetischen Datenbank aus.
