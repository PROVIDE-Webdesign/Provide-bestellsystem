# O3 prüfen und kontrolliert aktivieren

Dieses Paket ändert keine echte Providerkonfiguration und erteilt keine Betriebsfreigabe.
Aktivierung/Deployment bleiben ein eigener späterer Auftrag. Alle neuen Defaults sind false.

1. Nur einen technisch geprüften, unveränderten Head verwenden. Vorherige PR19-22-Freigaben sind
   ausschließlich an ihre bisherigen Heads gebunden. Eine neue O3-Freigabe überträgt sie nicht.
2. Migration in einer isolierten Umgebung prüfen; uncached Hyperdrive und DB-Transaktionen sind
   zwingend. Kein instanzlokaler Counter und kein öffentliches RPC ersetzen die private Grenze.
3. Getrennte API-/Gateway-/Fingerprint-/Netzsecrets mit mindestens 32 UTF-8-Bytes über
   Serverbindings provisionieren. Exakte eigene HTTPS-Origin, explizite CHECKOUT_PROTECTION_ENABLED
   beidseitig, CHECKOUT_WRITE_ENABLED und bestehende Domainflags unabhängig prüfen. Geheimnisse
   bleiben außerhalb des Git-Repositories und öffentlicher Props. Produktionskonfiguration
   verweigert reservierte Test-/Loopbackherkunft und publizierte Turnstile-Testsecrets.
4. Turnstile-siteKey für diese Herkunft und serverseitiges CHECKOUT_TURNSTILE_SECRET erst nach
   eigenständiger Providerfreigabe setzen. Action ist checkout_issue; cdata ist die Issue-UUID.
   Testadapter befinden sich ausschließlich in Prüffiles und sind kein Runtime-Schalter.
5. Tatsächliche Cloudflare-Edgeherkunft, Hostcookieverhalten, direkte APIabschirmung, eigene
   WAF-Regeln und Challengeauswertung mit T51/T52 nachweisen. Direkte Supabase-Authpfade benötigen
   T53 separat; bestehende Auth-/Recoveryprozesse werden nicht durch O3 umgeleitet.
6. Die vorgeschlagenen Token-Buckets vor produktivem Betrieb mit NAT-/Mobilwechsel und realer Last
   fachlich abnehmen (T55). Primär-/Netzgruppen, Periode und laufende DBzeit gemeinsam prüfen; 429
   und positiver Retry-After beweisen keine feste Fenstergrenze oder Produktionskapazität.
7. Minuten-Scheduler sowie 20 begrenzte Cleanup-Runden überwachen: ältester fälliger purge_at,
   Größen aller fünf privaten Tabellen, Lock-/Timeoutdauer und Schedulerstillstand. Die neun Minuten
   Nachlauf beziehungsweise 23 h 54 min nach Receiptablauf lassen sechs Minuten Reserve für
   Löschung. 100.000 Zeilen lassen sich mit 20x1.000 je Tabelle in fünf Schedulerläufen entfernen;
   zusätzlich bis eine Minute Terminphase. Bei Stau Alarm und weitere Aktivierung stoppen. Voller
   Store verweigert neue Schlüssel; niemals gültige Receipts zum Platzschaffen entfernen. Keine
   Historien- oder Gastkontaktlöschung aus diesem Runbook ableiten.
8. Netzsecretrotation mit mindestens zehn Minuten Überlappung beider Netzsecrets und beider Epochen
   durchführen. Gatewayrotation ist separat: CHECKOUT_GATEWAY_SECRET_PREVIOUS und
   CHECKOUT_GATEWAY_SECRET_PREVIOUS_UNTIL in UTC mit höchstens 30 Sekunden Überlappung. Neue
   Signaturen benutzen das neue Secret; alte werden nur bis zum absoluten Zeitpunkt akzeptiert.
   Fingerprintsecret bei noch aktiven 90-Minuten-Intents beibehalten; ungeplante Rotation kann
   exakten Schreib-Replay sperren. Der dedizierte eigene Receiptabruf bleibt davon unabhängig.
9. Eigene gespeicherte Bestellung bei ungewissem Ergebnis zuerst lesen. Keine automatische neue
   Abgabe, kein neuer SubmissionKey und keine neue Payment-Session zum vermeintlichen Reparieren.
   Unveränderte Wiederholung nutzt dieselbe Session/Payload; erfolgreiche Replayantwort ist 200.
   Erneuerung eines nachgewiesen unbestätigten Intents braucht bewusst eine neue Challenge.
10. Datenschutz-/Cookie-/Pseudonym- und Löschfreigabe T54 sowie physische F03-Abnahme T56 separat
    dokumentieren. Die CI-Bilder sind synthetisch und ersetzen keine Geräte-/Screenreaderabnahme.

## Reproduzierbare isolierte Nachweise

- `pnpm check`: Format, Lint, Typen, Units und Builds. Lokale Integration-skips sind kein PASS.
- `supabase test db`: 0041 zusätzlich zu allen bisherigen SQL-/RLS-/MFA-Suiten.
- `TEST_DATABASE_URL` explizit auf disposable Loopback setzen und
  `pnpm --filter @provide/api exec vitest run src/checkout-protection.integration.test.ts`
  ausführen: reale konkurrierende DB-Verbindungen, Commitverlust, Renewal, Nonces, letzte Tokens,
  Kapazität und physische begrenzte Löschung. Keine echte Provideranfrage.
- Nach installiertem Chromium `node scripts/ci-checkout-http.mjs`: tatsächlicher HTTPS-Browser/
  Gateway/API/PG mit eigenem Cookie und Antwortverlust. Ergebnisse/Bilder liegen im CI-Artefakt
  checkout-http-browser; Widget und Edgeidentität bleiben lokale Testadapter.
- Drei Browser-Engines führen die echte UI mit ausdrücklich synthetischem Transport aus: 390/1440
  px, 429, Challengeausfall, 30-/90-Minutenablauf, fehlende/blockierte Metadaten,
  Tastatur/Fokus/Livebereiche/reduzierte Bewegung/200%-Zoom. Keine physischen F03-Behauptungen.
- Bestehende echte Auth-TOTP-/Realtime-/Personal-/A4-/O1-Nachweise bleiben im isolierten CI-DBjob.

Nur einen vollständigen erfolgreichen Lauf aller fünf Pflichtjobtypen am tatsächlichen Head
anrechnen. Ein früherer grüner Head, ein abgebrochener TAP-Lauf oder transportgemockter Browser ist
kein Ersatz. Head, Tree, Lauf, Joblogs, Bildhashes und visuelle Prüfung gehören in den aktuellen
O3-Umsetzungsnachweis und das Projektprotokoll. Danach folgt die separate technische
Endfreigabeprüfung; PR23 bleibt Draft.
