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

## Paket 4 · Restaurantbetrieb mit Asian Kitchen Demo

Asian Kitchen Demo dient als interner Übungsbetrieb für das Restaurantteam. Die angebundene
[Demo-Website](https://provide-bs-storefront-preview.alpaysey.workers.dev/asian-kitchen/) nutzt
Restaurant A. Das Team öffnet im
[Vorschau-Dashboard](https://provide-bs-dashboard-preview.alpaysey.workers.dev/) die PROVIDE
Testküche und wählt den Teststandort Mitte. Marktgarten bleibt der getrennte zweite Testbetrieb für
die Standortzuordnung und behält seine eigene Karte.

### Standort und Abholung

| Feld                             | Wert für den Test                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Restaurant und Standort          | Asian Kitchen Demo → PROVIDE Testküche · Teststandort Mitte                                              |
| Zuordnung                        | `storefront-restaurant-a/storefront-a-mitte`                                                             |
| Abholadresse im Shop             | Testweg 1, 52062 Aachen, DE · Testadresse                                                                |
| Zeitzone                         | Europe/Berlin                                                                                            |
| Öffnungszeiten laut Demo-Website | Mo–Do 11:30–22:30 Uhr, Fr–Sa 11:30–23:00 Uhr, So 12:00–22:00 Uhr                                         |
| Abholplanung laut Demo-Website   | 30 Minuten Vorlauf, 15 Minuten je Zeitfenster, Bestellschluss 30 Minuten vor Ende                        |
| Betriebsumfang                   | Abholung. Der Checkout bestätigt den Termin serverseitig. Lieferung bleibt außerhalb des Übungsbetriebs. |

Die Website-Angaben sind Demo-Werte. Für die Übung gilt der vom Checkout bestätigte Termin. Beim
lesenden Abgleich am 04.11.2026 bestätigte der Shop die Abholung für zwei Artikel am 05.11.2026 um
18:45 Uhr Ortszeit. Adresse und Standortname stammen aus dem angebundenen Shop.

### Veröffentlichte Test-Speisekarte

Am 04.11.2026 waren im angebundenen Shop alle zwölf Gerichte der Testkarte verfügbar. Die Preise
sind in Euro. Die Karte verwendet Testdeklarationen für Steuern, Allergene und Zusatzstoffe.

| Kategorie     | Gericht           | Basispreis | Varianten oder Extras                        |
| ------------- | ----------------- | ---------- | -------------------------------------------- |
| Vorspeisen    | Frühlingsrollen   | 6,90 €     | Optionales Test-Extra +0,50 €                |
| Vorspeisen    | Gyoza             | 7,50 €     | Gemüse +0,00 €, Hähnchen +0,40 €             |
| Vorspeisen    | Edamame Meersalz  | 5,90 €     | —                                            |
| Vorspeisen    | Tempura Garnelen  | 9,90 €     | —                                            |
| Hauptgerichte | Crispy Duck       | 19,90 €    | —                                            |
| Hauptgerichte | Beef Teriyaki     | 18,90 €    | —                                            |
| Hauptgerichte | Miso Lachs        | 21,90 €    | —                                            |
| Hauptgerichte | Thai Green Curry  | 16,90 €    | Tofu +0,00 €, Hähnchen +1,00 €, Ente +3,00 € |
| Desserts      | Mochi Trio        | 7,90 €     | Mango, Kokos oder Matcha ohne Aufpreis       |
| Desserts      | Matcha Cheesecake | 8,50 €     | —                                            |
| Desserts      | Mango Sticky Rice | 7,50 €     | —                                            |
| Desserts      | Yuzu Crème Brûlée | 8,90 €     | —                                            |

Referenz im Shop: Menüversion `a64cd93a-4200-41d6-871a-637c756f71e1`. Die im
[Quellstand gesicherte Demo-Karte](../pilot/asian-kitchen-12-0-r1-pending.json) dokumentiert die
Herkunft von Gerichten, Basispreisen und Varianten. Das optionale Extra stammt aus der
veröffentlichten Testkarte.

### Übung und Bestellnachweise

- Mit **BS-00000022** Bestellung, Abholzeit, Varianten, Extra und Gesamtsumme im Dashboard
  nachvollziehen. Belegt sind der Website-Warenkorb bis zum Dashboard und die separate
  Smartphone-Prüfung des Bestellwegs. Für diesen Datenabgleich genügt die vorhandene Bestellung.
- **BS-00000010** belegt den abgeschlossenen Abholablauf in Marktgarten. **BS-00000020** belegt die
  Sandbox-Zahlung bei Annahme in Restaurant A. **BS-00000021** belegt den vollständig erstatteten
  Sandbox-Fall in Marktgarten. Bestehende Zahlungsfälle bleiben Referenzen.
- Für die Geräteabnahme die Kurzanleitung unten auf dem vorgesehenen Restaurantgerät verwenden.
  Sichtbarer Neueingang und hörbarer Bestellalarm auf diesem Gerät separat festhalten. Der
  bestätigte Smartphone-Test deckt den Gast-Bestellweg ab. Für einen Live-Alarm ist ein
  tatsächliches neues Ereignis nötig.

Die Demo-Daten decken den Standort- und Speisekartenbedarf für diese Übung ab. Die Betreiberliste
unten gilt für die spätere Einrichtung eines echten Betriebs.

### Geräte- und Alarmprüfung vom 04.11.2026

| Prüfung                                    | Ergebnis                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bestehender Bestellnachweis                | BS-00000022 im Vorschau-Dashboard der Testküche sichtbar. Standort, Abholzeit, zwei Positionen und 15,30 € abgeglichen.                                                                                                                                                                                                                                     |
| Wirksame Abholregeln der Testküche         | Version 1 im Dashboard. Täglich 00:00–23:59 Uhr als Vorschau-Testfenster, 15 Minuten Vorlauf und Slotlänge, 14 Tage Bestellhorizont. Fünf Minuten Annahmefrist, kein Liefergebiet. Die oben aufgeführten Demo-Website-Zeiten sind separat.                                                                                                                  |
| Alarm bei neuem Eingang                    | In isoliertem Chromium 151 bei 1440 × 1000 und 390 × 844 Pixeln. Der echte Dashboard-Code zeigte einen synthetischen Neueingang trotz gesetztem Suchfilter. Nach bewusster Aktivierung endeten der Testton und genau ein weiterer Ton für den Neueingang nativ im Browser. Erneutes Laden derselben Eingangsdaten blieb stumm.                              |
| Alarm und Ausfallverhalten                 | Überfälliger Eingang, Stummschaltung, Nachladen ohne Realtime, Neuladen ohne Tonfreigabe und Rechteentzug im selben Browserlauf geprüft. 68 Dashboard-Tests in 21 Dateien bestanden, darunter sieben Alarmtests.                                                                                                                                            |
| Gemeinsame Vorschau                        | Im angemeldeten Dashboard der Testküche fehlt „Ton aktivieren und testen“. Die gelieferte Seite meldet `alertsEnabled=false` und `liveEnabled=false`. Das Dashboard-Gateway antwortet mit HTTP 503. Die API beantwortet `GET /v1/dashboard/restaurants/{restaurantId}/locations/{locationId}/order-alerts` mit HTTP 503 und `Order alerts are not enabled.` |
| Hörbarkeit am vorgesehenen Restaurantgerät | Ausstehend. Der Browserlauf verwendet einen virtuellen Audioausgang und simuliert die Mobilansicht. Die separate Smartphone-Bestellprüfung betrifft den Shop.                                                                                                                                                                                               |

### Gemeinsame Vorschau · Befund für Bestellsystem 15

1. Im Vorschau-Dashboard die **PROVIDE Testküche** mit **Teststandort Mitte** öffnen. Der Abschnitt
   „Bestelleingang und Alarm“ zeigt nur die Nachladeinformation. Der priorisierte Eingang und der
   Testton fehlen. Die beiden HTTP-503-Antworten oben grenzen den Befund ein.
2. Für die gemeinsame Abnahme `DASHBOARD_ORDER_ALERTS_ENABLED=true` im Dashboard und in der API der
   Vorschau abgestimmt setzen. Die API-Einstellung schaltet auch die geplante Prüfung überfälliger
   Annahmen frei. Vor der Aktivierung offene Testfälle berücksichtigen. `DASHBOARD_REALTIME_ENABLED`
   ist ein getrennter Schalter. Für die Alarmprüfung genügt die 15-Sekunden-Nachladung, solange die
   Realtime-Freigabe separat geprüft wird.
3. Nach der Freigabe mit der vorhandenen Standortrolle einen aktuellen Eingang im Dashboard und
   einen erfolgreichen Alarmabruf prüfen. Auf dem vorgesehenen Restaurantgerät und im vorgesehenen
   Browser „Ton aktivieren und testen“ wählen. Gerät, Browser und Hörbarkeit festhalten. Ist ein
   neuer gemeinsamer Testeingang vorgesehen, denselben Lauf für den sichtbaren Eingang und den
   Bestellton verwenden. BS-00000022 bleibt der Beleg für den Website- und Dashboard-Pfad. Die
   technische Freigabe und der Hörnachweis sind die verbleibenden Abnahmeschritte.

## Geprüfter Einrichtungsstand für Marktgarten

Am 04.11.2026 in der gemeinsamen Vorschau lesend abgeglichen. TEST Marktgarten und TEST Marktgarten
Mitte sind aktiv. Die produktiven Freigaben für Restaurant und Standort stehen auf `blocked`. Das
Restaurant-Onboarding steht auf `not_started`, das Standort-Onboarding auf `in_progress`.

| Bereich      | Bestätigter Vorschau-Stand                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| Standort     | TEST Marktgarten Mitte · TEST Beispielweg 2 · 00000 TEST Teststadt · DE · Europe/Berlin                             |
| Karte        | Version 1 veröffentlicht. Drei aktive Testartikel in der Kategorie `testgerichte`.                                  |
| Ofengemüse   | 12,90 € Normal, 15,90 € Groß                                                                                        |
| Apfelschorle | 3,90 €                                                                                                              |
| Linsensuppe  | 6,90 €                                                                                                              |
| Abholzeit    | Montag bis Samstag 17:00–21:30 Uhr, Sonntag ohne Abholfenster                                                       |
| Planung      | 30 Minuten Vorlauf, 7 Tage Bestellhorizont, 15-Minuten-Slots, 2 Bestellungen und 10 Artikel je Slot                 |
| Betrieb      | Höchstens 5 offene Bestellungen, Bestellschluss 10 Minuten vor Fensterende, Annahmefrist 5 Minuten, 0 Liefergebiete |
| Website      | `pilot-website-b` ist auf `test-marktgarten/test-marktgarten-mitte` registriert und aktiv.                          |
| Zugriff      | Eine aktive Inhaberrolle im Vorschau-Restaurant.                                                                    |
| Befristung   | Standortfreigabe und Website-Integration bis 08.11.2026, 02:09 Uhr Ortszeit.                                        |

Die Speisekarte verwendet synthetische Steuer- und Allergenangaben. Die echte Karte wird anhand der
bestätigten Angaben des Betreibers gepflegt. Die Testadresse und Testkonfiguration sind als
Vorschau-Referenz dokumentiert.

### Betreiberangaben für die echte Einrichtung

| Bereich                                     | Vom Betreiber noch benötigt                                                                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Betrieb und Ansprechpartner                 | Tatsächlicher Restaurantname und Betreiber, Standortname, vollständige Abholadresse, öffentliche Website, betrieblicher Kontakt und Ausfallkontakt                                                                   |
| Standortregeln                              | Reguläre Öffnungs- und Abholzeiten, Feiertage und Schließtage, gewünschte Bestellkanäle, Vorlauf, Slotlänge, Kapazitäten, Bestellschluss und Pausenregel. Liefergebiete, Gebühren und Mindestwert nur bei Lieferung. |
| Speisekarte                                 | Aktuelle Karte mit Kategorien, Artikelbezeichnungen, Preisen, Varianten und Extras mit Aufpreis. Je Artikel bestätigte Steuer-, Allergen- und Zusatzstoffangaben sowie gewünschte Verfügbarkeit.                     |
| Geräte und Rollen                           | Verantwortliche Person, Rollen für Leitung und Küche, tatsächlich eingesetzte Restaurantgeräte und Termin für Gerätekontrolle sowie Einweisung                                                                       |
| Freigaben für den späteren Produktivbetrieb | Bestätigte Website-Zuordnung, Betreiber- und Standortdaten, angebotene Zahlarten und dazugehörige technische Freigaben im Zuständigkeitsbereich von Bestellsystem 15                                                 |

### Wiederverwendete Bestellnachweise

| Bestellung  | Bestätigter Umfang                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BS-00000010 | Marktgarten Mitte. Zwei Artikel, 19,80 €, Abholung, abgeschlossen.                                                                                                                               |
| BS-00000021 | Marktgarten Mitte. Ein Artikel, 6,90 € im Stripe-Testmodus erfasst und vollständig erstattet. Bestellung storniert.                                                                              |
| BS-00000022 | Restaurant A, Standort Mitte. Website-Warenkorb bis Gastbestätigung und Dashboard, zwei Artikel und 15,30 €, Zahlung bei Abholung. Separater Smartphone-Test vom Nutzer als bestanden bestätigt. |

Die Einrichtung des zweiten **Testrestaurants** ist mit diesen Vorschau-Belegen abgeschlossen. Der
Produktivbetrieb benötigt bestätigte Betreiberangaben, die Betriebs- und Geräteabnahme und eine
gesonderte Freigabe. Die Bestellung von Restaurant A belegt den Website-Durchlauf für A. Für die
Website-Anbindung von Marktgarten liegen die getrennten Browser- und Preisprüfungen vor.

## Kurzanleitung für Restaurantteam und Geräte

1. Dashboard am vorgesehenen Gerät mit eigener Rolle öffnen, Standort kontrollieren und Ton nach
   bewusster Bedienaktion aktivieren. Das Dashboard im sichtbaren Tab und das Gerät während der
   Bestellannahme wach halten. Verborgene Tabs und veraltete Eingangsdaten unterdrücken den Ton.
   Nach Rückkehr zum Tab die Anzeige und nach Neuladen die Tonfreigabe prüfen. Bei Tonproblemen
   Sichtanzeige, Ausgabegerät und Browser-Berechtigungen prüfen.
2. Neue Bestellung anhand Bestellnummer, Standort, Abholzeit, Artikeln, Varianten, Extras und
   Stückzahl kontrollieren. Bei freigegebenem Testlauf einmal annehmen oder mit Grund ablehnen. Den
   angezeigten Status prüfen. Bei unklarer Antwort dieselbe Bestellnummer zuerst abgleichen.
3. Zubereitung, abholbereit und abgeschlossen nacheinander pflegen. Bei Ausfall an die Leitung
   eskalieren und Bestellnummer, Zeitpunkt und sichtbaren Status festhalten. Zahlungsdaten und
   Zugangscodes bleiben im vorgesehenen System.
4. Physische Prüfung auf dem vorgesehenen Restaurantgerät und auf einem Smartphone separat
   protokollieren. Die isolierte Chromium-Mobilansicht deckt Darstellung und Bedienweg ab.

## Abgeschlossener Testfall BS16-WEB-E2E-01

1. Vor dem Lauf den abgestimmten Vorschau-Stand für Shop, API und Dashboard samt aktueller Karte,
   Integrationszuordnung und Testfreigaben festhalten. Vorbereitete oder unklare alte Bestellungen
   und Zahlungen anhand ihres tatsächlichen Zustands abgleichen. Einen frischen gültigen Abholtermin
   wählen.
2. Auf der Website von Restaurant A Frühlingsrollen mit Extra und Gyoza mit Variante Hähnchen
   auswählen, je ein Stück. E165 belegte dafür 7,40 € + 7,90 € = 15,30 €. Bei verändertem Katalog
   die erwarteten Artikel, Optionen und Beträge anhand der veröffentlichten Karte vorab
   aktualisieren. Den Link erzeugen, die Übernahme bewusst bestätigen und Preise im Shop
   serverseitig prüfen und bestätigen.
3. Bestellsystem 16 hat die Bestellung mit synthetischem Gastkontakt und normaler Schutzprüfung
   einmal im Modus Zahlung bei Abholung abgesendet. BS-00000020 bleibt der bestehende Nachweis für
   einmalige Sandbox-Erfassung bei Annahme.
4. Erwartung: genau eine Bestellnummer für `storefront-restaurant-a/storefront-a-mitte`, korrekter
   Termin, beide Positionen samt Variante/Extra und identische Gesamtsumme in Gastansicht und
   Dashboard. Kein Eintrag unter dem Marktgarten-Standort. Beim Onlinepfad gelten zusätzlich der
   dokumentierte Reservierungs- und Annahmestatus. Bei unklarer Antwort anhand derselben Bestellung
   prüfen, bevor eine weitere Aktion ausgelöst wird.
5. Gastansicht und Dashboard bestätigten BS-00000022 für Restaurant A, Standort Mitte, mit 15,30 €
   und Abholung am 05.11.2026 um 18:45 Uhr Ortszeit. Der Vorschau-Shop lief mit Version
   `f60362b7-4e80-4702-b40c-e7c0178eea64`. Den separaten Smartphone-Test hat der Nutzer als
   bestanden bestätigt.

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
Gerichten in B. Es gab null Bestell- oder Zahlungsaufrufe, Bestellungen und Zahlungsaufträge. Die
späteren Vorschau- und Smartphone-Nachweise stehen im Abschnitt zum abgeschlossenen Testfall
BS16-WEB-E2E-01.
