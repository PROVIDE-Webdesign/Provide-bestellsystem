# Runbook: Transaktionale Bestellbenachrichtigungen

## Sicherheitszustand

`NOTIFICATION_DISPATCH_ENABLED=false` bleibt die Repository- und Preview-Vorgabe. Der konfigurierte
Minuten-Trigger ruft den Handler zwar auf, ohne das exakte Flag, eine Hyperdrive-Bindung und einen
konfigurierten Adapter beansprucht er jedoch keinen Datenbankauftrag. Das Repository besitzt keinen
realen Versandadapter.

## Verarbeitungsablauf

1. Ein freigegebenes Bestellereignis erzeugt in derselben Transaktion einen PII-freien
   `notification_deliveries`-Eintrag.
2. Der Worker beansprucht höchstens 25 fällige Einträge mit einem zufälligen Sperrtoken.
3. Die Datenbank unterdrückt gelöschte Kontakte, inaktive Mandanten oder Standorte und durch einen
   neueren Bestellstatus überholte Meldungen.
4. Nur für tatsächlich beanspruchte Aufträge wird die geschützte Telefonnummer kurzzeitig an den
   Serverprozess ausgegeben.
5. Der Adapter erhält die Telefonnummer, den gerenderten Text und einen stabilen
   Idempotenzschlüssel.
6. Erfolg, temporärer Fehler oder permanenter Fehler werden über die besitzgebundene
   Abschlussfunktion zurückgeschrieben.

## Wiederholungen

Temporäre Fehler werden nach ungefähr 30 Sekunden, 2 Minuten, 10 Minuten, 30 Minuten und 2 Stunden
erneut eingeplant. Der sechste fehlgeschlagene Versuch endet in `dead_letter`. Eine nach fünf
Minuten abgelaufene Verarbeitungssperre wird sicher zurückgenommen; derselbe Idempotenzschlüssel
bleibt erhalten. Fremde oder verspätete Sperrtoken können einen Auftrag nicht abschließen.

## Protokollierung

Logs enthalten ausschließlich feste Ereignisnamen und eine zufällige Request-ID. Telefonnummern,
Namen, Bestell- und Zustell-IDs, Nachrichtentexte, Anbieterantworten und Exceptions werden nicht
protokolliert. `last_error_code` akzeptiert ausschließlich fest definierte technische Codes.

## Vor einer echten Anbieteranbindung

1. Anbieter, Sandbox, Idempotenzverhalten und Timeout-Semantik getrennt freigeben.
2. Datenschutzinformation, Auftragsverarbeitung, Löschfristen und zulässige Nachrichtentexte prüfen.
3. Secrets ausschließlich in der jeweiligen serverseitigen Plattformkonfiguration hinterlegen.
4. Mit synthetischen Empfängern Erfolg, Timeout nach Anbieterannahme, Duplikate, Rate Limits und
   dauerhafte Ablehnung nachweisen.
5. Kosten und SMS-Segmentierung der finalen Vorlagen prüfen.

Echte Empfänger, echte Nachrichten, Anbieterzugangsdaten und ein Deployment sind in Arbeitsblock 3.7
nicht freigegeben.
