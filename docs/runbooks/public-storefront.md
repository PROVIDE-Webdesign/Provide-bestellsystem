# Öffentliche Storefront lokal prüfen

## Routen und Verträge

| Oberfläche         | Route                                                                         |
| ------------------ | ----------------------------------------------------------------------------- |
| Restaurantseite    | `/r/{restaurantSlug}/{locationSlug}`                                          |
| API-Katalog        | `GET /v1/storefront/{restaurantSlug}/{locationSlug}/catalog`                  |
| API-Bestellbarkeit | `GET /v1/storefront/{restaurantSlug}/{locationSlug}/availability`             |
| Storefront-Gateway | `GET /api/storefront/{restaurantSlug}/{locationSlug}/{catalog\|availability}` |

Die Bestellbarkeitsabfrage benötigt exakt `fulfillmentType=pickup|delivery`, `requestedFor` als
RFC3339-Zeitpunkt mit Sekunden und `Z` oder explizitem Offset sowie `itemCount=1..1000`. Ein
positives Ergebnis ist eine aktuelle Kapazitätsauskunft; es reserviert weder einen Slot noch
Gerichte. Ein Lieferstatus validiert weder Liefergebiet noch Adresse.

Katalogabfragen akzeptieren keine Query-Parameter. Die API behält die Erfolgshülle
`{data,requestId}` und die Fehlerhülle aus 3.1. Das Storefront-Gateway gibt `{data}` bzw. einen
minimierten Fehlercode weiter und entfernt interne Fehlertexte.

## Synthetische lokale Umgebung

1. `pnpm install --frozen-lockfile`, anschließend `pnpm --filter @provide/contracts build`.
2. Supabase lokal mit `pnpm db:start` starten und alle Migrationen anwenden. Nur eine frische,
   wegwerfbare Testdatenbank verwenden.
3. `pnpm db:test` ausführen. Die neue pgTAP-Datei lädt `supabase/tests/fixtures/storefront.sql`
   innerhalb ihrer zurückgerollten Testtransaktion.
4. Für die zusätzliche API-/Treiberprüfung `TEST_DATABASE_URL` ausschließlich auf diese lokale
   Datenbank setzen, dann
   `pnpm --filter @provide/api exec vitest run src/storefront.integration.test.ts` ausführen. Dieser
   Test lädt die Fixture dauerhaft in die wegwerfbare Datenbank; vor einer Wiederholung die
   Datenbank neu aufsetzen. Er wird im GitHub-Job `database` nach pgTAP ausgeführt.
5. Für eine interaktive lokale Vorschau die synthetische SQL-Fixture in eine eigene frische lokale
   Datenbank laden. Sie darf nicht in Preview oder Produktion eingespielt werden.
6. Für Wrangler eine lokale Hyperdrive-Verbindung mit der Variable
   `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` auf diese Datenbank konfigurieren.
   Lokale Overrides können `HYPERDRIVE_CACHE_DISABLED=true` nutzen; die lokale Verbindung besitzt
   keinen entfernten Hyperdrive-Cache. Server auf Loopback starten.
7. Die Storefront erhält `PUBLIC_API_URL=http://127.0.0.1:8787` über eine lokale, ignorierte
   `.dev.vars` in `apps/storefront`. Im API-Worker die lokalen Overrides ebenfalls ausschließlich in
   ignorierten Dateien/Umgebungsvariablen hinterlegen.
8. `/r/storefront-restaurant-a/storefront-a-mitte` öffnen. Erwartet werden die „PROVIDE Testküche“,
   die Preise 12,50 EUR und 3,00 EUR sowie eine Kapazitätsprüfung für Abholung. Lieferung ist in
   dieser Fixture deaktiviert; ein inaktives Testgericht darf nicht erscheinen.

Fixtures sind keine produktiven Restaurantdaten. Keine globalen Seed- oder Deploy-Automatismen
aktivieren. `supabase/config.toml` lässt automatisches Seeding weiterhin ausgeschaltet.

## Vor einem ausdrücklich freigegebenen Preview-Rollout

1. Getrennte Preview-Datenbank, Worker-Konfigurationen und synthetische Daten bereitstellen.
2. Hyperdrive-Konfiguration auf deaktiviertes Query-Caching prüfen und dies dokumentieren. Danach
   `HYPERDRIVE_CACHE_DISABLED=true` setzen. Der Repository-Standard `false` verweigert öffentliche
   Datenbankabfragen. Die Variable ersetzt die Prüfung der tatsächlichen Hyperdrive-Konfiguration
   nicht.
3. Gültige API-Basis-URL ohne Zugangsdaten, Query oder Pfad und die CORS-Positivliste setzen.
4. Laufzeitrechte (`SET ROLE service_role`), Sperren, Verfügbarkeitswechsel und Header gegen die
   echte Preview-Konfiguration erneut prüfen. Verbindung nicht als Browser-Secret veröffentlichen.
5. Gesonderte Rollout-Freigabe einholen. Ein lokaler Browserlauf ist keine Preview-Freigabe.

## Akzeptanz und verbleibende Nachweise

Pflicht bleiben `pnpm check`, alle pgTAP-Tests, die neue API-/PostgreSQL-Integration und beide
grünen GitHub-Jobs für den tatsächlichen PR-Commit. Lokale alternative PostgreSQL-Laufzeiten
ersetzen weder Supabase/PostgreSQL 15 noch Hyperdrive-/Worker-Integration in der späteren Vorschau.
