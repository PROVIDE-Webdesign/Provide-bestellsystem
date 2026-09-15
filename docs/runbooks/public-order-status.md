# Öffentlichen Gast-Bestellstatus sicher prüfen

## Schutzstatus

1. `ORDER_STATUS_READ_ENABLED` bleibt in den Repository-Vorgaben `false`.
2. `ORDER_STATUS_TOKEN_SECRET` und `ORDER_STATUS_TOKEN_SECRET_PREVIOUS` sind Server-Secrets und
   dürfen nicht im Repository, Browser, Log oder Screenshot erscheinen.
3. Der Checkout bleibt geschlossen, solange Statusleseweg und aktuelles Secret fehlen.
4. Tests verwenden ausschließlich die synthetische Storefront-Fixture.
5. Aktivierung und Deployment benötigen eine gesonderte Freigabe.

## Lokale Testkonfiguration

Eine isolierte lokale Prüfung darf folgende nicht produktive Werte verwenden:

```dotenv
ORDER_STATUS_READ_ENABLED=true
ORDER_STATUS_TOKEN_SECRET=synthetic-local-status-secret-at-least-32-bytes
HYPERDRIVE_CACHE_DISABLED=true
```

Das optionale vorherige Secret wird nur für einen Rotationstest gesetzt. Ein reales Secret wird mit
`wrangler secret put ORDER_STATUS_TOKEN_SECRET` getrennt je Umgebung verwaltet und niemals als
`vars`-Eintrag committed.

## Prüfkette

1. `pnpm check`
2. `supabase test db`
3. Worker-/PostgreSQL-Integration mit einer expliziten Loopback-`TEST_DATABASE_URL`
4. Nachweis von `submitted` und einer autorisierten Statusänderung
5. Negativprüfungen für manipulierte Tokens, fremde Mandanten, abgelaufene Abrufe und PII
6. GitHub-Pflichtprüfungen `check` und `database`

## Rotation

1. Neues Secret als `ORDER_STATUS_TOKEN_SECRET` setzen.
2. Bisheriges Secret vorübergehend als `ORDER_STATUS_TOKEN_SECRET_PREVIOUS` setzen.
3. Nach Ablauf des längsten aktiven 48-Stunden-Fensters das vorherige Secret entfernen.
4. Jede vermutete Offenlegung erzwingt eine sofortige Rotation; dabei kann ein kompromittiertes
   Token bewusst vorzeitig ungültig werden.
