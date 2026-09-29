# ADR 0025: Sichere Lieferbestellungen mit vollständigen PLZ-Gebieten

## Status

Arbeitsblock 3.8 ist vom Nutzer technisch endfreigegeben und mit erteilter Merge-Erlaubnis über PR
#7 in `main` zusammengeführt (`c3530b2dacdb814cfc2cc47664ab23b11ce878d0`).

## Entscheidung

Ein Standort veröffentlicht versionierte Lieferregeln für vollständige deutsche Postleitzahlgebiete.
Jede PLZ darf pro Version genau einmal vorkommen. Pro Zone gelten ein Mindestartikelwert und eine
feste Liefergebühr in EUR. Die Gebühr zählt nicht zum Mindestbestellwert. Null bedeutet kostenlose
Lieferung. Fehlende, unveröffentlichte oder nicht passende Konfigurationen schließen die Lieferung.
Es erfolgt keine Existenzprüfung von Straße oder Hausnummer und keine Entfernungsberechnung.

Die Pflege erfolgt über serverexklusive Funktionen mit erneuter Rollen-, AAL2- und Standortprüfung.
Entwürfe werden vollständig angelegt; Korrekturen erfolgen als neuer Entwurf. Veröffentlichte
Versionen und Veröffentlichungshistorie sind unveränderlich. Die letzte Veröffentlichung ist
wirksam; auch eine Rückkehr zu einer älteren veröffentlichten Version wird neu protokolliert.

## Preisvorschau und Transaktion

Die POST-Preisvorschau erhält Menüreferenzen, Mengen, Wunschzeit und PLZ. Die Datenbank ermittelt
Artikelpreise, Mindestwert, Gebühr und Verfügbarkeit. Der Browser bestätigt diese Übersicht. Beim
Absenden prüft der Server alle Werte erneut. Ein gemeinsames Standort-Lock serialisiert
Veröffentlichung und endgültige Prüfung. Änderungen an Regeln oder Gebühren verlangen eine neue
Bestätigung. Der bestehende Kapazitätsresolver sperrt konkurrierende Bestellungen auf denselben
Slot.

Bestellkopf, Artikel, Lieferregelreferenz, Gebühr, Zahlungsanforderung, Adresssnapshot, Kapazität
und Outbox werden in einer Transaktion geschrieben. Die Summe entspricht Artikelwert plus
Liefergebühr; die Zahlungsanforderung übernimmt diesen Gesamtbetrag. Der interne bepreiste Schreiber
ist auch für die Service-Rolle nicht direkt ausführbar. Bestehende interne Systemabläufe und
Abholung bleiben kompatibel; nur der neue öffentliche Lieferzugang verwendet die bestätigte
Preisvorschau.

Identische Wiederholungen verwenden die ursprüngliche Regelversion und den ursprünglichen Preis,
auch nach einer späteren Veröffentlichung oder Statusänderung. Veränderte Bestell- oder Adressdaten
unter demselben Schlüssel werden abgewiesen. Adressen werden nicht in Idempotenz-Payloads kopiert.

## Betrieb und Datenschutz

Die vorhandenen Schutzbereiche und Aufbewahrungsregeln werden weiterverwendet. Nur berechtigte Owner
und Manager erhalten im Dashboard die Lieferdetails. Küche, öffentliche Statusantworten, Outbox und
technische Logs enthalten keine Adressen. Bestehende standortgebundene Fahrerrechte werden nicht
erweitert. Eine Fahreroberfläche gehört nicht dazu.

Der bestehende Status `ready` bedeutet bei Lieferung „Bereit zur Auslieferung“, `completed` bedeutet
„Zugestellt“. Den Abschluss bestätigt die berechtigte Leitung. Es gibt in diesem Block keine
Fahrerzuweisung, keine Unterwegs-Meldung und keine automatische Ankunftsprognose. Benachrichtigungen
verwenden liefergerechte synthetische Vorlagen und keine Abholtexte.

`DELIVERY_ORDERING_ENABLED=false` sperrt die neue öffentliche Quote- und Checkout-Grenze. Checkout-,
Status-, Geheimnis- und Hyperdrive-Gates bleiben zusätzlich erforderlich. Reale Daten, Versand,
Zahlungen und Deployments sind nicht enthalten.
