# Lokale Prüfung: 14-Tage-Frist und Vorbestellungen

Stand: 29.10.2026. Quellprüfung am unveröffentlichten P2-Kandidaten; keine neue Laufzeitprüfung,
keine Änderung an Fristen, Bestellungen oder Cloudflare. Keine GitHub Actions und kein Push. Ergänzt
E116/V6 und E122, ersetzt diese Nachweise nicht.

## Ergebnis

Ein Vorbestellfenster von 14 Tagen und eine Kontaktfrist von 14 Tagen ab Eingang belegen allein
keinen Fehler: Die Bereinigung prüft zusätzlich den Bestellstatus. Offene Bestellungen sind auch
nach Ablauf ihrer Kontaktfrist nicht löschbar durch die vorhandene Bereinigungsfunktion.

Die Frist beginnt ausdrücklich nicht mit der Abholung oder dem Abschluss. Eine Bestellung, die erst
an Tag 14 abgeschlossen wird, kann schon beim nächsten zulässigen Bereinigungslauf ihre Kontaktdaten
verlieren. Das entspricht der bisher beschlossenen Regel und dem vorbereiteten Datenschutzhinweis.
Eine weitere Nachbearbeitungsfrist wurde damit nicht beschlossen und wird hier nicht eingeführt.

## Nachvollzogene Quellstellen

- `supabase/migrations/20260915110000_create_public_guest_pickup_checkout.sql`: Kontaktfrist aus
  `order.created_at + make_interval(days => target_retention_days)`.
- `supabase/migrations/20261001135405_restaurant_controls_configuration.sql`: Vorbestellgrenze prüft
  `requested_for > evaluated_at + maximum_advance_days`; Gleichheit wird durch diese einzelne
  Bedingung nicht ausgeschlossen. Die übrigen Öffnungszeit-, Vorlauf- und Kapazitätsprüfungen gelten
  weiterhin.
- `supabase/migrations/20260914020000_create_guest_checkout_privacy_boundary.sql`:
  `purge_expired_guest_checkout_data` wählt nur unbereinigte Kontakte mit abgelaufener Frist und
  Status `completed`, `rejected` oder `cancelled`. Sie setzt Kontakt- und gegebenenfalls
  Lieferadressfelder auf NULL; technische Bestelldaten werden durch diese Funktion nicht gelöscht.
- `supabase/migrations/20261001201710_history_metrics_guest_purge.sql`: Scheduler-Aufruf verarbeitet
  höchstens 500 Kontakte pro Lauf, sperrt konkurrierende Aufrufe und begrenzt protokollierte Läufe
  auf einen Abstand von fünf Minuten. Dies ist keine garantierte Löschung exakt am Fristende; ein
  Rückstand ist zu prüfen.
- `supabase/migrations/20260916012000_extend_delivery_projections.sql`: reguläre Dashboard-Details
  berücksichtigen bei der Kontaktanzeige `purged_at`. Der Ablauf der Frist allein löscht den Kontakt
  nicht.
- `supabase/migrations/20261001201710_history_metrics_guest_purge.sql`: Namenssuche und
  Kontaktdetails in der Historie berücksichtigen zusätzlich die Frist. Die Historie ist deshalb kein
  geeigneter alleiniger Nachweis dafür, ob Kontakte einer noch offenen Bestellung gespeichert bzw.
  im operativen Dashboard erreichbar sind.
- `supabase/migrations/20260930154016_transactional_guest_email.sql`: neue E-Mail-Sendeversuche
  werden bei abgelaufener Kontaktfrist unterdrückt, unabhängig vom weiterhin offenen Bestellstatus.
  Das betrifft den späteren Versandbetrieb; derzeit ist kein externer Versand freigegeben. Eine neue
  Frist oder eine Freigabe für E-Mail ergibt sich aus dieser Prüfung nicht.
- `apps/storefront/app/storefront/CheckoutPrivacyNotice.tsx`: beschreibt Fristbeginn, Ausnahme
  offener Bestellungen und den noch unbestätigten Aktivierungsstand bereits getrennt. Kein neuer
  Textwechsel erforderlich.

## Noch praktisch nachzuweisen

1. Neue synthetische Bestellung unter tatsächlicher API-Einstellung 14: gespeicherte Frist ist genau
   Eingang plus 14 Tage. Alte 30-Tage-Snapshots bleiben unverändert; Beginn der neuen Einstellung
   dokumentieren.
2. In einer isolierten Datenbank mit datierten Testdaten: offene Bestellung nach Fristende bleibt
   einschließlich Kontakt erhalten und operativ bearbeitbar; unbefristet offene Vorgänge brauchen
   organisatorische Klärung.
3. Abgeschlossene, abgelehnte und stornierte Bestellungen unmittelbar vor sowie genau am Fristende
   prüfen. Vor Fristende bleiben Kontakte erhalten, ab Fristende sind nur die beendeten Vorgänge
   bereinigungsfähig. Preise, Positionen und Status bleiben erhalten; wiederholte Bereinigung ist
   ohne weitere Änderung möglich.
4. Bestellung am Vorbestellrand und verspäteter Abschluss: keine Löschung im offenen Zustand; nach
   Abschluss und abgelaufener Frist ist Bereinigung zulässig. Reguläres Dashboard und Historie
   getrennt beurteilen.
5. Danach tatsächliche Scheduler-Einstellung, richtige Datenbank, Audit, Fehler und Rückstand
   prüfen. Kein zukünftiger Löschstichtag und keine Uhrmanipulation im laufenden System.

Diese Prüfung bestätigt Quellbedingungen, nicht deren tatsächliche Ausführung in der
veröffentlichten Umgebung. Es wurden keine neuen Datenbanktests ausgeführt. Für einen später
freigegebenen E-Mail-Betrieb ist die Behandlung noch offener Bestellungen nach Fristende gesondert
zu prüfen; das ist keine zusätzliche Versandanforderung für den gegenwärtigen Abholpilot.
