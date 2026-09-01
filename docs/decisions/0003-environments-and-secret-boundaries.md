# 0003 - Umgebungen und Secret-Grenzen

- Status: bestätigt
- Datum: 2026-09-01

## Entscheidung

Das PROVIDE-Bestellsystem verwendet vier klar getrennte Laufzeitumgebungen:

1. `development` für lokale Entwicklung mit synthetischen Daten.
2. `test` ausschließlich für automatisierte Tests.
3. `preview` als stagingähnliche Vorschau und erster Asian-Kitchen-Testbetrieb ohne echte Zahlungen
   oder Kundendaten.
4. `production` erst nach gesondertem Go-live-Gate.

Öffentliche Konfigurationen tragen das Präfix `PUBLIC_` und werden explizit über
`@provide/config/public` freigegeben. Datenbankzugänge, Sitzungsgeheimnisse und spätere
Anbieterschlüssel sind ausschließlich über `@provide/config/server` verfügbar.

## Konsequenzen

- Keine Umgebung teilt Datenbanken, Schlüssel oder Sitzungsgeheimnisse mit einer anderen Umgebung.
- Echte Secrets werden nur im Secret-Speicher der jeweiligen Plattform verwaltet.
- `.env.example` enthält ausschließlich ungefährliche lokale Beispielwerte.
- Fehlende oder ungültige Pflichtwerte verhindern den Anwendungsstart.
- Preview darf bis zur späteren Pilotfreigabe nur synthetische Testdaten verarbeiten.
