# Menüpflege und Warenkorb: Prüfung und Aktivierung

## Voraussetzungen

Aufbau auf Menüfundament ADR0028. Alle Migrationen einschließlich
`20261001010459_menu_cart_completion.sql` zuerst in einer isolierten Prüfumgebung anwenden.
`DASHBOARD_AUTH_ENABLED`, `DASHBOARD_MENU_ENABLED` und `CART_QUOTE_ENABLED` sind kontrollierte
Runtime-Voraussetzungen; neue Flags bleiben in `.env.example` ausgeschaltet. Verifizierter Login mit
AAL2 sowie Owner-/Standortmanagerrechte sind für die Pflege erforderlich. Keine Schlüssel an Browser
geben.

## Gebündelter Prüflauf

1. `pnpm check`: Format, Typen, Lint, Unit-Tests und Builds.
2. CI-Datenbankjob: vollständige pgTAP-Suite, Security Advisors und API-Integration gegen isolierte
   Datenbank.
3. CI-Browserjob: reale Storefront-/Editor-Komponenten mit synthetischen Antworten, Chromium,
   Firefox und WebKit bei 1440 und 390 Pixeln; Auswahlgrenzen, Wiederherstellung, Quote/Bestätigung,
   Konflikt, Ablauf, Entwurfskopie und Deklarationsbestätigung. Screenshots liegen im
   Workflow-Artefakt.

API-/SQL-Integration prüft echten Entwurf, Konfliktrevision, Veröffentlichung, Preisänderung,
Variantenstopp, blockierte Bestellabgabe, Freigabe, Bestellung, historischen Snapshot und Rollback.
Ein zusätzlicher Test prüft Datenbankzeitpunkte gegen den tatsächlichen UI-Vertrag.

## Praktische Abnahme

Mit fachlich bestätigten Pilotdaten einen Entwurf erstellen, Kategorien und Artikel ordnen,
Varianten, Optionsgrenzen, Allergene, Zusatzstoffe und Produktsteuer prüfen. Vorschau und
Veröffentlichung bewusst bestätigen. Anschließend Abholung und Lieferung einschließlich
Termin/Postleitzahl prüfen. Einen offenen Warenkorb bei Menüänderung und zeitlichem Stopp erneut
bewerten; Details im Restaurantauftrag vergleichen.

Reale Mobilgeräte, Safari, Tastatur und Screenreader sowie tatsächliche Sitzungen sind zusätzliche
Abnahmen. Synthetische Browserantworten belegen diese externen Bedingungen nicht. Pilotimport,
Steueraufteilung und Providerfälle bleiben gesondert offen. Aktivierung, Merge und Deployment
benötigen die spätere Endfreigabe und wurden in diesem Arbeitsblock nicht durchgeführt.

## Fortsetzung 3.13

Die vollständige technische Steueraufteilung und der geschützte Importweg sind in
[Arbeitsblock 3.13](../work-blocks/3.13-tax-pilot-acceptance.md) umgesetzt. Bestätigte Pilotdaten,
der tatsächliche Staging-Import und echte Geräteabnahmen bleiben offen; die frühere technische
Steuerlücke ist damit weiterbearbeitet.
