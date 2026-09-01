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

| Variable                | Sichtbarkeit | Zweck                                         |
| ----------------------- | ------------ | --------------------------------------------- |
| `APP_ENV`               | Öffentlich   | Aktuelle Laufzeitumgebung                     |
| `PUBLIC_STOREFRONT_URL` | Öffentlich   | Basisadresse der Kundenoberfläche             |
| `PUBLIC_DASHBOARD_URL`  | Öffentlich   | Basisadresse des Dashboards                   |
| `PUBLIC_API_URL`        | Öffentlich   | Öffentliche API-Basisadresse                  |
| `DATABASE_URL`          | Nur Server   | PostgreSQL-Verbindung der jeweiligen Umgebung |
| `AUTH_SESSION_SECRET`   | Nur Server   | Signierung und Schutz von Sitzungen           |

Neue Variablen werden erst nach Einordnung als öffentlich oder serverseitig ergänzt. Anbieterwerte
für Stripe, Supabase, E-Mail oder Adressprüfung werden erst mit dem jeweiligen Technikblock
aufgenommen.

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
