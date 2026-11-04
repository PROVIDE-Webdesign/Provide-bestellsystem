# Zweites Restaurant einrichten und Website-Übergabe abnehmen

Stand 04.11.2026 · Bestellsystem 16 · A2-2, A2-3, A2-4 und A2-10

## Standort und Zuständigkeit

| Vorschau | Restaurant                | Standort                 | Integration       |
| -------- | ------------------------- | ------------------------ | ----------------- |
| A        | `storefront-restaurant-a` | `storefront-a-mitte`     | `pilot-website-a` |
| B        | `test-marktgarten`        | `test-marktgarten-mitte` | `pilot-website-b` |

Dokumentierte Website-Adressen aus E165. Vor dem gemeinsamen Lauf die Zuordnung bestätigen.

- A <https://provide-bs-cart-demo-a.alpaysey.workers.dev>
- B <https://provide-bs-cart-demo-b.alpaysey.workers.dev>

Marktgarten ist der zweite synthetische Standort. Die bestehenden Zuordnungen und die tatsächlich
registrierten Website-Ursprünge auf dem abgestimmten Vorschau-Stand lesend verifizieren. Der
Integrator setzt die Zielzuordnung serverseitig fest. Jede Website benötigt ihren eigenen exakten
HTTPS-Ursprung und ihre eigene Integrations-ID. Shop und Checkout bleiben gemeinsam.

## Einrichtung in der richtigen Reihenfolge

1. **Restaurant und Standort anlegen oder abgleichen.** Anzeigenamen, Slugs, Zeitzone, Adresse,
   Bestellkanäle, Öffnungs- und Feiertagszeiten, Vorlauf, Zeitfenster, Kapazität und Pause pflegen.
   Abholung zuerst im synthetischen Umfang. Liefergebiet, Gebühren und Mindestwert vor
   Lieferfreigabe separat erfassen.
2. **Team dem Standort zuordnen.** Inhaber oder Leitung, Küche und gegebenenfalls Leserechte
   getrennt einrichten. Mit Testzugängen prüfen, dass A und B jeweils nur ihre eigenen Bestellungen
   sehen. Zuständige Person und Ausfallkontakt im Restaurant festlegen.
3. **Speisekarte vorbereiten und veröffentlichen.** Je Artikel stabilen Bezeichner, Kategorie,
   Bezeichnung, Preis in Cent, MwSt.-Zuordnung, Allergen-/Zusatzstoffangaben und Verfügbarkeit
   erfassen. Varianten und Extras mit Aufpreis, aktiven Optionen und Min-/Max-Auswahl erfassen.
   Entwurf gegen Betreiberangaben prüfen und die richtige Version für den Standort veröffentlichen.
   Testwerte sind Platzhalter für die Vorschau. Echte Rezept-, Steuer- und Preisdaten bleiben vom
   Betrieb zu bestätigen.
4. **Website verbinden.** Konfigurierte Integrations-ID und exakten Website-Ursprung in der Vorschau
   durch Bestellsystem 15 prüfen. Auf der Restaurant-Website Auswahl und Menge erfassen. Ein
   Importlink enthält nur ein kurzlebiges Importmerkmal. Restaurant, Standort, aktuelle Auswahl und
   Preis werden im Shop abgeglichen. Vorhandenen Warenkorb bewusst behalten oder ersetzen. Siehe
   [Warenkorb-Runbook](cart-handoff.md).
5. **Vorschau abnehmen.** Öffnungszeiten, Slot, veröffentlichte Karte, Händlerzuordnung und
   Gültigkeit der synthetischen Freigaben vor dem gemeinsamen Lauf kontrollieren. Änderungen an
   Vorschau, Datenbank, Stripe und zentralem Projektprotokoll koordiniert Bestellsystem 15. Eine
   Händler- oder Produktivfreigabe ist ein eigener Vorgang.

## Datenblatt für den zweiten Betrieb

| Wer liefert                    | Noch zu bestätigen                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Betreiber                      | Öffentlicher Name, Standortname und Adresse, Öffnungs- und Sonderzeiten, Abholvorlauf, Slotlänge, Kapazität, Pausenregel, Ansprechpartner und Ausfallweg    |
| Küche und Leitung              | Veröffentlichte Speisekarte, Artikelnummern, Kategorien, Preise, Steuersatz je Vorgang, Varianten, Extras, Allergen-/Zusatzstoffangaben, Ausverkauft-Regeln |
| Website-Verantwortliche        | Exakte HTTPS-Ursprünge, Integrations-ID, Zielrestaurant und Standort, Verantwortliche bei Importstörungen                                                   |
| Bestellsystem 15 und Betreiber | Wirksame Vorschau- und Händlerfreigaben, Rollen und Standortrechte, Betriebs- und Produktivabnahme                                                          |

Das vorhandene Marktgarten-Testmenü enthält unter anderem Ofengemüse und Apfelschorle. E145 und E165
liefern diese Vorschau-Referenz für die Datenerfassung.

| Kategorie     | Artikel           | Auswahl  | Belegter Vorschaupreis |
| ------------- | ----------------- | -------- | ---------------------- |
| Hauptgerichte | TEST Ofengemüse   | Normal   | 12,90 €                |
| Hauptgerichte | TEST Ofengemüse   | Groß     | 15,90 €                |
| Getränke      | TEST Apfelschorle | Standard | 3,90 €                 |

Marktgarten Mitte ist der Teststandort in der Zeitzone Europe/Berlin. Adresse, Zeiten, Vorlauf und
Kapazität für den späteren echten Betrieb bleiben Eingaben des Betreibers. Kategorie, Produktdaten,
Steuern und Preise für das tatsächliche Menü vor einem Einsatz bestätigen. Die veröffentlichte
Testkarte und ihren Preis vor jedem Vorschau-Abnahmelauf frisch prüfen.

## Kurzanleitung für Restaurantteam und Geräte

1. Dashboard am vorgesehenen Gerät mit eigener Rolle öffnen, Standort kontrollieren und Ton nach
   bewusster Bedienaktion aktivieren. Sichtbaren Neueingang und Ton bei gesperrtem Bildschirm,
   Hintergrund-Tab oder pausierter Audiofreigabe gezielt prüfen. Bei Tonproblemen zuerst
   Sichtanzeige, Ausgabegerät und Browser-Berechtigungen prüfen.
2. Neue Bestellung anhand Bestellnummer, Standort, Abholzeit, Artikeln, Varianten, Extras und
   Stückzahl kontrollieren. Bei freigegebenem Testlauf einmal annehmen oder mit Grund ablehnen. Den
   angezeigten Status prüfen. Bei unklarer Antwort dieselbe Bestellnummer zuerst abgleichen.
3. Zubereitung, abholbereit und abgeschlossen nacheinander pflegen. Bei Ausfall an die Leitung
   eskalieren und Bestellnummer, Zeitpunkt und sichtbaren Status festhalten. Zahlungsdaten und
   Zugangscodes bleiben im vorgesehenen System.
4. Physische Prüfung auf dem vorgesehenen Restaurantgerät und auf einem Smartphone separat
   protokollieren. Die isolierte Chromium-Mobilansicht deckt Darstellung und Bedienweg ab.

## Übergabe an Bestellsystem 15 · gemeinsamer einmaliger Testfall BS16-WEB-E2E-01

1. Vor dem Lauf den abgestimmten Vorschau-Stand für Shop, API und Dashboard samt aktueller Karte,
   Integrationszuordnung und Testfreigaben festhalten. Vorbereitete oder unklare alte Bestellungen
   und Zahlungen anhand ihres tatsächlichen Zustands abgleichen. Einen frischen gültigen Abholtermin
   wählen.
2. Auf der Website von Restaurant A Frühlingsrollen mit Extra und Gyoza mit Variante Hähnchen
   auswählen, je ein Stück. E165 belegte dafür 7,40 € + 7,90 € = 15,30 €. Bei verändertem Katalog
   die erwarteten Artikel, Optionen und Beträge anhand der veröffentlichten Karte vorab
   aktualisieren. Den Link erzeugen, die Übernahme bewusst bestätigen und Preise im Shop
   serverseitig prüfen und bestätigen.
3. Mit synthetischem Gastkontakt und normaler Schutzprüfung einmal absenden. Bestellsystem 15 führt
   die Bestellung aus und übernimmt den vorgesehenen Abnahmemodus für die Zahlung. BS-00000020
   bleibt der bestehende Nachweis für einmalige Sandbox-Erfassung bei Annahme.
4. Erwartung: genau eine Bestellnummer für `storefront-restaurant-a/storefront-a-mitte`, korrekter
   Termin, beide Positionen samt Variante/Extra und identische Gesamtsumme in Gastansicht und
   Dashboard. Kein Eintrag unter dem Marktgarten-Standort. Beim Onlinepfad gelten zusätzlich der
   dokumentierte Reservierungs- und Annahmestatus. Bei unklarer Antwort anhand derselben Bestellung
   prüfen, bevor eine weitere Aktion ausgelöst wird.
5. Belege zu tatsächlicher Version, Gerät, Gaststatus, Dashboard und Bestellnummer im zentralen
   Protokoll zuordnen. Für den physischen Mobilnachweis reicht ein separater Warenkorb- und
   Preisbestätigungsdurchlauf ohne weitere Bestellung.

## Isolierte Prüfung für den Shop-Branch

Die Integration unter `scripts/ci-cart-handoff.integration.test.mjs` führt den Website-Worker mit
beiden Konfigurationen und die Shop-Komponente im Browser aus. Die Test-Origins werden abgefangen
und bleiben lokal. Warenkorbübergabe und Warenkorbpreis laufen durch Gateway, API und ein getrenntes
PostgreSQL mit synthetischen Daten. Auch der geschützte Checkout-Kontext und die Preisabfrage
verwenden das Shop-Gateway. Bestell- und Zahlungsrouten sind im Test gesperrt. Die Suite verwendet
eine frisch migrierte, ausschließlich für diesen Test reservierte Loopback-Datenbank unter
Port 26322. Die Produktdaten und Integrationen in dieser DB sind synthetische Testfixtures. Die
Ausführung prüft Desktop-Chromium und ein simuliertes iPhone 13.

Für eine Wiederholung zuerst das bestehende `supabase/config.toml` in ein separates
Supabase-Arbeitsverzeichnis kopieren. Eine eigene Projektkennung und unbenutzte Ports verwenden,
darunter 26322 für die Test-DB. Die vorhandenen Migrationen bis einschließlich Cart-Handoff in diese
lokale Umgebung übernehmen und nur deren DB starten. Danach Verträge bauen, Chromium für Playwright
bereitstellen und den Test vom Repository-Stamm aus ausführen.

```sh
pnpm --filter @provide/contracts build
BS16_TEST_DB='<DSN der isolierten Loopback-DB>' pnpm exec vitest run \
  scripts/ci-cart-handoff.integration.test.mjs
```

Mit `BS16_STORAGE_ONLY=1` wird der Regressionsfall für blockierten Sitzungsspeicher ausgeführt. Die
isolierte Umgebung nach der Prüfung separat stoppen.

## Nachweis Bestellsystem 16 vom 04.11.2026

| Fall                      | Umgebung und Ergebnis                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BS16-WEB-A und BS16-WEB-B | Je Desktop-Chromium und iPhone-13-Simulation. Restaurant und Standort, Artikel, Variante, Extra, Menge und Serverpreis bestätigt.                                                       |
| BS16-WEB-KEEP / REPLACE   | In allen vier Kombinationen hat Behalten den Warenkorb erhalten. Ersetzen hat die neue Menge übernommen. Der Importdialog blieb bei erlaubtem Sitzungsspeicher nach Neuladen verfügbar. |
| BS16-WEB-EXPIRED / WRONG  | Je vier Ablehnungen mit HTTP 410 bzw. 403. Beim abgelaufenen Link blieb die bisherige Auswahl bis zur erneuten serverseitigen Preisbestätigung erhalten.                                |
| BS16-WEB-STORAGE          | Auf der Ausgangsfassung fehlte bei blockiertem Sitzungsspeicher die Übernahmeschaltfläche. Auf dem korrigierten Stand gelangen Übernahme und Preisbestätigung im offenen Tab.           |
| Technische Prüfungen      | 17 bestätigte serverseitige Preisabfragen in den beiden Browserläufen, 100 bestehende Shop-Tests, TypeScript, ESLint, Prettier für die geänderten Dateien und Shop-Build bestanden.     |

Der Browserlauf verwendete die echte Import- und Preislogik in einer getrennten Umgebung mit
synthetischen Daten. Die Beispielsummen waren 30,00 € bei zwei Gerichten in A und 36,90 € bei drei
Gerichten in B. Es gab null Bestell- oder Zahlungsaufrufe, Bestellungen und Zahlungsaufträge. Eine
echte Smartphone-Prüfung und BS16-WEB-E2E-01 folgen auf dem gemeinsam abgestimmten Vorschau-Stand.
