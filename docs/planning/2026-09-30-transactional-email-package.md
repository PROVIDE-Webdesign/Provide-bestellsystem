# Vorbereitung: transaktionale E-Mails für Gastbestellungen

Stand: 30.09.2026, Europe/Berlin.

## Status und Grundlage

Dieses Dokument bereitet ein Arbeitspaket aus A2-Hauptblock 8 vor. Es ist keine
technische Endabnahme und keine Freigabe eines echten Versands. Grundlage sind
Architektur-/Arbeitsplan A2, Projektprotokoll V2 einschließlich Ergänzung E01,
die Übergabe vom 27.09.2026 und die Repository-Dokumentation zu AB 3.7.

Die offene Sandbox-Abnahme von AB 3.9 bleibt bestehen. Dieses Planungspaket
setzt weder einen Merge von PR #8 noch einen verfügbaren Nutzer-Laptop voraus.
Der spätere Implementierungsstand muss gegen den dann aktuellen Code geprüft werden.

## Bestätigte Entscheidung vom 30.09.2026

Der Nutzer hat im Projektchat die Option **E-Mail verpflichtend** ausgewählt.

- Jede neue Gastbestellung benötigt eine E-Mail-Adresse.
- Ein Kundenkonto bleibt für Gastbestellungen unnötig.
- Bestehende Bestellungen ohne E-Mail werden durch diese Entscheidung nicht nachträglich ungültig.
- Umsetzung und Migration gehören in das nachfolgend abgegrenzte Implementierungspaket.
- Die vorhandene optionale E-Mail-Angabe erfüllt diese neue Pflicht noch nicht.

Alle weiteren Regeln und Texte dieses Dokuments sind Vorschläge zur fachlichen
Bestätigung. A2 und V2 werden durch dieses Dokument nicht ersetzt.

## Bereits vorhandene Grundlage

AB 3.7 hat eine standardmäßig deaktivierte Verarbeitung mit synthetischem
SMS-Adapter. Dokumentiert sind transaktionaler Fan-out, Claims, Idempotenz,
Retry, Suppression und Dead Letter. Ein realer Versandadapter und E-Mail
waren ausdrücklich ausgeschlossen. Dieser Befund ist keine E-Mail-Abnahme.

Vor einer Umsetzung sind die tatsächlichen Ereignis- und Zahlungsgrenzen,
Kontaktdatenprojektionen, Unterdrückungsregeln und Zustellverträge zu prüfen.
Die bestehende Verarbeitung wird erweitert, soweit ihre Verträge passen.

## Vorgeschlagener Paketumfang

1. E-Mail-Pflicht in Storefront, API-Vertrag und serverseitiger Bestellvalidierung.
   Leerwerte und unzulässiges Format verhindern die Abgabe; eine syntaktische
   Prüfung behauptet keine nachgewiesene Erreichbarkeit des Postfachs.
2. Ereignisgebundene E-Mail-Aufträge für Abholung und Lieferung.
3. Anbieterunabhängiger Vertrag mit einem injizierten synthetischen E-Mail-Adapter.
4. Versionierte Text- und HTML-Vorlagen mit identischem fachlichem Inhalt.
5. Wiederholbare Verarbeitung, getrennte Zustellzustände und Supportnachweis.
6. Automatisierte Contract-, Datenbank-, Integrations- und Vorlagenprüfungen.

Nicht enthalten sind echte Empfänger, echter Versand, neue Anbieter-Accounts,
Secrets, Absenderdomain-Einrichtung, Deployment, Marketing und die Änderung
des Stripe-Zahlungszeitpunkts. Brevo bleibt die in A2 vorgesehene Richtung;
seine konkrete Anbindung erhält ein gesondertes Paket.

## Vorgeschlagene fachliche Regeln

- Die Nachricht zum Eingang setzt eine gültig gespeicherte, für die
  Restaurantbearbeitung freigegebene Bestellung voraus. Bei Onlinezahlung
  wird sie nicht allein durch einen offenen Checkout oder die
  Browser-Erfolgsrückkehr ausgelöst. Die genaue Freigabegrenze ist gegen
  die Zahlungszustände des finalen Codes zu testen.
- Eingang und Restaurantannahme sind unterschiedliche Meldungen.
- Annahme enthält die bestätigte Abhol- beziehungsweise Lieferzeit.
- Ablehnung und Stornierung nennen den vorgesehenen Grund.
- Eine Erstattung wird erst als abgeschlossen bezeichnet, wenn der
  Zahlungsanbieter sie bestätigt. Zuvor darf nur ein laufender Vorgang
  beschrieben werden.
- Bereitmeldung gilt für Abholung; Unterwegs-Meldung gilt für Lieferung.
- Zeitkorrektur erhält eine eigene Meldung mit neuer bestätigter Zeit.
- Eine fehlgeschlagene Nachricht verändert keine gespeicherte Bestellung
  und startet keinen neuen Zahlungsvorgang. Die Statusseite bleibt erreichbar.
- Ältere überholte Nachrichten werden passend zum aktuellen Zustand
  unterdrückt. Entscheidungen und ihre Historie bleiben nachvollziehbar.
- Nachrichten enthalten keine Werbung und keine vollständige Lieferadresse.

## Textvorschläge

Platzhalter werden aus dem autorisierten Bestellsnapshot beziehungsweise
dem protokollierten Ereignis gerendert. Der Statuslink übernimmt die
bestehenden Zugriffs- und Ablaufgrenzen.

| Ereignis | Betreff | Kerntext |
| --- | --- | --- |
| Eingang | Bestellung {Nummer} ist eingegangen | Ihre Bestellung bei {Restaurant} ist eingegangen. Das Restaurant prüft sie jetzt. Eine Annahmebestätigung folgt separat. Den aktuellen Stand finden Sie unter {Statuslink}. |
| Annahme, Abholung | Bestellung {Nummer} bestätigt | Ihre Bestellung wurde angenommen. Bestätigte Abholzeit: {Zeit}. Abholort: {Standort}. Aktueller Stand: {Statuslink}. |
| Annahme, Lieferung | Bestellung {Nummer} bestätigt | Ihre Bestellung wurde angenommen. Bestätigte Lieferzeit: {Zeit}. Aktueller Stand: {Statuslink}. |
| Ablehnung | Bestellung {Nummer} abgelehnt | Das Restaurant konnte Ihre Bestellung nicht annehmen. Grund: {Grund}. Den aktuellen Zahlungs- und Erstattungsstand finden Sie unter {Statuslink}. |
| Stornierung | Bestellung {Nummer} storniert | Ihre Bestellung wurde storniert. Grund: {Grund}. Den aktuellen Zahlungs- und Erstattungsstand finden Sie unter {Statuslink}. |
| Abholbereit | Bestellung {Nummer} ist abholbereit | Ihre Bestellung ist zur Abholung bei {Standort} bereit. Aktueller Stand: {Statuslink}. |
| Unterwegs | Bestellung {Nummer} ist unterwegs | Ihre Lieferung ist unterwegs. Aktueller Stand: {Statuslink}. |
| Zeitkorrektur | Neue Zeit für Bestellung {Nummer} | Die bestätigte {Abhol-/Lieferzeit} wurde geändert auf {Zeit}. Aktueller Stand: {Statuslink}. |
| Erstattung bestätigt | Erstattung zu Bestellung {Nummer} bestätigt | Die Erstattung über {Betrag} wurde vom Zahlungsanbieter bestätigt. Die Anzeige auf Ihrem Konto kann später erfolgen. Aktueller Stand: {Statuslink}. |

## Vorgeschlagene Verarbeitung und Abnahme

- Idempotenzschlüssel binden Ereignis, Kanal, Empfängerzuordnung und Vorlagenversion.
- Kontaktinformationen gelangen nur in die benötigte kurzlebige
  serverseitige Versandprojektion; Logs enthalten keine E-Mail-Adressen,
  Nachrichtentexte, Zugriffstoken oder rohe Anbieterantworten.
- Anbieterannahme und tatsächliche Zustellung sind getrennte Zustände.
  Zustellung darf nur bei entsprechendem Nachweis als zugestellt gelten.
- Temporäre Fehler, permanente Ablehnung, unklare Anbieterantwort nach
  Timeout, abgelaufene Claims und Dead Letter erhalten getrennte Tests.
- Bei unklarer Anbieterannahme verhindert nachgewiesene Idempotenz oder
  ein kontrollierter Abgleich doppelte Zustellung. Ein blindes Resend gilt
  nicht als sicherer Abschluss.
- Ein notwendiger manueller Retry ist rollenbegrenzt und auditiert.

Abschlussnachweise am endgültigen Implementierungs-Commit:

1. Pflichtkontakt serverseitig und im Browser wirksam, ohne neue Bestellkonten.
2. Kein Eingang vor Zahlungsfreigabe; richtige Ereignisse für beide Erfüllungsarten.
3. Doppelte Ereignisse und Worker-Wiederholungen erzeugen keine zweite Nachricht.
4. Timeout, permanente Ablehnung, Suppression und Dead Letter korrekt.
5. HTML/Text, sichere Platzhalter und Restaurant-Zeitzone geprüft.
6. Statusseite und Bestellung funktionieren auch bei Versandfehler.
7. Kein mandantenfremder Zugriff und keine sensiblen Logdaten.
8. Pflichtprüfungen check und database grün.
9. Gesonderte technische Nutzerfreigabe und Merge-Erlaubnis.

## Nächste Handy-Entscheidung

Die fachlichen Nachrichtenanlässe und Texte bestätigen oder korrigieren.
Erst danach das Implementierungspaket freigeben. Echte Anbieterzustellung
bleibt ein späterer, separat zu prüfender Schritt.
