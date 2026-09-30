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

Der Nutzer hat am 30.09.2026 beauftragt, bei Entscheidungen den Empfehlungen
des Assistenten zu folgen. Auf dieser Grundlage sind die hier abgegrenzten
fachlichen Regeln, Nachrichtenanlässe und Texte übernommen. A2 und V2 werden
durch dieses Dokument nicht ersetzt.

### Delegierte Entscheidungen

Routineentscheidungen zu Fachabläufen, Bedienung, Texten und technischer Umsetzung
innerhalb des autorisierten Umfangs werden begründet getroffen und dokumentiert.
Erneute Auswahlfragen entfallen, sofern keine wesentlichen Informationen fehlen
oder ein Zielkonflikt mit bestehenden Festlegungen besteht.

Die ausdrücklich vorbehaltene technische Endfreigabe, Merge-Erlaubnis,
Deployment- und Live-/Pilotfreigabe bleiben gesonderte Nutzerentscheidungen.
Kostenpflichtige Einrichtungen und Änderungen an bestehenden Produktgrenzen
sind durch diese Delegation nicht pauschal genehmigt.

### Nachrichtenumfang

Übernommen ist die Empfehlung „wichtige Schritte“: Eingang, Annahme,
Ablehnung, Stornierung, Zeitkorrektur, abholbereit, unterwegs und bestätigte
Erstattung. „Zubereitung begonnen“ und „Bestellung abgeschlossen“ bleiben
auf der Statusseite sichtbar und lösen keine zusätzliche E-Mail aus.

## Bereits vorhandene Grundlage

AB 3.7 hat eine standardmäßig deaktivierte Verarbeitung mit synthetischem
SMS-Adapter. Dokumentiert sind transaktionaler Fan-out, Claims, Idempotenz,
Retry, Suppression und Dead Letter. Ein realer Versandadapter und E-Mail
waren ausdrücklich ausgeschlossen. Dieser Befund ist keine E-Mail-Abnahme.

Vor einer Umsetzung sind die tatsächlichen Ereignis- und Zahlungsgrenzen,
Kontaktdatenprojektionen, Unterdrückungsregeln und Zustellverträge zu prüfen.
Die bestehende Verarbeitung wird erweitert, soweit ihre Verträge passen.

## Abgegrenzter Paketumfang

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

## Übernommene fachliche Regeln

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

## Übernommene Nachrichtentexte

Platzhalter werden aus dem autorisierten Bestellsnapshot beziehungsweise
dem protokollierten Ereignis gerendert. Der Statuslink übernimmt die
bestehenden Zugriffs- und Ablaufgrenzen.

| Ereignis             | Betreff                                     | Kerntext                                                                                                                                                                    |
| -------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eingang              | Bestellung {Nummer} ist eingegangen         | Ihre Bestellung bei {Restaurant} ist eingegangen. Das Restaurant prüft sie jetzt. Eine Annahmebestätigung folgt separat. Den aktuellen Stand finden Sie unter {Statuslink}. |
| Annahme, Abholung    | Bestellung {Nummer} bestätigt               | Ihre Bestellung wurde angenommen. Bestätigte Abholzeit: {Zeit}. Abholort: {Standort}. Aktueller Stand: {Statuslink}.                                                        |
| Annahme, Lieferung   | Bestellung {Nummer} bestätigt               | Ihre Bestellung wurde angenommen. Bestätigte Lieferzeit: {Zeit}. Aktueller Stand: {Statuslink}.                                                                             |
| Ablehnung            | Bestellung {Nummer} abgelehnt               | Das Restaurant konnte Ihre Bestellung nicht annehmen. Grund: {Grund}. Den aktuellen Zahlungs- und Erstattungsstand finden Sie unter {Statuslink}.                           |
| Stornierung          | Bestellung {Nummer} storniert               | Ihre Bestellung wurde storniert. Grund: {Grund}. Den aktuellen Zahlungs- und Erstattungsstand finden Sie unter {Statuslink}.                                                |
| Abholbereit          | Bestellung {Nummer} ist abholbereit         | Ihre Bestellung ist zur Abholung bei {Standort} bereit. Aktueller Stand: {Statuslink}.                                                                                      |
| Unterwegs            | Bestellung {Nummer} ist unterwegs           | Ihre Lieferung ist unterwegs. Aktueller Stand: {Statuslink}.                                                                                                                |
| Zeitkorrektur        | Neue Zeit für Bestellung {Nummer}           | Die bestätigte {Abhol-/Lieferzeit} wurde geändert auf {Zeit}. Aktueller Stand: {Statuslink}.                                                                                |
| Erstattung bestätigt | Erstattung zu Bestellung {Nummer} bestätigt | Die Erstattung über {Betrag} wurde vom Zahlungsanbieter bestätigt. Die Anzeige auf Ihrem Konto kann später erfolgen. Aktueller Stand: {Statuslink}.                         |

## Verarbeitung und Abnahmekriterien

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

## Gebündelte Fortsetzung vom 30.09.2026

Der Nutzer hat beauftragt, die nächsten Schritte sinnvoll zu bündeln. Die
folgende Reihenfolge verbindet fachlich zusammenhängende Arbeiten. Sie ersetzt
keine A2-Anforderung und markiert noch keine Umsetzung oder Abnahme als erledigt.

| Reihenfolge | Paket                                       | Zusammengefasste Arbeit                                                                                                                                                                           | Abschlussnachweis                                                                                                                                            |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1           | Gastkontakt und Kundeninformation           | Codeabgleich, E-Mail-Pflicht, Ereignisse, HTML/Text, synthetischer Adapter, sichere Statuslinks, Fehler- und Zustellverarbeitung, automatisierte Tests, Runbook und Abnahmematrix                 | Kriterien dieses Dokuments am endgültigen Commit nachgewiesen; echte Zustellung separat                                                                      |
| 2           | Menüpflege bis Warenkorb                    | Bestandsaufnahme vorhandener Menüfunktionen; verbleibende Varianten/Extras, Allergene, Verfügbarkeit, Veröffentlichung mit Zeitplanung/Rollback und serverseitige Preisprüfung gemeinsam ergänzen | Veröffentlichter Snapshot und Bestellpreis stimmen überein; veraltete oder unzulässige Auswahl wird abgefangen                                               |
| 3           | Restaurantbearbeitung und Betriebssteuerung | Bestandsaufnahme Dashboard, Annahme/Ablehnung, Zeitkorrektur, Statuswechsel, Pause, ausverkauft, Auslastung und automatische Ablaufzeiten; Ereignis- und Nachrichtenauswirkungen mitprüfen        | Berechtigte Bedienung, nachvollziehbare Zustandswechsel und Kapazitätswirkungen geprüft; echte Mehrgeräte-/Alarmprüfung gesondert                            |
| 4           | Support und Betriebsnachweise               | Bestandsaufnahme Bestellhistorie, Suche, Tages-/Wochenzahlen, Zahlungs-/Nachrichtenabgleich, Fehlerfälle, Rollen, Audit und Betriebsanleitungen                                                   | Fälle anhand gespeicherter Nachweise aufklärbar; Kennzahlen nachvollziehbar; verbleibende Wiederherstellungs- und Betriebsprüfungen ausdrücklich ausgewiesen |

Für Pakete 2–4 ist der Umfang zunächst eine Arbeitszuordnung aus A2. Erst die
Bestandsaufnahme bestimmt die tatsächlichen Lücken. Bereits vorhandene,
ausreichend geprüfte Funktionen werden nicht erneut implementiert.

Innerhalb jedes Pakets laufen die Schritte in Abhängigkeitsreihenfolge:
Bestandsaufnahme und Abgrenzung, Vertrag und Migration, API und Oberfläche,
Normal- und Fehlerfälle, passende automatische Prüfungen, Dokumentation und
Abnahmenachweis. Unabhängige Leseabfragen und Prüfungen können gemeinsam
ausgeführt werden. Änderungen mit derselben fachlichen Ursache bleiben in
einem reviewbaren Paket; ein zu großer Umfang wird in aufeinander aufbauende
Commits oder klar abgegrenzte PRs geteilt.

### Bereits erfolgter Codeabgleich für Paket 1

Geprüfte Referenz ist PR #8 am Commit
`4e422f5b9ce7324e56bdb2b4e8d4cbd76ca3c8cc`.
Die Prüfung ist auf die unten genannten Verträge, Verarbeitung und Projektionen
begrenzt; sie ist keine vollständige Repository- oder Laufzeitabnahme.

| Bereich und Quelle                                                                                                    | Tatsächlicher Befund                                                                                                   | Arbeit im Paket                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/storefront/app/storefront/Storefront.tsx`; `packages/contracts/src/checkout.ts`                                 | Formular nennt E-Mail optional, überträgt bei Leerwert `null`; Requestparser akzeptiert `null`                         | Pflicht für neue Gastbestellungen in UI und sämtlichen Bestelleingängen durchsetzen; historische Kontakte und Datenlöschung weiterhin erlauben        |
| `packages/contracts/src/notifications.ts`                                                                             | Versandjob ist ausdrücklich SMS mit Telefonnummer und fünf Statusvorlagen                                              | Eigenen E-Mail-Vertrag mit passender Empfängerprojektion, Ereignisinhalten und Vorlagenversion ergänzen                                               |
| `apps/api/src/notifications.ts`                                                                                       | Adapter übergibt einen SMS-Text; Renderer nutzt Wunschzeit, keinen Statuslink und keinen bestätigten Erstattungsbetrag | Betreff, Text/HTML und fachlich belegte Inhalte für E-Mail ergänzen; Zeitkorrektur, unterwegs und Erstattung brauchen eigene Ereignisverträge         |
| `supabase/migrations/20260915210000_create_order_notification_dispatch.sql`; `apps/api/src/notifications-database.ts` | Kanalgrenze SMS; Anbieterannahme wird als `sent` gespeichert; Claims, begrenzte Retries und Suppression vorhanden      | Vorhandene Zuverlässigkeitsmechanismen weiterverwenden; Anbieterannahme, Zustellung und unklare Annahme ausdrücklich unterscheiden                    |
| `supabase/migrations/20260916021000_extend_online_payment_projections.sql`, aktuelle Claim-Funktion                   | Offene Onlinezahlung bei `submitted` blockiert den Claim; Projektion bleibt SMS und telefonisch                        | Zahlungsfreigabe auch für E-Mail erhalten und in Integrationsprüfungen nachweisen; nicht die frühere Claim-Funktion aus AB 3.7 als Endstand behandeln |

Bestellnummer, bestätigte Zeit, Ablehnungs-/Stornierungsgrund,
Erstattungsbetrag und sicherer Statuslink sind im gelesenen SMS-Job nicht
vorhanden. Vorlagen dürfen diese Werte nicht erfinden. Ihre autorisierten
Datenquellen und Ereignisse müssen vor der Umsetzung gelesen und bei Bedarf
innerhalb des Pakets ergänzt werden.

Die Planung liegt auf einem separaten Branch ab `main`. Der gelesene
Zahlungsstand aus PR #8 ist noch nicht gemergt. Eine Implementierung mit dessen
Zahlungsgrenzen benötigt einen dokumentierten Basisstand und eine passende
Integrationsbasis. Der bereits geprüfte PR-#8-Commit wird für diese Planung
nicht geändert.

### Spätere gebündelte lokale Abnahme

Die offenen Zahlungsfälle aus PR #8 bleiben in ihrer bestehenden Matrix.
Sobald lokaler Zugriff wieder möglich ist, werden kompatible Kriterien mit
denselben Testbestellungen geprüft:

1. Lieferung einschließlich Liefergebühr, Zahlungsablehnung, Wiederaufnahme
   nach Neuladen, 3DS, Erfolg und anschließend Storno/Erstattung.
2. Ausgebliebene beziehungsweise doppelte Anbieterereignisse und das Abschalten
   neuer Onlinebestellungen bei weiterhin aktiver Verarbeitung bestehender Jobs.
3. Regulärer Zehn-Minuten-Fristfall ohne Zahlung als eigener zeitlicher Ablauf,
   soweit möglich parallel zu unabhängigen Prüfungen.

Diese Fälle sind nicht durch die Planung oder einen synthetischen
E-Mail-Test erfüllt. E-Mail-Nachweise werden beim späteren gemeinsamen
Ablauf ergänzt, soweit sie zum dann tatsächlich integrierten Stand passen.
Bis dahin werden keine neuen zeitabhängigen Bestellungen angelegt.

### Qualität und Arbeitsaufteilung

- Jede A2-Anforderung bleibt einzeln zu einem Nachweis zuordenbar.
- Ein gemeinsamer Testablauf darf mehrere Kriterien erfüllen, wenn deren
  Voraussetzungen und Ergebnisse jeweils belegt sind.
- Negative Fälle, Mandantentrennung, Idempotenz und Zahlungsgrenzen entfallen
  durch die Bündelung nicht.
- Pflichtprüfungen laufen am endgültigen Implementierungsstand. Eine reine
  Planungsänderung erfordert eine Formatprüfung, keine behauptete Laufzeitabnahme.
- Fehlende lokale Nachweise werden als offen geführt, ohne andere unabhängig
  mögliche Arbeiten zu blockieren.
- Routineentscheidungen folgen der dokumentierten Empfehlung; vorbehaltene
  Endfreigaben bleiben bestehen.

## Umsetzungsnachweis vom 30.09.2026

Paket 1 ist in [Entwurfs-PR #10](https://github.com/PROVIDE-Webdesign/Provide-bestellsystem/pull/10)
technisch umgesetzt. Die Basis ist weiterhin der unveränderte PR-#8-Commit
`4e422f5b9ce7324e56bdb2b4e8d4cbd76ca3c8cc`; PR #10 ist darauf gestapelt.

Am endgültigen Implementierungs-Commit
`f947b8448d56ff4bf7bb4b7e6cdbc9b5bfb2f34d` sind `check` und `database` im
[CI-Lauf 36746300404](https://github.com/PROVIDE-Webdesign/Provide-bestellsystem/actions/runs/36746300404)
erfolgreich: 197 Unit-/Contracttests, 1.029 Datenbanktests und ein separater
API-Integrationslauf gegen die vollständig migrierte disposable Datenbank.
Darin enthalten sind Pflichtkontakt, offene Onlinezahlung, bestätigter Erstattungsbetrag,
zeitliche Konflikte, expliziter Lieferdispatch, Anbieterannahme versus Zustellung,
Idempotenz, unklare Annahme, abgelaufene Claims, Backoff, Versuchsgrenze,
Kontakt-Purge und rollenbegrenzter Retry. Die Dokumentation liegt in
`docs/decisions/0027-transactional-guest-email.md`,
`docs/runbooks/transactional-email.md` und
`docs/work-blocks/3.10-transactional-email.md`.

Es wurde ausschließlich mit einem injizierten synthetischen E-Mail-Adapter
geprüft. Echter Versand, echte Zustellung, Geräte-/Bedienabnahme und die offene
Stripe-Sandbox-Matrix aus PR #8 bleiben gesondert. Beide Implementierungs-PRs
bleiben Entwürfe; technische Endfreigabe, Merge und Deployment stehen aus.
Der Gesamtfortschritt nach A2 wird durch diesen Codeabschluss nicht automatisch erhöht.

## Nächster Schritt

Paket 2 „Menüpflege bis Warenkorb“ beginnt mit einer Bestandsaufnahme der
vorhandenen Funktionen und Nachweise. Erst die festgestellten Lücken bestimmen
die nächste Umsetzung. Die übrigen Pakete folgen der oben genannten Reihenfolge.
Für diese Vorbereitung ist keine Laptop-Aufgabe des Nutzers erforderlich.
