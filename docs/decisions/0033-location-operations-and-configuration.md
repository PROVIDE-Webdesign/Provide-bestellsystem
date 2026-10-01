# ADR0033: Temporärer Betriebsmodus und versionierte Standortregeln

## Umfang und vorhandene Grundlagen

B3/B4 schließen die sichere Bedienung der vorhandenen Zeitpläne, Sondertage und Lieferregeln an.
`availability_schedule_versions`, Fenster, Ausnahmen, Veröffentlichungen, Pausen, Kapazitätsclaims
und PLZ-Lieferregeln bleiben die fachlichen Grundlagen. Keine neue Menü-, Zahlungs- oder
Go-live-Architektur. Neuer API-/Dashboard-Schalter `DASHBOARD_LOCATION_OPERATIONS_ENABLED=false`.

## Temporäre Regeln

Owner/Manager mit AAL2 und aktueller Standortberechtigung setzen eine vollständige Pause, eine
Kanalpause oder Vorlauf-/Bestell-/Artikelkapazitätswerte. Ein leerer Wert erbt die reguläre Regel;
ein Kanalwert hat Vorrang vor dem globalen Wert. Vollständige Pause und Kanalpause werden unabhängig
aufgelöst: Kanal-Wiederaufnahme kann eine vollständige Pause nicht beenden. Bestehende native Pausen
werden mit angezeigt und über denselben Bedienweg beendet.

Jede Änderung benötigt Grund, Akteur und Ablauf. UI bietet Minuten; Server begrenzt die Dauer auf 24
Stunden. Die aktuelle letzte Regel je Bereich gilt nur bis zu ihrem Ende. Ablauf erfordert keinen
Scheduler und aktiviert keine ältere temporäre Regel erneut. Der Server entscheidet anhand seiner
Zeit; Restdauer im Dashboard wird relativ zur empfangenen Serverzeit angezeigt. Bei
Netzunterbrechung ist die Anzeige ein letzter geladener Stand, keine Bestätigung einer Mutation.

Reguläre Obergrenze offener Bestellungen gilt für den ganzen Standort; globaler temporärer Wert
überschreibt sie. Zusätzlicher Kanalwert begrenzt diesen Kanal. Offen sind `submitted`, `accepted`,
`preparing`, `ready`, einschließlich noch nicht bezahlter Onlineaufträge. Abgeschlossene, abgelehnte
und stornierte Aufträge zählen nicht. Neue Pausen verändern angenommene Bestellungen nicht.

Finale Reservierung und Regeländerung nutzen zuerst das bestehende standortweite
`delivery-policy:<location>`-Transaktionslock. Auch die nativen Bestellschreiber sperren den
Standort vor Submission-, Menü- und Slotlocks; eine erst am Slot eingeführte Standortsperre würde
die vorhandene Liefersperrreihenfolge invertieren. Die Auswertungszeit berücksichtigt das Warten im
Statement. Dadurch können konkurrierende Checkouts in unterschiedlichen Kanälen/Slots die gemeinsame
Obergrenze nicht überschreiten. Bestehende Idempotenzantworten bleiben wiederholbar. Slotkapazität
zählt Reservierungen auch über Konfigurationsversionen; bei geändertem Raster werden überlappende
alte Slots konservativ berücksichtigt. Eine Veröffentlichung setzt belegte Kapazität nicht zurück.

## Konfigurationsentwurf und Veröffentlichung

Native Entwürfe erhalten Revision, Bestellschluss-Puffer, Annahmefrist, reguläre offene Grenze und
Lieferzonen. Wochenfenster (auch über Mitternacht), Sondertage, Vorlauf, Horizont, Slotlänge,
Bestell-/Artikelkapazität, PLZ-Mindestwerte und Centgebühren werden vollständig pflegbar. Sondertage
verwenden die bisherige explizite Tagesregel ohne Mitternachtsüberschreitung.

Speichern prüft die geladene Revision; veröffentlichte Versionen sind unveränderlich.
Veröffentlichung prüft zusätzlich die bewusst geladenen aktuellen Zeitplan- und
Lieferregelreferenzen, validiert native Fenster und veröffentlicht Zeitplan sowie Lieferpolitik
atomar. In diesem Bedienweg wird unmittelbar veröffentlicht; existierende zukünftig geplante native
Veröffentlichungen verursachen einen Konflikt statt stiller Überschreibung. Eine frühere
veröffentlichte Version kann bewusst erneut aktiviert werden. Liefersteuerdeklaration wird von der
bei Prüfung aktuellen Lieferpolitik übernommen, fehlende Deklarationen bleiben unbekannt. Eine
Änderung des Menütax-Vertrags wird dadurch nicht freigegeben.

Der Bestellschluss-Puffer sperrt neue Bestellungen ab Ende des zum angefragten Erfüllungszeitpunkt
gehörenden lokalen Fensters minus Puffer. Zukunftsfenster werden nicht durch den heutigen
Bestellschluss gesperrt. Annahmefrist ist 1–60 Minuten, Standard weiter fünf. Eine neue bearbeitbare
Bestellung speichert die wirksame Frist zum tatsächlichen Eintritt der Bearbeitbarkeit einmal;
Wartezeit auf Locks verbraucht keine Frist. Änderungen verschieben keine laufende Frist und ändern
weder Zahlungsfrist noch die manuelle Timeout-Regel.

## Schutz, Nachweise und Grenzen

Alle Operationen laufen über verifizierte Bearer-Identität, frische Datenbankrollen und AAL2.
Browserrollen haben keine direkte RPC-Schreibgrenze. RLS bleibt aktiv; neue private Tabellen sind
auch für service_role direkt gesperrt. Ereignisse und Audit speichern Grund/Akteur/Vorher/Nachher
append-only. Bounded Response enthält keine Kunden-, Adress- oder Zahlungsdaten.

Automatik umfasst Verträge, API-Gates, Gateway/CSRF, native Datenbankfunktionen, Parallelität und
Dashboardbedienung auf drei Browserengines. Synthetischer Browsertransport ersetzt keine reale
Geräte-/MFA-/Betriebsabnahme. F01–F03 bleiben eingefroren; kein Merge, Deployment oder Liveauftrag.

Referenzen: A2 §9/9.1; ADR0014, ADR0025, ADR0032; Supabase Database Functions
<https://supabase.com/docs/guides/database/functions>; PostgreSQL Advisory Locks
<https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS>.
