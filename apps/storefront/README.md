# Storefront

Die Kundenoberfläche zeigt veröffentlichte Speisekarten, prüft die Bestellbarkeit und enthält einen
Warenkorb mit Gast-Checkout für Abholbestellungen. Der API-Schreibweg bleibt standardmäßig gesperrt;
es gibt weiterhin keinen produktiven Bestellbetrieb. Einstieg pro Standort:
`/r/{restaurantSlug}/{locationSlug}`. Sie verwendet zentrale Contracts und vermittelt öffentliche
GET-Anfragen an die API. Server-Geheimnisse gelangen nicht in die Oberfläche.

1. `pnpm dev` startet die lokale vinext-Entwicklung.
2. `pnpm build` erzeugt das Worker-Bundle.
3. `pnpm start` startet das gebaute Bundle lokal.
4. `pnpm deploy:preview` benötigt weiterhin eine ausdrückliche Rollout-Freigabe.

Konfiguration, synthetische Fixtures und Testablauf stehen im
[Storefront-Runbook](../../docs/runbooks/public-storefront.md).

Die bestehende Asian-Kitchen-Website ist ein getrenntes Projekt. Diese Oberfläche verändert sie
nicht.
