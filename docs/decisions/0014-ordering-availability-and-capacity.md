# Bestellbarkeit, Zeitfenster und Kapazitätssteuerung

## Status

Angenommen für Arbeitsblock 2.7.

## Entscheidung

Die Bestellbarkeit wird serverseitig und fail-closed aus mehreren unabhängigen Schranken ermittelt.
Ein aktiver Standort allein genügt nicht. Restaurant und Standort müssen weiterhin das Go-live-Gate
erfüllen, die benötigten Feature-Flags müssen aktiv sein, eine veröffentlichte Speisekarte und ein
wirksamer Bestellzeitplan müssen vorliegen und der gewünschte Zeitpunkt muss alle Zeit- und
Kapazitätsregeln erfüllen.

`availability_schedule_versions` hält die versionierten Einstellungen eines Standorts. Die
zugehörigen `availability_windows` trennen Abholung und Lieferung und erlauben auch Zeiträume über
Mitternacht. `availability_exceptions` ersetzt die Wochenregel für einen lokalen Kalendertag durch
eine vollständige Schließung oder abweichende Zeiten. Vorlauf, maximaler Bestellhorizont,
Slot-Raster und Standardkapazitäten gehören zur Version.

Nur Entwürfe dürfen verändert werden. Eine Veröffentlichung friert Einstellungen, Wochenfenster und
Ausnahmen dauerhaft ein. `availability_publications` bildet eine unveränderliche Wirksamkeitslinie;
eine geplante Umstellung oder Rückkehr zu einer früheren Version erfolgt durch einen neuen Eintrag
und nicht durch das Umschreiben von Historie.

## Zeit und Zeitzone

Der fachliche Bestellzeitpunkt wird als `timestamptz` gespeichert und für die Fensterprüfung in die
Zeitzone des Standorts umgerechnet. Dadurch bleiben lokale Betriebszeiten über UTC-Verschiebungen
und Sommerzeitwechsel hinweg auswertbar. Fehlt eine gültige PostgreSQL-Zeitzone, wird keine
Bestellbarkeit angenommen.

Der Resolver ordnet einen zulässigen Zeitpunkt dem veröffentlichten Slot-Raster zu. Vorlauf und
Bestellhorizont werden gegen den explizit übergebenen Auswertungszeitpunkt geprüft. Dieser Parameter
ermöglicht reproduzierbare Tests und verhindert versteckte Abhängigkeiten von der Systemzeit.

## Betriebspausen

Kurzfristige Stopps verändern keinen veröffentlichten Zeitplan. `ordering_pause_events` speichert
Pause und Wiederaufnahme append-only, wahlweise für den gesamten Standort oder nur für Abholung
beziehungsweise Lieferung. Jede Pause benötigt ein Ende in der Zukunft. Eine abgelaufene Pause
schließt den Standort nicht mehr; die Ereignishistorie bleibt erhalten.

## Kapazität und Überbuchungsschutz

`ordering_capacity_claims` speichert ausschließlich technische, idempotente Reservierungs- und
Freigabereferenzen mit Bestell- und Artikelanzahl. Es werden keine Kunden-, Adress-, Zahlungs- oder
Speisekartendaten aufgenommen.

`private.reserve_ordering_capacity` ermittelt zunächst den Slot, serialisiert danach konkurrierende
Zugriffe auf genau diesen Standort-, Erfüllungsart- und Slot-Schlüssel und prüft die Kapazität unter
der Sperre erneut. Erst dann wird die Reservierung geschrieben. Wiederholungen mit demselben
Schlüssel sind idempotent; eine abweichende Wiederverwendung wird abgewiesen. Freigaben erfolgen als
einmalige append-only Gegenbuchung. Damit kann ein späterer Bestellblock Kapazität anbinden, ohne
hier bereits eine Bestellung oder einen Warenkorb einzuführen.

## Sicherheit und Nachvollziehbarkeit

1. Alle fachlichen Beziehungen führen Restaurant und Standort gemeinsam und verhindern Kombinationen
   über Mandantengrenzen hinweg.
2. Owner und Manager benötigen eine aktive Mitgliedschaft und `aal2`; Manager bleiben auf ihre
   ausdrücklich zugewiesenen Standorte beschränkt.
3. Browserrollen erhalten ausschließlich RLS-gefilterte Lesezugriffe und keine direkten
   Schreibrechte.
4. Versionserstellung, Veröffentlichung und Betriebspausen laufen über kontrollierte serverseitige
   Funktionen.
5. Veröffentlichungen, Pausen und Kapazitätsbuchungen sind append-only.
6. Jede erfolgreiche operative Änderung erzeugt im selben Datenbankvorgang ein minimiertes Ereignis
   in der transaktionalen Outbox.
7. Der interne Bestellbarkeitsresolver ist weder für `anon` noch für `authenticated` ausführbar.

## Folgen

- Öffnungs- und Feiertagsregeln sind reproduzierbar und zeitlich planbar.
- Abholung und Lieferung können unabhängig voneinander geschlossen werden.
- Temporäre Stopps benötigen keine Änderung historischer Zeitpläne.
- Kapazitätsgrenzen werden auch bei konkurrierenden Anfragen atomar durchgesetzt.
- Fehlende oder widersprüchliche Voraussetzungen führen zu einer geschlossenen Bestellbarkeit.

## Nicht Bestandteil

- Warenkorb, Bestellung, Zahlung, Liefergebiet, Liefergebühr oder Adressprüfung
- Automatische Kapazitätsableitung aus realen Bestellungen oder Küchengeräten
- Dashboard- oder Storefront-Oberflächen
- Produktvarianten, Extras sowie rechtlich verbindliche Allergen- und Zusatzstoffangaben
- Produktive Feature-Aktivierung, Zugangsdaten, echte Kunden- oder Restaurantdaten
- Integration oder Funktionsänderung der bestehenden Asian-Kitchen-Website
