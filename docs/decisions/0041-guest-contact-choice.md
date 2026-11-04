# ADR 0041 - Name und eine Kontaktmöglichkeit im Gastcheckout

Status: Fachlich bestätigt am 28.10.2026; lokaler Änderungskandidat, noch nicht bereitgestellt.

## Entscheidung

Für Abholung sind ein Kontaktname und mindestens eine gültige Kontaktmöglichkeit erforderlich:
E-Mail oder Telefon. Beide dürfen angegeben werden. Diese Entscheidung ersetzt die Telefonpflicht
aus ADR 0017 und die spätere E-Mail-Pflicht aus ADR 0027 im Abholpfad.

Fehlende, leere oder nur aus Leerzeichen bestehende Kontaktfelder werden als `null` normalisiert.
Ein zusätzlich ausgefülltes ungültiges Feld bleibt ein Fehler. Andere Datentypen und unbekannte
Felder bleiben unzulässig. E-Mail wird kleingeschrieben; Telefon behält das E.164-Format. Es gibt
keine Ersatzadresse und keinen erfundenen Ersatzempfänger.

Für Lieferung bleibt Telefon für den Empfänger erforderlich. E-Mail ist auch dort optional.
Online-Abholung verwendet denselben Kontaktparser; bestehende Zahlungs- und Freigabeschalter werden
nicht geändert. Daraus folgt keine Zahlungs- oder Lieferfreigabe.

## Gemeinsamer Ablauf

Native Storefront und Asian-Kitchen-Adapter verwenden denselben Kontaktparser. API und
Checkout-Schutz normalisieren vor dem Fingerabdruck und der SQL-Übergabe. Weglassen, Leerstring und
`null` ergeben dieselbe Darstellung. Eine nachträglich andere Kontaktangabe bleibt ein Konflikt bei
derselben Bestellung.

Die additive Migration erweitert den Kontakt-Constraint und die vorhandenen privaten
Snapshot-Funktionen. Sie bewahrt deren Identität, Rechte, Unveränderlichkeit und Löschbedingungen.
Vorhandene Migrationen werden nicht umgeschrieben. Bestehende Bestellungen mit beiden
Kontaktmöglichkeiten bleiben gültig.

SMS-Jobs ohne Telefon und Mail-Jobs ohne E-Mail werden über die vorhandenen Dispatcher unterdrückt.
Unklare frühere Zustellungen bleiben im bestehenden Abgleichverfahren. Der tokengebundene
Statuszugang im Browser funktioniert unabhängig von einer E-Mail-Adresse. Kontaktdaten bleiben
außerhalb von Warenkorb- und Wiederaufnahmespeichern, Statusantworten und Outbox-Payloads.

Das Dashboard-Detail verlangt weiterhin nur den bisherigen optionalen Kontaktnamen; der fehlende
Telefon-/E-Mail-Wert erzeugt dort kein neues Pflichtfeld. Es werden keine zusätzlichen Kontaktdaten
für weitere Rollen freigegeben.

## Bereitstellung und Prüfung

Zuerst die additive Migration im richtigen Projekt bereitstellen und prüfen; danach API und beide
Storefront-Wege gemeinsam aktualisieren. Eine neue Oberfläche vor der Migration könnte Abholaufträge
mit nur einer Kontaktmöglichkeit ablehnen. Ein Zurückrollen auf den früheren Telefon-Constraint ist
nach E-Mail-only-Bestellungen nicht ohne Datenprüfung möglich.

Regressionen: beide Einzelkontakte, beide Kontakte, fehlender Name/Kontakt, ungültige Zusatzangabe,
Null-/Leerwert-Normalisierung, identische Wiederholung ohne zweite Bestellung, geänderter Kontakt
als Konflikt, Versandunterdrückung, Rechte und Browserstatus. Der neue native Browserfall prüft pro
Restaurant eine andere Kontaktwahl in Desktop- und Mobilbreite.

Die beschlossenen 14 Tage für synthetische Testkontakte bleiben das separate Konfigurationspaket aus
E112. Weder Bereinigung noch Providerzugang werden hier aktiviert. Lokale Tests ersetzen die
späteren vollständigen Pflichtprüfungen und die technische Freigabe nicht. Während der Nutzerpause
erfolgen keine GitHub-Pushes, Actions oder PC-Zugriffe.
