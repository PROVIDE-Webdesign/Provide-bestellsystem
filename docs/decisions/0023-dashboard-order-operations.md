# ADR 0023: Dashboard-Bestellübersicht und kontrollierte Statusbefehle

## Status

Angenommen für Arbeitsblock 3.6.

## Entscheidung

Das Restaurant-Dashboard erhält eine begrenzte, standortbezogene Abholbestellliste, eine minimale
Detailprojektion und einen Statusbefehl. Jeder API-Aufruf verifiziert erneut Supabase-JWT, Rolle,
Authentifizierungsniveau, aktive Mitgliedschaft und Standortzuweisung. Die API verwendet danach
ausschließlich service-only Datenbankfunktionen; der Browser erhält keine direkten SQL-Rechte.

Owner und Manager benötigen `aal2`. Küche darf mit `aal1` arbeiten, sieht aber keinen Abholnamen und
darf nur `accepted`, `preparing` und `ready` anwenden. Fahrer bleiben ausgeschlossen. Für Management
wird ausschließlich der noch nicht gelöschte Abholname ausgegeben; Telefon, E-Mail und Lieferdaten
verlassen die Datenschutzgrenze nicht.

Listen sind auf 50 Einträge begrenzt und verwenden einen stabilen Cursor aus Abholzeit und
Bestell-ID. Statusbefehle müssen den erwarteten Ausgangsstatus mitsenden. Die Datenbank sperrt die
Bestellung, weist veraltete Befehle als Konflikt ab und delegiert erfolgreiche Änderungen an die
vorhandene Statusmaschine. Damit bleiben Statushistorie, Kapazitätsfreigabe und Outbox atomar.

## Folgen

Das Dashboard ist erstmals operativ nutzbar, ohne Benachrichtigung, Lieferung, Onlinezahlung oder
externe Integration vorzuziehen. Aktualisierung erfolgt zunächst durch kontrolliertes Polling; eine
Echtzeitverbindung ist keine Voraussetzung für den sicheren MVP-Schnitt. Das zusätzliche Feature
Gate bleibt standardmäßig deaktiviert.
