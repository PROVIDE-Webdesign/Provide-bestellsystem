# Dashboard-Authentifizierung

## Sichere Voreinstellung

`DASHBOARD_AUTH_ENABLED=false` bleibt in Repository und Preview-Konfiguration gesetzt. Ohne gültige
Supabase-URL, Publishable Key, API-Basisadresse, Auth-Aussteller, Publikum und Hyperdrive-Verbindung
antwortet der Zugriff geschlossen. Kein Secret wird im Repository hinterlegt.

## Laufzeitwerte

Dashboard:

1. `DASHBOARD_AUTH_ENABLED=true`
2. `NEXT_PUBLIC_SUPABASE_URL` als reine HTTPS-Projekt-Origin
3. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` als ausdrücklich öffentlicher Projektschlüssel
4. `DASHBOARD_API_BASE_URL` als feste HTTPS-Origin der Worker-API

API:

1. `DASHBOARD_AUTH_ENABLED=true`
2. `SUPABASE_AUTH_ISSUER=https://<project>.supabase.co/auth/v1`
3. `SUPABASE_AUTH_AUDIENCE=authenticated`
4. verifizierte, cachedeaktivierte Hyperdrive-Verbindung

Die Werte werden erst an einem getrennt freigegebenen Preview-Gate gesetzt. Service-Role-Key,
Passwörter, JWTs und TOTP-Daten gehören niemals in Cloudflare-Variablen, Logs oder das Repository,
sofern die konkrete Laufzeit sie nicht ausdrücklich als Secret benötigt. Die API benötigt für die
JWT-Prüfung nur die öffentlichen JWKS.

## Ablauf

1. Browser meldet sich über den offiziellen Supabase-Client an.
2. Dashboard-Server validiert die Cookie-Sitzung mit `getClaims()`.
3. Der rohe Zugriffstoken wird ausschließlich serverseitig an `GET /v1/dashboard/access-context`
   weitergeleitet.
4. Die API validiert Token und Claims erneut.
5. Die Datenbank ermittelt aktuelle Mitgliedschaft, Rolle, Suspendierung, MFA-Anforderung und
   Standortumfang.
6. Owner/Manager mit `aal1` werden zur TOTP-Challenge geleitet; nach erfolgreicher Challenge wird
   der Zugriffskontext neu geladen.

## Störungsbild

1. `401`: Sitzung fehlt, ist abgelaufen oder kryptografisch ungültig. Neu anmelden.
2. `503`: Feature-Gate oder Konfiguration ist geschlossen, JWKS/Auth nicht erreichbar oder die
   Datenbankantwort verletzt den Contract. Keine Werte aus Fehlermeldungen protokollieren.
3. `mfa_required`: TOTP einrichten oder bestätigen.
4. `suspended`: keine Umgehung versuchen; Mitgliedschaft muss über einen späteren autorisierten
   Verwaltungsablauf reaktiviert werden.
5. Leere Standortliste: Zuweisung durch einen autorisierten Owner/Manager ist erforderlich.
