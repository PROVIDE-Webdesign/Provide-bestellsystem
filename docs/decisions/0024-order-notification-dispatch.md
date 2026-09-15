# ADR 0024: Zuverlässige transaktionale Gast-Bestellbenachrichtigungen

## Status

Angenommen für Arbeitsblock 3.7. Der Umfang wurde am 15. September 2026 formal freigegeben.

## Entscheidung

Bestellbenachrichtigungen werden nicht direkt in einer Checkout- oder Statusänderung versendet. Ein
Trigger leitet stattdessen geeignete, bereits transaktional gespeicherte Bestellereignisse in einen
getrennten Zustellnachweis über. Die allgemeine Outbox bleibt dadurch für spätere Kassen- und
Integrationsadapter nutzbar.

Der erste Kanalvertrag ist SMS, weil der freigegebene Gast-Checkout eine Telefonnummer verlangt,
während die E-Mail-Adresse optional ist. `order.submitted` sowie die Zielzustände `accepted`,
`rejected`, `ready` und `cancelled` erzeugen einen Auftrag. `preparing` und `completed` erzeugen
bewusst keine Gastnachricht.

## Datenschutzgrenze

Der Zustellnachweis enthält keine Telefonnummer, keinen Namen, keine E-Mail-Adresse und keinen
Nachrichtentext. Ein serverexklusiver Claim liest die Telefonnummer erst unmittelbar vor einem
Versuch aus der vorhandenen Kontaktschutzzone. Sie wird weder in Outbox, Zustellnachweis,
Idempotenzschlüssel, Logs noch Fehlercodes kopiert. Gelöschte Kontakte und durch neuere Zustände
überholte Nachrichten werden als `suppressed` abgeschlossen.

## Zustellsemantik

Die Verarbeitung garantiert mindestens einen Versuch und verwendet pro Zustellauftrag und
Vorlagenversion einen stabilen, nicht personenbezogenen Idempotenzschlüssel. Ein echtes
Genau-einmal-Versprechen ist ohne entsprechende Anbietergarantie nicht möglich. Exklusive
Sperrtoken, `SKIP LOCKED`, eine fünfminütige Sperrfrist, höchstens sechs Versuche und begrenzte
Wiederholungsabstände schützen gegen Parallelität und hängengebliebene Worker.

## Betriebsgrenze

Der Scheduled Handler ist auf 25 Aufträge pro Lauf begrenzt. Das Feature-Flag
`NOTIFICATION_DISPATCH_ENABLED` ist standardmäßig `false`. Zusätzlich muss ein Adapter ausdrücklich
als konfiguriert markiert sein. Der normale Anwendungseinstieg enthält keinen realen SMS-Adapter;
nur Tests injizieren einen synthetischen Adapter.

## Nicht Bestandteil

1. Echter SMS-Versand, Anbieterwahl oder Anbieter-Secrets.
2. E-Mail, WhatsApp, Push, Marketing oder eingehende Nachrichten.
3. Personal-, Liefer-, Fahrer- oder Zahlungsbenachrichtigungen.
4. Anbieter-Payloads, Statuszugriffstoken oder personenbezogene Protokolle.
5. Deployment, echte Daten, Livebetrieb und Änderungen an Asian Kitchen.
