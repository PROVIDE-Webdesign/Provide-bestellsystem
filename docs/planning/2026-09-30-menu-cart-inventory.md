# Paket 2: Bestandsaufnahme Menüpflege bis Warenkorb

Stand: 30.09.2026, Europe/Berlin. Auftrag: Bestandsaufnahme; keine neue Produktimplementierung.

## Ergebnis und verbindliche Grundlage

Das technische Fundament für einfache Gerichte ist vorhanden und getestet.
Menüpflege bis Warenkorb ist nach A2 noch nicht vollständig erfüllt.
Versionierung, Zeitveröffentlichung, Rollback, Standortverfügbarkeit und serverseitige
Grundpreise werden wiederverwendet. Fehlende Varianten, Extras, Allergene, Steuerdaten,
Pflegeoberfläche und verständliche Warenkorb-Neubewertung bilden den nächsten Schnitt.

Maßgeblich sind `PROVIDE_Bestellsystem_Architektur_Arbeitsplan_A2.md`, insbesondere
3.1, 7, 8/8.1, 9 und 15, sowie `PROVIDE_Bestellsystem_Projektprotokoll_V2.pdf`
einschließlich E01. Paket 2 bündelt Anforderungen der A2-Hauptblöcke 3 und 4;
Menübedienung berührt Hauptblock 6, Import/Parität Hauptblock 10.
Paketnummer 2 ist kein neuer A2-Hauptblock und kein Fortschrittsnenner.

Die Prüfung verwendet den Inhalt von PR #10 am Commit
`484ec2d1aa5e602f76476cc82fc65ca6692f078e`,
Baum `4672e41c607e985f9a77126dada053f9793162d1`.
Der lokale Prüfbaum stimmt damit überein; seine lokal rekonstruierten Commit-IDs
sind kein Ersatz für die GitHub-Referenz.
Basis des gestapelten Implementierungsstands bleibt PR #8 am Commit
`4e422f5b9ce7324e56bdb2b4e8d4cbd76ca3c8cc`.
Beide PRs bleiben Entwürfe. Die Dokumentation liegt auf dem getrennten Planungsbranch
von PR #9 und enthält keine Änderungen an Anwendung oder Datenbank.

## Befundmatrix

„Vorhanden“ bezeichnet den angegebenen Funktionsschnitt, keine vollständige A2-Abnahme.
„Teilweise“ trennt existierende Grundlage und verbleibende Anforderung.
„Offen“ bedeutet im geprüften Code nicht umgesetzt beziehungsweise nicht nachgewiesen.

| ID    | A2-Anforderung                                                   | Befund und Quelle                                                                                                                                                                                                                                                                                                          | Konsequenz für Paket 2                                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2-01 | Kategorien und einfache Gerichte, sortierte öffentliche Karte    | Vorhanden: `menu_version_sections/items`, `PublicCatalog`, öffentliche Projektion und Storefront zeigen Kategorien, Namen, Beschreibung und Grundpreis. Quellen M1, C1, U1, T3.                                                                                                                                            | Bestehenden Weg erweitern; keine zweite Katalogwahrheit.                                                                                                                                                     |
| P2-02 | Unsichtbare Entwürfe und unveränderliche Freigaben               | Vorhanden: kontrollierter Entwurf, Kopie einer freigegebenen Version, Trigger schützen veröffentlichte Inhalte. T1 prüft Kopie und Unveränderlichkeit; T3 prüft unsichtbare Entwürfe.                                                                                                                                      | Neue Auswahl-/Informationsdaten in denselben Kopier- und Schutzumfang aufnehmen.                                                                                                                             |
| P2-03 | Sofortige und geplante Veröffentlichung, Rollback                | Datenbank vorhanden: append-only `menu_publications`, Resolver nach Wirksamkeitszeit, `publish_menu_version` und `rollback_menu_version`. T1 prüft Vorher/Nachher und Rückkehr auf unveränderte Version.                                                                                                                   | Sichere API und Bedienung fehlen; gleichzeitige Veröffentlichungen und Grenzzeitpunkt mit laufendem Checkout zusätzlich nachweisen.                                                                          |
| P2-04 | Bewusste Freigabe, Änderungsnotiz, Vorschau, Versionenauswahl    | Teilweise: Autor, Zeitpunkt, Herkunft und Historie gespeichert. Änderungsnotiz fehlt in Version/Publication; keine Menüroute oder Pflegekomponente im Dashboard. Quellen M1, R1, U2.                                                                                                                                       | Entwurf bearbeiten, Änderungsvorschau, bestätigte Freigabe, lokale Zeitplanung und Rollbackauswahl ergänzen.                                                                                                 |
| P2-05 | Varianten mit versionsgebundenem Preis                           | Offen: keine Variantenentität, kein DTO, keine Positionsauswahl. `CartLine` und Requests kennen nur Artikel-ID/Menge. Quellen M1, C1/C2, U1.                                                                                                                                                                               | Varianten durchgängig von Entwurf bis unveränderlicher Bestellposition ergänzen.                                                                                                                             |
| P2-06 | Extras und Pflicht-/Min-/Max-Auswahlregeln                       | Offen: keine Optionsgruppen/Optionen, Auswahlgrenzen oder Preisaufschläge im geprüften Schema und Vertrag.                                                                                                                                                                                                                 | Serverseitig validierte Auswahlregeln und Aufschläge; keine Browserautorität.                                                                                                                                |
| P2-07 | Allergene und zusätzliche Produktinformationen                   | Offen: keine strukturierten Allergen-/Zusatzstoffdaten in Katalog, Vertrag, Oberfläche. ADR 0013/0015 nennen diese ausdrücklich als damals nicht enthalten.                                                                                                                                                                | Informationsmodell und Anzeige ergänzen; fehlende fachliche Restaurantangaben nicht erfinden.                                                                                                                |
| P2-08 | Steuerangaben und vollständige Positionssnapshots                | Teilweise: Grundpreis und Name werden unveränderlich gespeichert; Steuersatz/-anteil und Varianten-/Extras-Snapshots fehlen. Quellen M1, M2, C2, T2.                                                                                                                                                                       | Versionsgebundene, fachlich bestätigte Steuerdaten und reproduzierbare Cent-Berechnung/Snapshots ergänzen; keine stillen Rückrechnungen historischer Bestellungen.                                           |
| P2-09 | Validierung vor Veröffentlichung                                 | Teilweise: FKs, Preisgrenzen, Pflichtnamen, Währung und mindestens ein aktiver Artikel geprüft. Keine Prüfung der noch fehlenden Auswahl- und Steuerdaten. Quelle M1.                                                                                                                                                      | Vollständigkeitsprüfung vor Freigabe erweitern; verständliche Feldfehler und konsistente Vorschau.                                                                                                           |
| P2-10 | Produkt-/Variantenverfügbarkeit mit optionalem Ende              | Teilweise: `available/sold_out/unavailable` je Standort für ganze Artikel, Übergangshistorie und Outbox vorhanden. Kein Ablaufzeitpunkt, kein Variantenstatus, keine Bedienroute. Quellen M1, T1/T3.                                                                                                                       | Modell und Prüfung für gezielte, befristete Sperren ergänzen. Produktebene in Paket 2; ganze Kanal-/Restaurantpausen in Paket 3.                                                                             |
| P2-11 | Server bestimmt aktuelle Menüversion und Preise                  | Vorhanden für einfache Artikel: Pickup-Abgabe sowie Lieferquote/-abgabe prüfen wirksame Version, Artikelstatus/Mengen und berechnen Cent-Summen aus freigegebenen Daten. Quellen M2/M3, C2, T2/T4/T5.                                                                                                                      | Gemeinsame Preis-/Auswahlregeln für Abholung, Lieferung und Onlinezahlung erhalten und erweitern.                                                                                                            |
| P2-12 | Änderungen zwischen Warenkorb und Abgabe verständlich bestätigen | Teilweise: falsche/überholte Version wird abgewiesen. Storefront zeigt bei 409 allgemeinen Hinweis; erneutes Katalogladen leert den Warenkorb. Keine positionsweise Neubewertung oder Bestätigung einer neuen Summe. Quellen M2/M3, U1.                                                                                    | Autoritative Neubewertung mit erhaltenen passenden Auswahlen, erklärten Änderungen und erneuter Kundenbestätigung vor Abgabe.                                                                                |
| P2-13 | Konfigurierte Positionen getrennt zusammenführen                 | Einfacher Warenkorb vorhanden: Hinzufügen, Menge/Entfernen und Anzeigesumme. Zusammenführung nur nach `menuItemId`; derselbe Artikel mit verschiedenen Auswahlen wäre nicht unterscheidbar. Quelle U1, T6.                                                                                                                 | Kanonischer Positionsschlüssel aus Artikel, Variante und Optionen; Limits für Gesamtmenge und verschiedene Positionen gemeinsam durchsetzen.                                                                 |
| P2-14 | Lokaler 24-Stunden-Warenkorb                                     | Offen: Warenkorb nur im React-State; Speicherzugriffe betreffen Status-/Zahlungszugänge. Katalog-Refresh leert die Positionen. Quelle U1.                                                                                                                                                                                  | Versionierte, standortgebundene Speicherung ohne Kundendaten; Ablauf und Speicherausfall behandeln; Wiederherstellung stets serverseitig neu prüfen.                                                         |
| P2-15 | Mandanten-/Standortrechte und MFA für Pflege                     | Grundlage vorhanden: Owner/Manager, aal2 und Standortzuordnung bei Veröffentlichung/Verfügbarkeit; Browser ohne direkte Schreibrechte. Entwurferzeugung arbeitet restaurantweit ohne Standortparameter. Quellen M1, T1.                                                                                                    | Authentifizierte API leitet Akteur/aal aus verifiziertem Token ab. Gemeinsame Menüpflege und standortbegrenzte Veröffentlichung ausdrücklich unterscheiden; keine frei übermittelten Berechtigungsparameter. |
| P2-16 | Audit und versionierte Menüereignisse                            | Teilweise: append-only Publication-/Verfügbarkeitsverlauf und transaktionale Outbox vorhanden. Ereignisnamen sind `menu.version.published/scheduled/rolled_back`; A2 nennt `menu.published.v1`. Keine neue Pflege-/Änderungsnotiz-Historie. Quelle M1.                                                                     | Bestehende Verbraucher erhalten; kanonischen Ereignisvertrag samt Version/Scope/Korrelation und Bearbeitungsnachweis abgleichen, bevor ein Name geändert wird.                                               |
| P2-17 | Import und Parität mit 12.0 R1                                   | Offen: Repository-Fixtures sind synthetische Testküche, kein nachgewiesener Asian-Kitchen-Import. Die freigegebene Datei `Asian_Kitchen_Arbeitsblock_12_0_R1.html` ist als Quelle auffindbar. A2 nennt zwölf Gerichte/drei Kategorien. Die HTML-Inhalte wurden hier nicht vollständig extrahiert oder auf Parität geprüft. | Quelle geschützt lesen, reproduzierbaren Import/Diff vorbereiten; fehlende Steuer-/Allergendaten ausdrücklich ausweisen. Keine Produktivveröffentlichung oder Änderung der Marketing-SoT.                    |
| P2-18 | Mobile/barrierearme Bedienung und vollständige Abnahme           | Teilweise: existierendes Storefront-/Dashboard-Grundgerüst. Neue Menü-/Auswahlbedienung fehlt, damit auch deren Tastatur-, Fokus-, Screenreader- und Gerätebelege.                                                                                                                                                         | Automatische Bedienprüfungen am späteren Implementierungsstand; echte Geräte-/Restaurantabnahme separat offen führen.                                                                                        |

## Nachweisquellen

| Kürzel | Datei oder Bereich                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1     | `supabase/migrations/20260913050000_create_versioned_menu_catalog.sql`; nachfolgende Rechtepräzisierung `20260913053000_restrict_menu_catalog_service_role.sql` |
| M2     | `supabase/migrations/20260913080000_create_order_snapshot_lifecycle.sql`; öffentlicher Pickup-Zugang `20260915110000_create_public_guest_pickup_checkout.sql`   |
| M3     | `supabase/migrations/20260916010000_create_secure_delivery_orders.sql`; `20260916011000_create_delivery_checkout.sql`                                           |
| C1     | `packages/contracts/src/storefront.ts`; `storefront-output.ts`; öffentliche SQL-Projektion `20260914150000_create_public_storefront_reads.sql`                  |
| C2     | `packages/contracts/src/checkout.ts`; `delivery.ts`; `online-payment.ts`; API-Writer für Abholung/Lieferung/Onlinezahlung                                       |
| R1     | `apps/api/src/router.ts`; `apps/dashboard/app/api/`: Bestell- und Zugriffswege, keine Menüpflege                                                                |
| U1     | `apps/storefront/app/storefront/Storefront.tsx`; `cart.ts`                                                                                                      |
| U2     | `apps/dashboard/app/components/DashboardClient.tsx`; `OrderBoard.tsx`                                                                                           |
| T1     | `supabase/tests/0010_versioned_menu_catalog.test.sql` (77 Prüfungen)                                                                                            |
| T2     | `supabase/tests/0012_order_snapshot_lifecycle.test.sql` (57 Prüfungen)                                                                                          |
| T3     | `supabase/tests/0015_public_storefront.test.sql`                                                                                                                |
| T4     | `supabase/tests/0016_public_guest_pickup_checkout.test.sql`; `apps/api/src/storefront.integration.test.ts`                                                      |
| T5     | `supabase/tests/0021_secure_delivery_orders.test.sql`; `apps/api/src/delivery.integration.ts`; Onlinezahlungsregressionen                                       |
| T6     | `apps/storefront/app/storefront/cart.test.ts` (drei einfache Warenkorbfälle); `packages/contracts/src/checkout.test.ts`                                         |

Der bestehende [CI-Lauf 36753000640](https://github.com/PROVIDE-Webdesign/Provide-bestellsystem/actions/runs/36753000640)
ist am geprüften Commit erfolgreich: `check` und `database`, 206 Unit-/Contracttests,
1.042 pgTAP-Tests und ein separater API-Integrationslauf; die isolierte
Supabase-Sicherheitsprüfung meldet „No issues found“.
Diese Zahlen zählen alle bisherigen Pakete, keine neu geschriebenen Paket-2-Tests.
Die vorhandenen Nachweise werden gemäß E01 wiederverwendet; ihre Ergebnisse
belegen weder die fehlenden Funktionen noch eine Geräte- oder Pilotabnahme.

Diese Bestandsaufnahme verändert nur Dokumentation. Dafür genügt die
Repository-Formatprüfung; ein weiterer vollständiger Anwendungslauf würde
keine neue Laufzeitbehauptung rechtfertigen.

## Empfohlene Umsetzung in Abhängigkeitsreihenfolge

1. **Gemeinsames Menü- und Auswahlfundament bis Preisprüfung.**
   Versionsgebundene Varianten, Optionsgruppen/Extras, Produktinformationen und
   fachlich bestätigte Steuerdaten; strikte Request-/Antwortverträge;
   kanonische Auswahlidentität, Serverberechnung und vollständige Snapshots.
   Dieselben Regeln für Pickup, Delivery und Onlinezahlung, einschließlich
   Lieferminimum/-gebühr, Idempotenz und Zahlungsbetrag.
   Ein eigener serverseitiger Neubewertungsweg liefert verständliche Konflikte.
   Historische einfache Positionen bleiben ohne erfundene Auswahl-/Steuerdaten lesbar.
2. **Menüpflege und bewusste Freigabe im Dashboard.**
   Auf vorhandenen Entwurfs-/Veröffentlichungsfunktionen aufbauen: sichere
   Bearbeitungsbefehle, Vorschau/Diff, Änderungsnotiz, Freigabevalidierung,
   lokale Zeitplanung, Versionen und Rollback. Owner/Manager/MFA/Scope,
   veraltete Bearbeitungsstände, konkurrierende Aktionen und Audit gemeinsam prüfen.
3. **Auswahlbedienung, Warenkorb und Paritätsnachweis.**
   Varianten/Extras/Informationen mobil und tastaturbedienbar darstellen,
   Konfigurationen getrennt führen, Neubewertung erklären und bestätigen lassen.
   24-Stunden-Speicherung mit sicheren Scope-/Ablaufgrenzen.
   Befristete Produkt-/Variantensperren durchgehend prüfen.
   Geschützte Pilotquelle extrahieren und den Importdiff liefern.
   Fachlich unabhängige Änderungen bleiben getrennte, aufeinander aufbauende Commits/PRs.

Empfehlungen innerhalb des freigegebenen A2-Umfangs folgen der delegierten
Routineentscheidung. Keine neuen Produktgrenzen, Anbieter, Kosten oder
Livefreigaben werden hier eingeführt. Die Reihenfolge ist eine Abhängigkeit,
keine Aufforderung zur gleichzeitigen Umsetzung aller drei Schnitte.

## Erforderliche Abschlussfälle für Paket 2

| Fall                        | Erwarteter Nachweis                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entwurf, Kopie und Freigabe | Unveröffentlichtes nie öffentlich; alle erweiterten Daten beim Kopieren erhalten und nach Freigabe unveränderlich.                                                |
| Varianten/Extras            | Pflichtauswahl, Min/Max, doppelte/fremde/inaktive IDs, Mengen und Preisaufschläge serverseitig geprüft; Konfigurationen bleiben getrennt.                         |
| Preis, Steuer und Snapshot  | Cent-Berechnung, Aufschläge, Gebühren und Zahlungsbetrag stimmen überein; historischer Snapshot bleibt bei Veröffentlichung/Rollback unverändert.                 |
| Wechsel während Checkout    | Sofort-/Zeitfreigabe und Rollback vor/bei Abgabe: gültige autoritative Version; alter Warenkorb erhält erklärten Vergleich und erneute Bestätigung.               |
| Konkurrenz                  | Echte parallele Freigaben/Bearbeitungen und Checkout gegen Verfügbarkeitswechsel; keine bloße nacheinander ausgeführte Simulation als Konkurrenzbeleg.            |
| Verfügbarkeit               | Artikel/Variante ausverkauft, befristetes Ende und verspäteter Hintergrundjob; neue Auswahl gesperrt, gespeicherte Bestellung unverändert.                        |
| Rechte                      | Mandantenfremde IDs, nicht zugeordnete Standorte, Küche/Fahrer/aal1, CSRF und manipulierte Akteursangaben abgewiesen.                                             |
| Speicherung                 | Restaurant-/Standortwechsel, 24-Stunden-Grenze, beschädigter Speicher, neuer Menüstand und Speicherausfall; keine Kundendaten im Warenkorb.                       |
| Parität                     | Zwölf Gerichte/drei Kategorien nach A2 mit der tatsächlichen 12.0-R1-Quelle vergleichen; Preise/Auswahlen/Informationen und offene Fachangaben einzeln ausweisen. |
| Bedienung                   | Tastatur, Fokus, Screenreader und mobile Auswahl-/Fehlermeldungen; echte Geräte-/Restaurantprüfung bleibt ein eigener Nachweis.                                   |

Zum späteren technischen Paketabschluss: Pflichtjobs `check` und `database`
am endgültigen Implementierungs-Commit, relevante API-/PostgreSQL-Integration,
Sicherheitsprüfung, Runbook und eine Matrix mit einzeln belegten Kriterien.
Reale Stripe-Fälle aus PR #8, echte E-Mail-Zustellung sowie Merge/Deployment
werden dadurch nicht freigegeben.

## Fortschritt und nächster Schritt

Keine Fortschrittsanhebung durch diese Bestandsaufnahme.
Vorläufige A2-Planabdeckung weiterhin rund **50 % ±10 Prozentpunkte**:
historische Arbeitsannahme 5¾ / 12 gleich gewichtete Hauptblöcke = 47,9 %,
gerundet 50 %. Keine verbindliche Neu-Gewichtung, Zeitfortschritt oder Vollabnahme.

Nächste Aufgabe: den ersten Umsetzungsschnitt „Gemeinsames Menü- und
Auswahlfundament bis Preisprüfung“ konkret abgrenzen und technisch umsetzen.
Empfohlener Modus dafür: **Work / Sol / hoch**, weil Auswahlregeln,
Mandantenrechte, historische Snapshots und Zahlungsbeträge zusammenwirken.
Für diese Arbeit ist keine Laptop-Aufgabe des Nutzers erforderlich.
