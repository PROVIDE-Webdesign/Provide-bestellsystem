# Gast-Abholcheckout sicher prüfen

## Schutzstatus

1. `CHECKOUT_WRITE_ENABLED` bleibt in Repository- und Preview-Vorgaben `false`.
2. Tests verwenden ausschließlich die synthetische Storefront-Fixture.
3. Echte Namen, Telefonnummern, E-Mail-Adressen und Bestellungen sind nicht zugelassen.
4. Eine Aktivierung oder ein Deployment benötigt eine gesonderte Freigabe.

## Lokale Einstellungen

Für einen ausdrücklich isolierten Testlauf werden ausschließlich ungefährliche lokale Werte
verwendet:

```dotenv
CHECKOUT_WRITE_ENABLED=true
CHECKOUT_PRIVACY_NOTICE_VERSION=preview-v1
CHECKOUT_RETENTION_DAYS=30
HYPERDRIVE_CACHE_DISABLED=true
```

`CHECKOUT_RETENTION_DAYS=30` ist nur ein synthetischer Testwert und keine rechtliche Empfehlung. Vor
einem Pilotbetrieb müssen Datenschutzhinweis und tatsächliche Aufbewahrungsfrist separat geprüft und
freigegeben werden.

## Prüfkette

1. `pnpm check`
2. `supabase test db`
3. API-/PostgreSQL-Integrationstest mit expliziter Loopback-`TEST_DATABASE_URL`
4. GitHub-Pflichtprüfungen `check` und `database`

Der erfolgreiche Test beweist die technische Transaktion, nicht die Freigabe für echte Daten oder
einen produktiven Betrieb.
