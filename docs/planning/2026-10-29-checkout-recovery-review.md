# Checkout: Verbindungsabbruch und sichere Wiederaufnahme

Stand: 29.10.2026. Lokale Ergänzung zum unveröffentlichten E116-Kandidaten. Keine GitHub Actions,
kein Push, keine Veröffentlichung und keine echte Bestellung.

## Befund und Korrektur

`CheckoutClient.receipt()` hob bisher bei beiden Antworten `unsubmitted` und `committed` die
Absendsperre auf. Die Oberfläche prüft die Bestellbestätigung jedoch erst danach. Enthielt eine als
`committed` gemeldete Antwort eine unvollständige Bestätigung, schlug deren Übernahme fehl, während
der gemeinsame Client weitere Absendeversuche bereits wieder erlaubte.

Der Fehler wurde über den echten Asian-Kitchen-Controller mit simulierter HTTP-Antwort reproduziert:
Nach einer verlorenen Bestellantwort und anschließend unvollständigem Beleg wurde `needsReceipt`
fälschlich `false`. Der neue Test scheiterte vor der Korrektur genau an dieser Erwartung. Eine
tatsächlich doppelte Datenbankbestellung wurde damit nicht nachgewiesen: Die serverseitigen
Session-, Wiederholungs- und Payload-Prüfungen bestehen zusätzlich.

Jetzt hält `committed` die Sperre aufrecht. Der native Checkout ruft `complete()` erst nach
erfolgreicher Prüfung und Übernahme der Bestätigung auf. Der Adapter hält seine Belegdaten wie
bisher zur Wiederaufnahme nach einem Neuladen vor und sperrt eine abgeschlossene Abgabe über
`completed`. Nur ein erfolgreich geprüftes `unsubmitted` gibt denselben Versuch für bewusstes
erneutes Absenden frei. Der Wiederholungsfall verwendet dieselbe Session und denselben
Bestellschlüssel.

Es gibt weder eine neue automatische Abgabe noch einen automatischen neuen Bestellversuch.
Serververtrag, Datenbank und Kontaktregeln bleiben unverändert.

## Lokale Nachweise

- Bestehende Adaptertests vor der Änderung: 17 bestanden.
- Neuer Fehlernachweis vor der Korrektur: unvollständiger `committed`-Beleg löst die Sperre;
  gezielter Test schlägt mit `false !== true` fehl.
- Nach der Korrektur: 28 Node-Tests bestanden. Darin 18 Adaptertests einschließlich des
  Fehlernachweises und 10 zusätzliche Tests des identischen gemeinsamen Clients.
- Separat 28 Vitest-Tests der TypeScript-Quelldatei bestanden, einschließlich eines neuen Tests für
  die Sperre bis zur Bestätigungsübernahme.
- Begrenzte strenge Typprüfung für den gemeinsamen Client und seine Tests sowie ESLint für diese
  beiden TypeScript-Dateien bestanden. Formatprüfung der veränderten Quellen und der Prüfnotizen
  bestanden.
- Demo neu aus den Quellen erzeugt; ursprüngliches HTML unverändert: SHA256
  `20feee61f68711da0ffb938ff0752da8a65cb74f7c6363df3cb4cb90c2cbc3bc`.

Abgedeckte Fehlerfälle: Offlinefehler vor der Übertragung, verlorene Antwort nach simuliertem
Commit, abgeschnittenes Antwort-JSON, Netzwerkfehler/503/ungültige Antwort bei der Belegabfrage,
unvollständige Bestätigung, Neuladen nach unklarer Abgabe, bewusste Wiederholung nach `unsubmitted`,
Doppelklick und Abbruch während einer laufenden Übertragung. Belegabfragen senden keine neue
Bestellung; lokale Wiederaufnahmedaten enthalten keinen Namen und keine E-Mail-Adresse.

`scripts/test-asian-kitchen-demo.mjs` importiert die neue Testdatei, damit der bisherige Testaufruf
auch die zusätzlichen Fälle ausführt:

```sh
node scripts/build-asian-kitchen-demo.mjs
node --test scripts/test-asian-kitchen-demo.mjs
```

## Grenzen und spätere Übernahme

HTTP und Bestellspeicherung sind simuliert. Die Prüfung beweist weder echte Datenbank-Idempotenz
noch das Verhalten des veröffentlichten Gateways, echte Browserdarstellung oder Wiederaufnahme mit
tatsächlich abgelaufenem Cookie. Die vollständige Pflichtprüfung und Browser-/Laufzeitabnahme
bleiben offen.

E116-Patch und seine damaligen Prüfnachweise bleiben unverändert archiviert. Diese Ergänzung muss
nach E116 angewendet und zusammen mit dem endgültigen Kandidaten geprüft werden; ältere vollständige
CI-Ergebnisse gelten nicht als Prüfnachweis dieser neuen Änderung. Keine Ableitung einer
PR27-/Merge- oder Deploymentfreigabe aus der bestehenden PR26-Freigabe.
