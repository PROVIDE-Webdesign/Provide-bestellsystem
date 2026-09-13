# Restaurant-Onboarding und kontrolliertes Go-live

## Status

Angenommen für Arbeitsblock 2.5.

## Entscheidung

Der Betriebszustand eines Restaurants oder Standorts bleibt von seinem Onboarding- und
Go-live-Zustand getrennt. `setup`, `active` und `suspended` beschreiben den operativen Zustand. Das
Onboarding verwendet `not_started`, `in_progress`, `ready_for_review` und `approved`. Die
Kundenfreigabe verwendet `blocked`, `ready`, `live` und `paused`.

Die Tabellen `restaurant_activation_states` und `location_activation_states` halten diese Zustände.
Neue Restaurants und Standorte erhalten ihre Aktivierungszeilen und die zugehörigen Prüfpunkte
automatisch. Bereits vorhandene Datensätze werden durch die Migration nachgezogen und starten
bewusst gesperrt.

## Checkliste und Übergänge

Verpflichtende Prüfpunkte sind in `onboarding_check_definitions` registriert. Die Ergebnisse werden
mandanten- und gegebenenfalls standortgebunden in `onboarding_check_results` gespeichert. Ein
freigegebenes Onboarding ist unveränderlich; notwendige Korrekturen erfordern später einen eigenen,
auditierten Rücksetzablauf.

Statuswechsel sind nur in der festgelegten Reihenfolge erlaubt:

1. Onboarding: `not_started` → `in_progress` → `ready_for_review` → `approved`
2. Go-live: `blocked` → `ready` → `live` → `paused` → `ready`

Die Browserrollen besitzen nur den durch Row Level Security eingeschränkten Lesezugriff. Änderungen
laufen ausschließlich über serverseitige Funktionen. Der Server muss dafür eine aktive Owner- oder
Manager-Mitgliedschaft und `aal2` nachweisen. Manager dürfen standortbezogene Schritte nur für ihre
ausdrücklich zugewiesenen Standorte ausführen.

## Freigabebedingungen

Ein Restaurant kann nur freigegeben werden, wenn es operativ aktiv und sein Onboarding genehmigt
ist, alle verpflichtenden Restaurantprüfungen bestanden sind, mindestens ein aktiver Owner besteht
und mindestens ein freigabefähiger Standort bereit ist. Ein Standort benötigt zusätzlich ein
genehmigtes Onboarding, bestandene Standortprüfungen, eine vollständige Adresse und ein live
geschaltetes Restaurant.

Die internen Prüffunktionen bewerten diese Bedingungen bei jeder Abfrage erneut. Eine nachträgliche
Suspendierung schließt das Gate deshalb sofort, auch wenn der gespeicherte Go-live-Status noch
`live` lautet.

Feature-Flags bleiben eine unabhängige zweite Schranke. Ein Go-live aktiviert insbesondere
`ordering.accept_orders` nicht automatisch.

## Nachvollziehbarkeit

Jeder erfolgreiche Statuswechsel erzeugt in derselben Transaktion einen unveränderlichen Eintrag in
`onboarding_transitions` und ein Ereignis in der transaktionalen Outbox. Fehlgeschlagene oder
unzulässige Übergänge hinterlassen keinen scheinbar erfolgreichen Verlauf.

## Folgen

- Kein Restaurant und kein Standort wird allein durch einen operativen Status öffentlich nutzbar.
- Mandanten-, Standort-, Rollen- und MFA-Grenzen bleiben auch während des Onboardings wirksam.
- Pausieren und Suspendieren schließen den Kundenzugriff fail-closed.
- Produktive Freigaben benötigen später weiterhin Umgebungs-, Betriebs- und Feature-Flag-Gates.

## Nicht Bestandteil

- Dashboard- oder Storefront-Oberflächen für das Onboarding
- Öffentliche Speisekarten, Warenkörbe, Bestellungen oder Zahlungen
- Automatische Aktivierung von Feature-Flags
- Produktive Supabase-Konfiguration, Zugangsdaten oder echte Restaurantdaten
- Die tatsächliche Live-Schaltung des Pilotrestaurants Asian Kitchen
