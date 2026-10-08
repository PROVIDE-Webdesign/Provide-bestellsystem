# O3: Checkout-Sitzung und atomarer Missbrauchsschutz

Grundlage: A2 §5/§7/§8/§11/§15, E30, bestätigte O3-D01-D12 und Umsetzungsauftrag vom 08.10.2026.
Getrennter Draft-PR23 basiert ausschließlich auf dem freigegebenen PR22-Head
`9d734c48c34fad2d07f592be085c898ca15c2e26`. Kein Ready-Wechsel, Merge oder Deployment.

## Browsernachweis und Gateway

R23-01 ergänzt die clientseitige Fortsetzungsgrenze: Receipt, Bootstrap und Intent-Ausstellung
dürfen nach Scopewechsel oder Unmount keine Zustände oder Recoverymetadaten mehr verändern.
AbortSignal allein genügt nicht; Clientgeneration und Identität des aktuellen Schutzvorgangs werden
auch nach asynchroner Bodyverarbeitung geprüft. Nur aktuelle Fortsetzungen dürfen Bestätigung,
Warenkorb, Fehlermeldung und Fokus übernehmen. Der gültige aktuelle Restorepfad bleibt erhalten;
Bestellschreiben erfordert weiterhin den ausdrücklichen Benutzerauftrag.

Der eigene Bootstrap erzeugt serverseitig einen kryptografisch zufälligen 256-Bit-Verifier. Nur
`__Host-provide-checkout` enthält ihn: Secure, HttpOnly, SameSite=Lax, Path=/, ohne Domain. Die
Datenbank erhält ausschließlich SHA-256. Ein unbekannter mitgebrachter Cookie darf keinen neuen
Kontext anlegen. Ein Bootstrap verlängert vorhandene Fristen nicht. Ein erfolgreicher neuer
Challenge-Intent verlängert den Browserkontext auf 90 Minuten; ältere Intentfristen bleiben fest.
Browserkontext und Checkout sind keine Supabase-Auth-Identität und verleihen keine Betriebsrechte.

Öffentliche Sitzungs-ID und Abgabeschlüssel sind allein keine Berechtigung. Der Gateway prüft bei
POST exakt die konfigurierte HTTPS-Origin, JSON, einen eigenen Bootstrapheader beziehungsweise einen
HMAC-CSRF-Nachweis mit Bindung an den Verifier-Hash. CSRF bleibt im Arbeitsspeicher. SameSite und
CORS ersetzen diese Prüfung nicht. Requests und Antworten werden anhand bestehender Contracts
minimiert. Browser-Cookie, Authorization, freie IP-Header und gefälschte Attestationen gelangen
nicht zur API. Fehler behalten ausschließlich feste Codes und einen geprüften Retry-After von 1-600
Sekunden; Upstream-Cookies, Redirects und private Fehlertexte werden entfernt.

Jeder öffentliche API-Aufruf bei aktiviertem O3 benötigt eine serverseitige Gateway-HMAC über
Methode, Pfad einschließlich Query, Digest der exakten UTF-8-JSON-Bytes, Kontext-Hash,
Netzpseudonyme, UTC-Millisekunden, Epoche und Nonce. Höchstens 30 Sekunden alte Attestationen
gelten; bis zwei Sekunden Uhrabweichung in die Zukunft sind zulässig. PostgreSQL verbraucht jede
Nonce atomar einmal. Wiederholungen behalten den Abgabeschlüssel, erhalten aber eine neue
Transport-Nonce. Ein Alt-Gatewaysecret benötigt eine absolute UTC-Frist von höchstens 30 Sekunden ab
Konfiguration; nach dieser Frist kann auch eine neu signierte Anfrage nicht mehr damit eintreten.

JSON wird gestreamt, auf tatsächliche Bytezahl begrenzt und strikt als UTF-8 gelesen: 1 KiB
Bootstrap, 64 KiB übriger POST, 8 KiB Siteverify, 16 KiB Checkout-Antworten; öffentliche Kataloge
sind separat auf 1 MiB begrenzt. Content-Length allein ist kein Nachweis. URLs sind höchstens 2.048
Zeichen lang. POST-Queryparameter und unbekannte Eingabefelder werden abgewiesen.

## Challenge und feste Fristen

Turnstile ist ausschließlich vor Ausstellung/Erneuerung nötig. Der Backendadapter begrenzt
Siteverify auf fünf Sekunden und prüft success, eigene hostname, action `checkout_issue`, cdata mit
derselben Issue-UUID und höchstens fünf Minuten altes challenge_ts. Roh-Challenges werden nicht
gespeichert. Der private Claim bindet Challenge-Hash und Issue-UUID an Kontext, Scope,
Abgabeschlüssel und gegebenenfalls Erneuerung. Eine verlorene Provider-/HTTP-Antwort wird bei
bewusster Wiederholung mit exakt denselben Angaben und derselben Siteverify-idempotency_key
abgefragt. Erfolgreiche Claims liefern denselben Intent; sie verifizieren den Token nicht erneut.
Ein unklarer Verifikationsausgang stellt keine Sitzung aus. Bestehende gültige Intents benötigen
keine neue Challenge für Bestellung, Ergebnis- oder eigene Status-/Zahlungsabfragen.

Die DB setzt ab Ausstellung feste 30 Minuten für neue Abgabe und 90 Minuten für den Ergebnisabruf.
Bei erfolgreicher Bestellung ist eine Sitzung dauerhaft verbraucht. Nach 30 Minuten erlaubt sie
ausschließlich das Lesen des eigenen gespeicherten Receipts; nach 90 Minuten endet auch das.
Bestehende Bestellstatus- und Zahlungszugänge behalten ihre ursprünglichen Fristen. Erneuerung prüft
zunächst das Ergebnis und widerruft nur einen noch unbestätigten eigenen Intent atomar. Browser ->
Sitzung -> Claim ist die gemeinsame Sperrfolge. Ein parallel laufender Commit wird abgewartet und
verhindert die Erneuerung in eine zweite Bestellung. DB-Zeit wird nach Sperren erneut geprüft.
Globale Kapazitätssperren liegen vor den zugehörigen Zeilensperren.

Die eigenen Status-/Zahlungszugänge benötigen keinen aktiven Checkout-Intent. Bei einem eindeutig
bestätigten Cookieablauf (410) darf ausschließlich für diese beiden Routen einmal ein neuer
CSRF-Kontext bootstrapped und dieselbe Capability unverändert erneut geprüft werden. Dies erzeugt
keinen Intent und erneuert keine Bestell-/Status-/Zahlungsfrist. Bestellung, Receipt und Quote
werden nicht automatisch wiederholt.

Der UI-Schreibablauf-Timer ersetzt keinen laufenden oder fehlgeschlagenen Receipthinweis nach
Reload. Erst nach einer erfolgreichen Prüfung eines noch gültigen unbestätigten Intents wird seine
verbleibende Schreibfrist erneut überwacht. Ein bereits abgelaufener Intent bekommt keinen
nachträglichen Nullzeit-Timer, der den serverseitigen Ablauf-/Recoveryhinweis überschreiben könnte.

## Ein Auftrag, ein Receipt

Strikt normalisierte Bestellung einschließlich Kontakt, Adresse, Lieferquote, Menüauswahl,
Zeitpunkt, Zahlungs-/Abgabeart und Scope wird kanonisch mit einem eigenen Fingerprintsecret gehasht.
Scope, Cookie, Session und bestehender SubmissionKey müssen zusammenpassen. Andere Payload bei
gleichem Schlüssel oder ein neuer Schlüssel für dieselbe Sitzung werden abgewiesen;
Legacy-Bestellschlüssel werden nicht übernommen.

Ein vor dem Writer erkannter bestätigter Replay antwortet ausschließlich lesend mit 200.
Überlappende Erstrequests können beide vor dem ersten Commit validiert sein und den bisherigen
201-Kommandostatus erhalten. Die gemeinsame DB-Sperre liefert trotzdem dasselbe Ergebnis und genau
einen Auftrag/Claim/Payment-/Outboxeffekt. Ein nach dem Rennen ausdrücklich wiederholter Request
muss 200 mit identischer Bestell-ID/-nummer liefern; diese Grenze wird separat geprüft.

Eine neue private DB-Funktion führt bestehende Domainvalidierung, Bestellsnapshot, Zahlung,
Kapazitätsclaim, Outbox beziehungsweise Paymentjob und minimiertes Receipt in derselben uncached
PostgreSQL-Transaktion aus. Bei Ablehnung gibt es keinen Teilzustand. Ein erfolgreicher Replay
liefert HTTP 200 und ruft keinen Writer/Provider auf; Erstabgabe bleibt HTTP 201. Auch bei
anschließend geschlossenen Neuschreib-, Liefer- oder Onlineflags bleibt ausschließlich dieser eigene
Replay lesbar. Die vorhandene Online-SQL-20-Grenze und sämtliche ursprünglichen
Go-live-/Preis-/Kapazitäts-/Zahlungsregeln bleiben erhalten.

Die API liest für die Klassifikation eines bekannten Replays zunächst das kleine private Receipt.
Erst danach wählt sie das Lese- oder Schreibbudget. Diese begrenzte Klassifikationsabfrage selbst
hat keinen Domain- oder Providereffekt; Rateentscheidung und Nonceverbrauch erfolgen vor jedem
Writer und Provider. Ein DB-/Transportfehler nach Schreibbeginn liefert ein ungewisses Ergebnis,
keine falsche Bestätigung. Der nächste Schritt ist immer die eigene Ergebnisabfrage.

## Instanzübergreifende Token-Buckets

PostgreSQL-Zeit, sortierte Zeilensperren und getrennt committed Rateentscheidungen verhindern
instanzlokale Resets und Counter-Rollback mit einer abgelehnten Bestellung. Kapazität N erlaubt
anfänglich N Tokens; danach fließen N/Periode nach. Dies ist kein starres Minutenfenster.

| Gruppe                 | Primärschlüssel           | Primärkapazität | Gemeinsame Netzkapazität          |
| ---------------------- | ------------------------- | --------------- | --------------------------------- |
| Ausstellung/Erneuerung | Kontext + Scope           | 5 / 600 s       | 120 / 600 s                       |
| Neue Abgabe            | Kontext + Intent          | 6 / 60 s        | 120 / 60 s                        |
| Receipt                | Kontext + Intent          | 60 / 60 s       | 600 / 60 s, gemeinsame Lesegruppe |
| Warenkorb-/Lieferquote | Kontext + Scope           | 60 / 60 s       | 600 / 60 s                        |
| Bestellstatus          | Eigene gültige Capability | 60 / 60 s       | 600 / 60 s                        |
| Payment-Session        | Eigene gültige Capability | 20 / 60 s       | 120 / 60 s                        |

Katalog und Verfügbarkeit sowie Bootstrap ohne bestehenden Kontext belasten nur ihr Netzbudget.
Ungültige Status-/Paymenttokens belasten das Netzbudget, erhalten aber keinen frei erfundenen
Primärschlüssel. Mehrere Scopes und Cookies teilen dieselbe Netzgruppe; Netzwechsel verändert den
Primärschlüssel einer vorhandenen eigenen Sitzung nicht. NAT löst keine Kontosperre aus.

Der Standard-Netzadapter verlangt echte Cloudflare-Runtimemetadaten `request.cf.colo` und die von
Cloudflare überschriebene IP. Freie Header allein reichen nicht. Die IP wird ausschließlich im
Gateway mit einem getrennten Netzsecret und der laufenden beziehungsweise vorherigen
10-Minuten-Epoche pseudonymisiert. Beide Epochen werden belastet. Bei Secretrotation werden beide
Secretversionen mit beiden Epochen belastet; das Alt-Netzsecret muss mindestens zehn Minuten
bleiben. Weder Scopewechsel, Neustart noch Epochwechsel setzt das vorhandene Budget zurück. Die
tatsächliche Providerherkunft muss separat in T51 nachgewiesen werden.

## Datensparsamkeit, Löschung und Obergrenzen

Private RLS-Tabellen halten Hashes, UUIDs, feste Fristen, HMACs und minimierte Receipts. Direktes
DML ist auch für service_role verboten; ausschließlich explizite private Funktionen mit leerem
search_path sind freigegeben. Keine Roh-IP, Kontakte, Adresse, Challenge, Cookie, CSRF-, Status-
oder Paymenttokens werden in Schutzdatensätzen gespeichert oder protokolliert. HMAC-pseudonyme
werden nicht als anonym bezeichnet.

Es gelten drei offene Intents je Kontext/Scope, 10.000 retained Kontexte/Sitzungen und je 100.000
Ratekeys/Nonces/Issueclaims je Umgebung. Auch abgelaufene noch nicht physisch entfernte Zeilen
zählen konservativ. Neue Einträge werden bei Kapazität abgewiesen; bestehende Receipts werden nicht
verdrängt. Cleanup löscht je Runde höchstens 1.000 Zeilen pro Tabelle mit SKIP LOCKED; der
bestehende Minuten-Scheduler führt höchstens 20 Runden aus. Löschzeitpunkte haben neun Minuten
Nachlauf für kurzlebige Claims/Budgets und 23 h 54 min nach dem 90-Minuten-Receipt. Damit verbleiben
bei gesundem Scheduler sechs Minuten bis zu den bestätigten Grenzen von 15 Minuten beziehungsweise
24 Stunden. Schedulerstillstand/Lock-Stau erfordern operative Überwachung; aus einem lokalen Lauf
folgt keine reale Betriebs-SLA. Bestellhistorie wird durch den Cleanup nicht gelöscht.

## UI und Nachweisgrenzen

SessionStorage speichert ausschließlich Scope und die vier öffentlichen Intentfelder. Kontakt,
Adresse, CSRF, Verifier und Challenge bleiben ungespeichert. Nach Reload wird ein vorhandener Intent
zuerst gelesen. Fehlende oder korrupte Metadaten, blockierter Speicher und fehlende Cookies haben
eigene Warn-/Sperrpfade. Für fehlende Metadaten liefert der Bootstrap nur ein scoped
Existenzboolean, keine fremde Intent-ID. Ein neuer Versuch benötigt einen zusätzlichen bewussten
Klick nach der Warnung. Warenkorb bleibt bei 429/Ausfall/Ungewissheit erhalten; keine automatische
zweite Abgabe oder neuer SubmissionKey. Tastatur, Fokus, Statusmeldungen, reduzierte Bewegung und
200%-Zoom sind getrennte synthetische Browsernachweise.

`scripts/ci-checkout-http.mjs` prüft dagegen echte Browserrequests über zwei HTTPS-Loopbackserver,
den tatsächlichen Gateway, Produktionsdispatcher und PostgreSQL. Ein Server zerstört eine Antwort
erst nach tatsächlichem Commit; Reload liest das Receipt ohne erneute Kontakte. TLS-Schlüssel sind
kurzlebige lokale Fixtures, die Vertrauensausnahme gilt ausschließlich für die beiden expliziten
Loopbackendpunkte. Challengewidget, Siteverify und Edgeherkunft bleiben lokale Abhängigkeiten; keine
externe Providerzahlung wird ausgelöst.

Die [56-Fälle-Zuordnung](../testing/checkout-session-abuse.md) trennt diese Schichten von sechs
externen/fachlichen/physischen Grenzen. Direkte Supabase-Login-/Recoverypfade behalten ihren
Providervertrag; O3 führt keinen Authproxy ein. A1/A3/A4/O1, Auth/MFA, SQL-20, Paymentjobs, Webhooks
und Statuszugänge benötigen ihre bestehenden vollständigen Regressionen. F01-F03,
Datenschutzfreigabe, echte Turnstile-/WAF-/Auth-Konfiguration und produktive Lastabnahme bleiben
offen. Kein automatischer Abschluss von A2 §11.7 oder Produktivfreigabe.

Primärquellen:
[Turnstile-Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/),
[Turnstile-Testschlüssel](https://developers.cloudflare.com/turnstile/troubleshooting/testing/),
[Supabase-Funktionen](https://supabase.com/docs/guides/database/functions),
[OWASP-Sessiongrenze](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
