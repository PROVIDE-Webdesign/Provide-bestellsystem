# Asian Kitchen: bestehende Demo mit geschütztem Bestellabschluss

Die vom Nutzer am 27.10.2026 bereitgestellte HTML-Datei bleibt die Quelle der sichtbaren
Speisekarte, ihrer Bilder, Varianten und des Warenkorbs. Die Integration erzeugt zusätzlich
`public/asian-kitchen/index.html`; sie ersetzt keine bestehende veröffentlichte Website.

## Umfang und Daten

- Originalquelle: `asian-kitchen.html`, SHA-256 in `manifest.json`.
- 12 Gerichte, 8 Varianten; der Extraktor bestätigt dieselben Inhalte wie der bisherige
  Asian-Kitchen-12.0-R1-Import. Der Export selbst hat einen anderen Dateihash.
- Das Manifest ordnet `dish-*` expliziten IDs des am 28.10.2026 vom Nutzer exportierten,
  veröffentlichten Testkatalogs `docs/pilot/asian-kitchen-published-catalog-20261028.json` zu. Der
  Import vergibt neue Artikel-IDs; die IDs der Importdatei dürfen daher nicht direkt als
  Laufzeitzuordnung verwendet werden. Die 12 Produkte wurden beim Abgleich über Quelle, Kategorie,
  Beschreibung, Preise und vollständige Konfiguration geprüft; alle 8 Varianten-IDs blieben
  erhalten. Keine automatische Namen-/Preisheuristik im Bestellablauf.
- Ausschließlich internes fiktives Restaurant, Testdaten, Abholung und Zahlung bei Abholung. Kein
  echter Restaurantstart und keine fachliche Bestätigung echter Deklarationen.
- Freie Sonderwünsche fehlen im aktuellen serverseitigen Bestellvertrag. Die Eingabe wird in dieser
  Pilotfassung verborgen/deaktiviert; vorhandene nichtleere Wünsche sperren die Bestellung. Keine
  stillschweigende Kürzung oder Umwandlung in Produktdaten.

## Technischer Anschluss

`scripts/build-asian-kitchen-demo.mjs` benötigt Node 24 und keine zusätzlichen Pakete. Es prüft den
Quellhash, kopiert die unveränderten Menü-/Bildbereiche und ergänzt CSS und Browsermodule. Die zwei
bisherigen Zeitberechnungen für die Abholung verwenden Berlin statt der Gerätezeitzone.
Reservierung, Kontakt und weitere Demoabschnitte werden nicht umgebaut.

Die erzeugten Module verwenden den vorhandenen `CheckoutClient` und die vorhandenen Vertragsparser,
ohne eigene parallel gepflegte Transport-/Sitzungslogik. Alle Bestellzugriffe laufen über den
bestehenden gleichnamigen Gateway derselben Origin. Keine Datenbank- oder Gateway-Schlüssel im
Browser, kein CORS-Freischalten, keine Änderung an RLS oder MFA.

Vor dem Abschluss erfolgen Katalogabgleich, Zuordnung der Varianten, serverseitige Preis- und
Zeitprüfung und ausdrückliche Bestätigung der geprüften Angaben. Eine Warenkorbänderung verwirft die
Vorschau. Die Kontaktdaten werden vor dem Deaktivieren des Formulars ausgelesen. Turnstile bindet
die echte Sicherheitsprüfung an den Bestellversuch. Doppelklicks sind gesperrt. Bei unklarem Versand
erfolgt zuerst die bestehende Belegabfrage, auch nach Neuladen; es wird keine neue Bestellung
automatisch angelegt. Das Statuszugriffstoken steht nicht in URLs. Kontaktdaten, CSRF und Challenge
werden nicht im Browserspeicher abgelegt.

## Bereitstellung im bestehenden Preview-Worker

1. Den aktuellen Pilotbranch auf dem Bereitstellungsrechner vorsichtig aktualisieren; bestehende
   lokale Änderungen vorher prüfen. Keine pauschale Zurücksetzung.
2. Im zugehörigen geschützten Dashboard die vollständige synthetische Importdatei als neuen Entwurf
   für Restaurant `storefront-restaurant-a`, Standort `storefront-a-mitte` übernehmen, kontrollieren
   und bewusst veröffentlichen. Der bisherige Zwei-Artikel-Katalog ist dafür nicht ausreichend. Alte
   Bestellungen behalten ihre bisherigen Snapshots. Nach einem erneuten Import die tatsächlich
   veröffentlichten Artikel-IDs erneut prüfen und das Manifest bewusst aktualisieren. Die Testdatei
   allein belegt keine ID-Bindung.
3. `pnpm --filter @provide/storefront build` erzeugt auch die Asian-Kitchen-Dateien.
4. Bestehende private Deploymentkonfiguration/Secrets weiterverwenden; zusätzlich ausschließlich im
   Preview-Worker `ASIAN_KITCHEN_DEMO_ENABLED=true` setzen. Keine Secrets ausgeben/committen. Der
   neue Schalter ist im Repository standardmäßig `false`. Checkoutschutz und bisherige
   Schutzschlüssel bleiben erforderlich. Lieferung, Onlinezahlung und Mail bleiben deaktiviert.
5. Storefront-Preview bereitstellen. Vorgesehener zusätzlicher Pfad: `/asian-kitchen/`.
   `provide-demos.pages.dev` ist die Herkunft der Demo, wurde dadurch nicht verändert.
6. Ein echter Durchlauf mit Variante: Demo → Preisprüfung → echte Turnstileprüfung → Auftrag im
   Dashboard bearbeiten → derselbe Bestellstatus in der Demo. Danach keine breite Testmatrix.

Solange das Menü nicht veröffentlicht oder der Schalter nicht gesetzt ist, darf die Demo keinen
erfolgreichen Anschluss vortäuschen. Der Katalogabgleich bzw. der Abschluss bleibt gesperrt.

## Gezielte lokale Prüfung

```sh
node scripts/build-asian-kitchen-demo.mjs
node --test scripts/test-asian-kitchen-demo.mjs
```

Die lokalen Nachweise sind isolierte Vertrags-/Transporttests mit synthetischer Gegenstelle. Sie
ersetzen weder einen echten Turnstilelauf noch einen veröffentlichten neuen Worker. Eine
vollständige Vinext-Kompilierung und die echte Geräteabnahme bleiben getrennte Nachweise.
