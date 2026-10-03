# O1: private Supportfälle und interner Abgleich

Grundlage: Architektur A2 §10/§11, E22, fachlich bestätigte O1-D01–D08 und Umsetzungsauftrag vom
03.10.2026. Basis ist der technisch freigegebene PR21-Head
`74b6a2dabcf4e65ab9a18efc110d12b082adde1b`. Der neue Zweig ist `codex/o1-support-cases-20261003`.
Keine Ready-Schaltung, kein Merge oder Deployment.

## Rechte und Daten

`private.support_grants` enthält eigenständige `can_read`/`can_manage`-Rechte. Manage setzt Read
voraus. Globale, Restaurant- und Standortgrants leiten keine Rechte aus Restaurantrollen oder
PROVIDE-Administration ab. Die Migration vergibt keine Rechte an reale Personen. Jede Anfrage,
einschließlich Receipt-Replay, prüft AAL2 und die aktuelle A4-Provider-Sitzung mittels
`private.lock_account_session` in derselben uncached Transaktion. Grants sind für die Dauer der
Operation gesperrt. Zuweisungen verlangen einen aktiven, nicht gebannten/Recovery-gesperrten
Supportbearbeiter im jeweiligen Standortumfang. Read-only darf keinen Scan mit Auditwirkung starten.

Die API erhält nur minimierte Fallfelder, interne UUID-Referenzen, Bestellnummern, feste Zustands-
und Grundcodes sowie Zeitpunkte. Kundenkontakte, Adressen, Zahlungs-/Statuszugänge, Provider-IDs,
freie Texte, Rohpayloads und beliebige Fehlertexte werden nicht gelesen oder projiziert. Es gibt
keinen Kontakt-Reveal. Strikte Contracts prüfen Ein- und Ausgabe, auch verschachtelte Belege und
Auditänderungen. Fallbelege bleiben unabhängig vom Gastkontakt-Purge erhalten.

## Quellen und Episoden

`private.support_sources` liest bestehende Payment-Jobs, private E-Mail-Jobs und Annahmealarme.
Falltypen sind `payment_review`, `refund_failed`, `email_uncertain`, `email_dead_letter` und
`acceptance_overdue`. Ein manueller `incident` ist ausschließlich standortgebunden und hat keine
erfundene Auftrags-/PaymentIntent-Referenz.

Ein bewusst gestarteter Scan prüft höchstens 100 **Quelleneinträge**, einschließlich gesunder
Einträge, pro HTTP-Auftrag. Payment und E-Mail können jeweils zwei Typeneinträge pro Job haben.
Weitere Einträge benötigen eine bewusste Fortsetzung. Serverseitige, einmal verwendbare UUID-Cursor
binden Benutzer, Standort, Erstellzeit-Cutoff und letzten stabilen Typ/UUID-Schlüssel. Sie verfallen
nach einer Stunde. Neu erzeugte Quellen nach dem Cutoff gehören zum nächsten neuen Scan. Der Cutoff
friert die Quellenmenge ein, nicht ihren Fachzustand: jede Beobachtung liest den aktuell
gespeicherten Zustand unter Share-Lock. Gelöschte Quellen werden nicht als Erfolg rekonstruiert. Es
gibt keinen O1-Scheduler.

Ein partieller Unique-Index verhindert mehrere aktive Fälle desselben Standort/Typ/Quellobjekts.
Unveränderte Belege erzeugen weder neue Fälle noch weitere Beobachtungs-Audits. Änderungen
aktualisieren Beleg und Revision eines aktiven Falls. Nach Abschluss entsteht eine neue verknüpfte
Episode erst nach einer beobachteten gesunden Quelle und anschließend neu beobachtetem Problem. Ein
technisch geprüfter Abschluss zählt selbst als gesunde Beobachtung. Administrativer Abschluss eines
unverändert problematischen Objekts erzeugt beim nächsten Scan keinen neuen Fall. Zwischen zwei
Abgleichen vollständig auftretende und verschwindende Episoden können mangels Beobachtung nicht
nachträglich erfunden werden. Manuelle Quellenfälle verlangen eine tatsächlich vorhandene, im
aktuellen Standort gebundene und problematische Quelle; bekannte unveränderte geschlossene Quellen
müssen begründet wieder geöffnet werden.

## Zustände und Wirkung

Fälle haben `open`, `in_progress`, `waiting` oder `resolved`. Waiting verlangt einen festen Grund.
Reopening verlangt `reopened` und führt nach `open`; ein parallel aktiver Nachfolgefall verhindert
die Wiederöffnung desselben Quellobjekts. Unzugewiesene Fälle sind erlaubt.
`critical`/`high`/`normal` haben initial +30 Minuten/+4 Stunden/+24 Stunden ab Serverzeit.
Änderungen der absoluten UTC-Frist benötigen `deadline_changed`; sie liegt künftig und höchstens 30
Tage voraus. Die UI zeigt die Standortzeitzone mit Zeitzonenabkürzung. Fristüberschreitung wirkt nur
visuell, niemals fachlich.

Technischer Abschluss verlangt den aktuellen Fingerprint und einen konkreten internen terminalen
Nachweis. Payment-Review muss intern terminal und frei von ungelöster Erstattung sein; eine
fehlgeschlagene Erstattung benötigt gespeichertes `succeeded`. Bei E-Mails lösen `accepted`,
`delivered`, `bounced` und `suppressed` die Ungewissheit/DLQ auf; **accepted beweist keine
Zustellung, bounced/suppressed keinen Versanderfolg**. Annahmefälle benötigen `resolved_at`. Die
Fallauflösung behauptet daher nur den jeweiligen internen Abschluss. Administrative Gründe
`misassignment`, `duplicate`, `out_of_scope` sind ausdrücklich als administrativ gekennzeichnet.
Unknown/Pending allein erlaubt keinen technischen Abschluss.

O1 hat keinen Provideradapter und ruft niemals Payment-, Refund-, E-Mail-, Bestell- oder
Auth-Recovery-Kommandos auf. Bestehende Jobs laufen unabhängig weiter. Die Payment-Jobtabelle hat
keinen präzisen Zustand-Zeitstempel; dieser bleibt in der Projektion null. `observedAt` ist nur der
interne Lesezeitpunkt, niemals eine neue Providerantwort. E-Mail-Annahme-/Zustell- und
Annahmealarm-Zeitpunkte bleiben als gespeicherte Nachweiszeiten getrennt.

## Parallelität und Audit

Standortlocks, Quell-Share-Locks, Fallrevision und actor/request-ID-Receipt verhindern doppelte
Wirkungen und verlorene Änderungen. Vor einem Replay werden aktuelle Sitzung, Grants und
Quellbindung geprüft; geänderte Payload bei gleicher ID liefert Conflict. Automatische Beobachtungen
sind `system_observed`, manuelle Aktionen `human`; beide behalten den verifiziert auslösenden
Benutzer als UUID. Vorher/Nachher enthalten ausschließlich Status, Schwere, Frist, Zuständigkeit und
administrative/technische Kennzeichnung. Fall, Beleg, Audit und Receipt werden atomar gespeichert.
Audit-/Transaktionsfehler dürfen keinen Teilzustand oder Receipt hinterlassen. Direktes
Browser-DML/RPC und direkte Service-DML auf den privaten Supporttabellen sind gesperrt.

## UI und Nachweisgrenzen

`/provide/support` und `/api/support` sind von PROVIDE-Administration unabhängig. Alle O1-Flags sind
standardmäßig false. Umfang wird anhand interner Mandanten-/Standort-IDs bewusst gewählt. 401/403,
Umfangswechsel, ungültige Antwort oder Fehler verwerfen geladene Daten; abgebrochene/späte Antworten
dürfen einen neuen Umfang nicht überschreiben. Regelmäßiges/fokusbedingtes Nachlesen prüft Rechte
erneut und startet keinen Scan. Verlorene Mutationsantworten haben einen manuellen
Wiederholungsbutton, der denselben unveränderten Auftrag verwendet. Listen sind auf 50 Fälle pro
Seite, Details auf die letzten 30 Auditnachweise begrenzt; der vollständige Audit bleibt
gespeichert.

Die 40 bestätigten Fachfälle werden in `docs/testing/support-cases.md` schichtengenau zugeordnet.
Ein lokaler WASM-PostgreSQL-Vorlauf mit synthetischen Auth-Tabellen und deaktiviertem Realtime-Send
ersetzt weder den vollständigen Supabase-Stack noch den realen Auth-/HTTP-/CI-Nachweis. Head/Tree,
Pflicht-CI, echte Browserbilder und offene Grenzen gehören in den aktuellen Projekt-Prüfnachweis.
F01–F03 bleiben eingefroren. B6, P1–P5, O3/O4/O6 und zentraler Gesamtaudit erhalten durch dieses
Paket keinen Abschlussstatus. A2-9-3/4/5 dürfen erst anhand des nachgewiesenen begrenzten
Ergebnisses neu bewertet werden.
