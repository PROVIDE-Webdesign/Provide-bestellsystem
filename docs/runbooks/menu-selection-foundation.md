# Menüauswahl und Preisfundament prüfen

## Voraussetzungen und Migration

Nur eine disposable lokale/CI-Datenbank verwenden. Keine bestehende Produktionsdatenbank oder echte
Pilotdaten für diese Prüfung zurücksetzen. Die additive Migration
`20260930182025_menu_selection_foundation.sql` setzt den finalen E-Mail-Paketstand voraus. Supabase
CLI bleibt bei der im Repository festgelegten Version 2.117.0.

```bash
pnpm check
supabase db start
supabase test db
supabase db advisors --local --type security --level warn --fail-on error
pnpm --filter @provide/contracts build
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  pnpm --filter @provide/api exec vitest run src/storefront.integration.test.ts
```

Der Integrationslauf verwendet ausschließlich synthetische Kontakte und eine künstliche
Menükonfiguration. Er ergänzt den bestehenden Checkout-/Payment-/E-Mail-Nachweis und stellt die
ursprüngliche veröffentlichte Menüversion wieder her. Kein Stripe-Checkout und keine reale E-Mail
werden ausgelöst. Die API-Einreichung prüft lediglich den intern angelegten Zahlungsauftrag.

## Prüffälle

| Grenze        | Nachweis                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| Konfiguration | Schema, ID-Eindeutigkeit, Informationen bestätigt, aktive Auswahl, Gruppenmin/max, Betragsgrenzen                 |
| Verwaltung    | Owner/Manager, explizites MFA, fremder Owner abgewiesen, Draftrevision, Audit, Veröffentlichung eingefroren       |
| Preis         | Basis + Variante + Extras, Menge, enthaltene Steuer, Fremdauswahl und manipulierte Preise abgewiesen              |
| Vorschau      | Öffentliche Gates, veraltete Version, strukturierter Auswahlkonflikt, keine Bestellung/Reservierung               |
| Einreichung   | Reale API/PostgreSQL-Abholung, Lieferung und Online-Zahlungsauftrag übernehmen dieselben Preise                   |
| Parallelität  | Checkout wartet tatsächlich auf PostgreSQL-Menüsperre; spätere Veröffentlichung erzwingt Konflikt ohne Bestellung |
| Historie      | Snapshot bleibt nach Rollback erhalten; identische Wiederholung liefert dieselbe Bestellung                       |
| Sicherheit    | Vollständige RLS-/ACL-Regressionen und Security Advisors ohne neue Befunde                                        |

## Entwicklungszugänge

Die Cart-Quote ist eine API-Fundamentroute. Für isolierte Tests aktiviert der Testaufruf
`CART_QUOTE_ENABLED=true`; es wird kein Runtime-Gate im Repository eingeschaltet. Hyperdrive muss
`HYPERDRIVE_CACHE_DISABLED=true` und eine serverseitige Verbindung bereitstellen. Die Antwort ist
`no-store`. Browser dürfen weder private SQL-Funktionen noch `service_role`-Secrets verwenden.

Die Entwurfs-Konfiguration wird bisher über den internen kontrollierten Befehl
`private.set_menu_item_configuration` geschrieben. Seine Actor-/AAL-Argumente stammen später aus
einer verifizierten Dashboard-Sitzung. Ein Client darf diese Argumente nicht frei vorgeben.

Reale Menüdeklarationen müssen vom Betrieb geprüft sein. `NULL` aus Altbeständen bleibt unbekannt;
leere deklarierte Listen bei `informationConfirmed=true` sind eine ausdrückliche neue Angabe. Der
Teststeuersatz ist keine Betriebsvorgabe. Ein Menü mit Pflichtvarianten soll erst nach
Fertigstellung der Auswahloberfläche im Kundensystem veröffentlicht werden.

## Abschluss

Der Entwurfs-PR führt finale Commit-ID, identischen lokalen/remote Git-Baum, CI-Lauf und Testzahlen.
Ein älterer grüner Lauf gilt nicht als Nachweis für spätere Änderungen. Technische Nutzerabnahme,
Pilotimport, Merge, Deployment und Liveaktivierung bleiben getrennte Schritte.
