# ADR 0032: Private Bestell-Livehinweise und getrennte Annahmefrist

## Entscheidung

B1/B2 werden gemeinsam umgesetzt, aufbauend auf PR #14/B7. Datenbankänderungen an Bestellung,
Zahlung, Onlinejob und bestätigter Zeit erzeugen einen transaktionalen privaten Broadcast auf
`orders:v1:<restaurantId>:<locationId>`. Seine einzigen Nutzdaten sind `schemaVersion` und eine
zufällige Ereignis-ID. Keine Bestellzeile, Nummer, Kontaktdaten, Adresse oder Zahlungsreferenz wird
über den Kanal gesendet. Browser dürfen weder Broadcasts senden noch Presence veröffentlichen.

Die RLS prüft JWT-Subjekt, aktive Mitgliedschaft, reale Mandanten-/Standortzugehörigkeit,
Standortzuweisung und AAL: Owner/Manager `aal2`, zugewiesene Küche `aal1`/`aal2`, Fahrer gesperrt.
Zusätzliche restriktive Policies schützen die Namespace-Grenze gegen spätere allgemeinere Policies.
Supabase bewertet Kanalrechte bei Join/JWT-Erneuerung, nicht pro Nachricht. Daher bleiben Hinweise
datenarm und jede Nachladung prüft Rechte erneut. Bei 401/403 verschwinden Liste, Details und
Alarme; der Kanal wird geschlossen. Vor Aktivierung: kurze JWT-Gültigkeit und Realtime-Einstellung
„Allow public access“ deaktivieren. Keinen Service-Schlüssel an den Browser geben.

Hinweise sind ausschließlich Invalidierungen, keine Statusbefehle. Ein begrenzter Cache unterdrückt
Duplikate; 250-ms-Bündelung und ein einzelner Nachladevorgang mit Nachlauf behandeln Ereignisbursts.
Join/Rejoin, JWT-Wechsel, Online-Rückkehr und Tab-Rückkehr laden einen neuen serverseitigen Stand.
15-Sekunden-Polling bleibt als Sicherheitsnetz erhalten; fehlender Livekanal ist sichtbar. Requests
haben Acht-Sekunden-Abbruch und alte Standort-/Detailantworten dürfen keine neue Ansicht ersetzen.
Listenpagination dedupliziert nach Bestell-ID. Ein geändertes geöffnetes Detail verlangt erneute
Prüfung; unveränderte Details überschreiben keine noch nicht bestätigte Zeitkorrektur.

## Annahme und Eskalation

Ein neuer, filterunabhängiger Eingang sortiert die bearbeitbaren `submitted`-Bestellungen nach
Annahmefrist. Die Frist beträgt im sicheren ersten Schnitt fünf Minuten: Zahlung bei Erfüllung
startet sie beim Speichern, Onlinezahlung erst nach bestätigter Erfassung und ohne laufende
Schließung/Erstattung. Sie ist kein Zahlungs-Timeout. Wiederholte Jobs setzen sie nicht zurück.
Bestehende bearbeitbare Bestellungen erhalten bei Migration einen neuen Start statt rückwirkender
Ablehnung. Dieser Standard ist später Teil der versionierten Standortkonfiguration (B4).

Ein aktivierter minütlicher Hintergrundjob sperrt zuerst Bestellung, dann Alarm, verarbeitet
höchstens 100 Einträge und eskaliert einmalig. Start, Eskalation und Auflösung sind append-only
auditiert. Die Timeout-Regel lautet `manual_review`: auffordern, prüfen, annehmen oder nach
bestehender Rechte-/Grundprüfung ablehnen. Keine automatische Stornierung, Erstattung oder Nachricht
an einen externen Eskalationskontakt. Allgemeine Support-/Monitoringalarmierung bleibt Paket 4.

Ton beginnt ausschließlich nach „Ton aktivieren und testen“; ein sichtbarer Schalter schaltet ihn
stumm. Ein neuer serverseitiger Eingang löst einen Hinweis aus, überfällige Einträge wiederholen ihn
frühestens nach 30 Sekunden. Verborgene Tabs, fehlende/älter als 30 Sekunden alte Snapshots und
entzogene Rechte erzeugen keinen Ton. Reload/Standortwechsel stellen Ton nicht automatisch wieder
her. Browserblockade wird sichtbar; visuelle Hinweise bleiben. Der Countdown verwendet Serverzeit
plus monotone Laufzeit, nicht eine verstellbare Geräteuhr. Bis zu 100 dringendste Einträge und die
ungefilterte Gesamtzahl werden gezeigt; die Grenze wird nicht als vollständige Liste ausgegeben.

## Freigabegrenze

API `DASHBOARD_ORDER_ALERTS_ENABLED`, Dashboard `DASHBOARD_ORDER_ALERTS_ENABLED` und
`DASHBOARD_REALTIME_ENABLED` bleiben standardmäßig **false**. Kein Remote-Supabase-Projekt wird
zugeordnet/verändert. Die CI verwendet ausschließlich den disposable Loopback-Stack mit Auth,
Realtime und PostgreSQL; ihre Test-JWTs sind kurzlebig und nicht die produktive Anmeldemethode.
Native Browserautomation und zwei echte Test-WebSockets ersetzen keine eingefrorene physische
Mehrgeräte-, Lautsprecher-, Hintergrund-/Energiespar- oder Assistive-Tech-Abnahme.
