# Transaktionale E-Mails: Betrieb und Abnahme

## Konfiguration

`EMAIL_DISPATCH_ENABLED` ist standardmäßig aus. Verarbeitung benötigt zusätzlich `HYPERDRIVE`,
`HYPERDRIVE_CACHE_DISABLED=true`, einen gültigen `ORDER_STATUS_TOKEN_SECRET`, eine reine
HTTPS-Origin in `EMAIL_STOREFRONT_ORIGIN` und einen ausdrücklich injizierten Adapter. Ohne diese
Voraussetzungen wird kein Claim begonnen. Die reguläre Anwendung liefert noch keinen realen Adapter.

Der synthetische Adapter ist ein Testdouble im Arbeitsspeicher. Sein Idempotenzregister darf nicht
als dauerhafter Anbieternachweis verwendet werden. Er arbeitet nur mit Adressen unter
`@example.invalid`. Tests setzen die Gates explizit und verwenden eine disposable
lokale/CI-Datenbank.

## Zustände und Fehlerbehandlung

| Zustand      | Aussage                                       | Nächster Schritt                                                  |
| ------------ | --------------------------------------------- | ----------------------------------------------------------------- |
| queued/retry | Noch keine bestätigte Anbieterannahme         | Bounded Worker-Claim nach Termin                                  |
| processing   | Ein Worker hält den Claim                     | Nur derselbe Lock darf abschließen                                |
| uncertain    | Annahme könnte bereits erfolgt sein           | Anbieterabgleich mit unverändertem Idempotenzschlüssel            |
| accepted     | Anbieter hat die Nachricht angenommen         | Zustellnachweis abwarten                                          |
| delivered    | Passender expliziter Zustellnachweis          | Kein erneuter Versand                                             |
| bounced      | Passender Ablehnungsnachweis nach Annahme     | Kundenstatus bleibt verfügbar                                     |
| suppressed   | Kontakt, Ablauf, Scope oder Ereignis überholt | Kein Versand; Ursache nachvollziehbar                             |
| dead_letter  | Permanenter Fehler oder Versuchsgrenze        | Rollenbegrenzte Prüfung; unbekannte Annahme nie blind wiederholen |

Temporäre eindeutige Fehler erhalten 30 Sekunden, 2 Minuten, 10 Minuten, 30 Minuten, danach 2
Stunden Abstand. Ein Claim läuft nach fünf Minuten ab und wird als unklare Annahme abgeglichen. Nur
ein autoritatives `not_found` aus diesem Abgleich erlaubt einen erneuten Sendeversuch.
Anbieterannahme und Zustellung sind unterschiedliche Nachweise. Der vorhandene SMS-Zustand `sent`
ändert seine Bedeutung durch dieses Paket nicht.

`private.retry_email_delivery` beschränkt Wiederholungen auf Owner/Manager mit MFA, gleichen
Restaurant-/Standortscope und geeignete bekannte Fehler. `private.email_retry_events` protokolliert
Akteur und bisherigen Fehler. Die spätere Supportoberfläche kann diesen Vertrag nutzen. Direkte
Tabellenrechte für Browser und Service-Rolle bleiben gesperrt.

`private.record_email_delivery_receipt` ist nur ein interner Vertrag für einen bereits bestätigten
Anbieterbezug. Ein realer, signaturgeprüfter Anbieter-Receipt-Endpunkt ist noch nicht eingerichtet;
unverifizierte externe Events dürfen diese Funktion niemals erreichen. Widersprüchliche finale
Zustellnachweise werden abgewiesen.

Logs enthalten ausschließlich feste Fehlerklassen und Request-ID. E-Mail-Adressen, Texte,
Zugriffstoken und rohe Anbieterantworten gehören nicht in Logs, Outbox oder Versandledger.
Nachrichten enthalten keine vollständige Lieferadresse. Kontakt-Purge und Ablaufprüfung gelten auch
für Mail.

## Bedienung

Der Checkout verlangt eine gültige E-Mail-Adresse; dadurch ist keine Postfach-Erreichbarkeit
bewiesen. Annahme bestätigt zunächst den gewünschten Zeitpunkt. Im Bestelldetail lässt sich die
bestätigte Zeit in der Restaurant-Zeitzone korrigieren. Mehrdeutige oder nicht existierende
Sommerzeit-Uhrzeiten werden zurückgewiesen.

Bei Lieferung ist „Zur Auslieferung bereit“ ein eigener Schritt. Owner/Manager bestätigen danach
ausdrücklich „Lieferung als unterwegs“. Das löst erst die Unterwegs-Nachricht aus.
Ablehnung/Stornierung verwenden den angebotenen Grund. Status- und Revisionskonflikte verlangen
erneutes Laden des aktuellen Stands.

## Nachweise

Automatische Prüfungen umfassen:

1. Pflichtkontakt im gemeinsamen Requestvertrag und in der Datenbank.
2. Offene Onlinezahlung ohne E-Mail, bestätigte Erstattung mit serverseitigem Betrag.
3. Claims, Konkurrenz, falscher Lock, unbekannte Annahme und fehlgeschlagener Abgleich.
4. Anbieterannahme getrennt von Zustellung, doppelte/widersprüchliche Receipts.
5. Mandantentrennung, Management-MFA, stale Revision, Audit und manueller Retry.
6. Überholte Annahme versus neueste Zeitkorrektur und intakter Bestellstatus bei Mailfehler.
7. HTML-Escaping, Text/HTML-Inhalt, Restaurantzeit, sichere Fragmentfähigkeit.
8. API/Repository/Worker gegen die migrierte PostgreSQL-Datenbank.

Pflichtläufe: `pnpm check`, `supabase test db` und
`TEST_DATABASE_URL=… pnpm --filter @provide/api exec vitest run src/storefront.integration.test.ts`.
Die Datenbank muss ausdrücklich disposable und unter Loopback erreichbar sein.

Der vollständige Bediennachweis auf einem Gerät und eine echte Anbieter-Zustellprüfung sind hiervon
getrennt. Die offene Zahlungsabnahme von PR #8 bleibt bestehen. Technische Endfreigabe, Merge und
Deployment sind noch keine Folge erfolgreicher automatisierter Tests.
