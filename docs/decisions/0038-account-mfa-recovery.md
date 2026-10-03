# Konto- und MFA-Recovery

Grundlage: Architektur A2, Projektprotokoll E16, bestätigte A4-D01–D06 und Umsetzungsauftrag vom
03.10.2026. Upload und separater Draft-PR21 sind ausdrücklich freigegeben. Ready-Wechsel, Merge,
Deployment und Änderungen realer Auth-Konten oder Berechtigungen sind ausgeschlossen.

## Umfang und Identität

Supabase Auth bleibt die einzige Passwort-, TOTP- und Sitzungsquelle. A4 umfasst bestehende
bestätigte E-Mail-Konten, bewussten Passwortwechsel nach tatsächlichem PKCE-Recovery-Nachweis,
kontrollierten TOTP-Wechsel und unabhängige Wiederherstellung bei Faktorverlust. Kein Signup,
E-Mail-Wechsel, SMS, Passkey, eigener Backupcode oder Kundenkonto. Fehlender E-Mail-Zugriff und
Provider-/Infrastruktur-Notfälle werden nicht durch einen Produkt-Bypass ersetzt.

Der API-Verifier prüft signierten UUID-`session_id`, Aussteller, Publikum, Ablauf und AAL. Vor jedem
Fachzugriff prüft die Datenbank zusätzlich die aktuelle eigene `auth.sessions`-Zeile, Auth-Bann,
Sitzungsfrist, aktuellen AAL und bei AAL2 den aktuell zugeordneten bestätigten eigenen TOTP-Faktor.
Ein weiterhin gültiger AAL2-Token ist nach Faktorentfernung kein Zugriffsnachweis.

## Unabhängige administrative Freigabe

`private.account_recovery_grants` enthält ausschließlich explizite globale Recovery-Rechte.
Restaurantrollen, mandanten-/standortgebundene oder globale PROVIDE-Grants und Benutzermetadaten
erteilen dieses Recht nicht. Tabellen und Migrationen provisionieren keine realen Personen.
Bearbeiter benötigen eine aktuell gültige normale AAL2-Sitzung. Administrative Selbstprüfung,
Selbstfreigabe und Selbstausführung sind ausgeschlossen.

Ein Verlustfall bindet das bestätigte Zielkonto und dessen tatsächliche Recovery-Sitzung. Die
Prüfung verlangt eine bereits vor dem Antrag registrierte unabhängige Kontaktkennung und eine opake
Nachweisreferenz. Nachweisunterlagen, neue Kontaktadressen oder Identitätsdokumente gehören nicht in
API, Audit oder Screenshots. Für normale Restaurantkonten genügt ein anderer berechtigter
Bearbeiter; ein Ziel mit irgendeinem aktiven PROVIDE-Grant benötigt zwei verschiedene berechtigte
Personen. Eine Person zweimal zählt einmal. Jede Freigabe bindet eigene aktuelle Sitzung,
Identitäts-/Rechtestand und Grantrevision. Widerruf und Wiedererteilung revivieren keine Freigabe.

## Fallvertrag und Wirkung

| Zustand                        | Zulässige Wirkung                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| requested                      | Gebundener Antrag, 24 Stunden; keine Kontosperre                                         |
| verified                       | Unabhängiger Nachweis bestätigt                                                          |
| approved                       | Erforderliche verschiedene Freigaben; 15 Minuten Ausführungsfrist                        |
| executing                      | Autorisierte Absicht gespeichert und kontoweit gesperrt; Auth-Wirkung wird geprüft       |
| awaiting_reenrollment          | Tatsächliche Auth-Wirkung abgeglichen; alle vorherigen Sitzungen widerrufen              |
| completed                      | Neue normale Sitzung und erforderliche aktuelle neue MFA bestätigt; ursprüngliche Rechte |
| cancelled / rejected / expired | Vor Wirkung beendet; kein nachträglicher Effekt                                          |
| needs_review                   | Unklare Teilwirkung oder veränderte Grundlage; Sperre bleibt bestehen                    |

Ein E-Mail-Antrag sperrt kein Konto. Erst die autorisierte Ausführungsabsicht setzt die kontoweite
Sperre und Sitzungsgrenze. Passwort-Recovery verlangt echte serverseitige Recovery-AMR und den
gebundenen Sessionkontext; bei vorhandenen Faktoren muss der bisherige Faktor bestätigt sein. Ein
normaler Login oder Einladungskontext kann diesen Zweck nicht behaupten.

Beim kontrollierten Wechsel bindet der Antrag zuerst den bestätigten bisherigen Sitzungsfaktor. Der
Ersatz muss danach tatsächlich über Auth eingerichtet und verifiziert werden, bevor der gebundene
alte Faktor entfernt wird. Der Abschluss verlangt eine neu erstellte Sitzung, deren aktueller Faktor
genau dieser Ersatz ist. Beim Verlust muss ihr aktueller bestätigter TOTP-Faktor nach der
Ausführungsabsicht neu eingerichtet worden sein.

Auth-Mutationen erfolgen über die gepinnten offiziellen HTTP-Schnittstellen: eigener Passwortwechsel
mit Zieltoken, eigenes Unenroll mit Zieltoken, administratives Faktorentfernen ausschließlich mit
Server-Secret. Produktcode schreibt keine Passwortwerte oder Faktorzeilen per SQL. Die enge
serverseitige Löschung widerrufener `auth.sessions` ist eine ausdrücklich dokumentierte Abhängigkeit
vom isoliert geprüften Auth-Schema; sie ändert keine Banns, Rollen, Standorte oder Grants.

## Sperre an allen Zugangswegen

Alle Fachadapter prüfen und sperren die aktuelle Sitzung in derselben Transaktion wie ihren
Fachzugriff. Kontext liefert einen gültigen leeren Kontext, andere Fachzugänge `forbidden`.
Restriktive RLS-Policies schützen alle bestehenden öffentlichen RLS-Tabellen und private Realtime-
Nachrichten. Direkte private Browser-Hilfsfunktionen prüfen ebenfalls die eigene aktuelle Sitzung.
Bestehende Policy-Verweise werden auf diese geschützten Funktionen umgebunden; interne frühere
Funktionen sind kein ausführbarer Browser-Einstieg.

Recovery-AMR bleibt ausschließlich auf die minimalen gebundenen Recovery-Schritte beschränkt und
öffnet keine Fachzugänge. Anonyme Gastwege erhalten keine Kontositzungspflicht. Neue private
Realtime-Joins werden verweigert. Bereits bestehende Verbindungen werden nicht als garantiert sofort
getrennt bezeichnet; bestehende Invalidation-Nachrichten enthalten weiterhin keine PII.

Die Sperre endet ausschließlich durch den expliziten Abschluss mit frischer Auth-Sitzung und
erforderlicher MFA. Der invalidierende Zeitpunkt bleibt erhalten. Alte signierte Tokens und alte
Refresh-Tokens gewinnen auch nach Abschluss keine fachlichen Rechte zurück. Banns, suspendierte
Mitgliedschaften und sämtliche bestehenden Zuordnungen bleiben unverändert.

## Teilwirkung, Replay und Audit

Auth und PostgreSQL sind keine gemeinsame Transaktion. Ein unveränderlicher Absichtsbeleg und eine
Receipt-ID werden vor der externen Wirkung gespeichert. Die API prüft vor jeder Mutation den
aktuellen Executor, sämtliche erforderlichen Freigaben, Fristen und den erwarteten Faktorbestand.
Nur die vorher gebundenen Entfernungen dürfen während der Wirkung fehlen; unerwartete hinzugefügte,
veränderte oder anderweitig entfernte Faktoren führen zur Nachprüfung.

Ein Timeout oder eine verlorene Antwort löst keine blinde erneute Auth-Mutation aus. Die Datenbank
gleicht tatsächliche Provider-Ereignisse/Faktoren ab. Bei unklarer Wirkung bleibt das Konto
gesperrt. Ein Replay kann für eine höchstens 30 Sekunden laufende Absicht `executing` zurückgeben;
die Nachprüfung sendet keinen erneuten Provider-Befehl. Ein abgeschlossener Versuch wird unmittelbar
abgeglichen. Fehler bei der nachgelagerten Audit-Speicherung rollen diesen DB-Teilschritt zurück,
behalten die schon gespeicherte Sperre/Absicht und erlauben nur Zustandsabgleich.

Gleiche Command-ID und andere persistierte Nutzlast konflikieren. Revision und Berechtigung werden
vor Replay erneut geprüft. Das flüchtige neue Passwort ist nie Teil von Command, Receipt, Plan,
Audit oder Logs. Ein paralleler/staler Bearbeiter kann keine zweite Wirkung beanspruchen.

Fallereignisse nennen den tatsächlich verifizierten menschlichen Akteur, Quelle `application`,
Grund, Command-ID und Revision. Direkte Auth-Faktorentfernung und Passwortänderung erzeugen
unveränderliche `provider_observation`-Ereignisse mit leerem Akteur statt erfundener Identität und
sperren Fachzugriff. Beobachtung und zugehöriger kontrollierter Produktbefehl bleiben getrennte
Belege. Keine Passwörter, JWTs, Links, Codes, QR-Geheimnisse oder Beweisunterlagen in Logs/Audit.

## Nachweis und Betriebsgrenzen

SDK 2.116.0 und CLI 2.117.0 werden anhand echter Loopback-Auth-Sitzungen geprüft. Synthetische
SQL-Fixtures sind ausdrücklich keine tatsächlichen Auth-Nachweise. Ohne explizite Loopback-
Variablen bleiben Integrationstests `skipped`. Es wird kein entfernter Auth-Stack verändert.

Die 35 fachlichen Fälle und ihre Belege stehen in
[Recovery-Prüfmatrix](../testing/account-mfa-recovery-cases.md), Störungsbehandlung im
[Recovery-Runbook](../runbooks/account-mfa-recovery.md). Technische Prüfung, Nutzer-Endfreigabe,
Ready, Merge und Deployment bleiben getrennt. F01–F03 bleiben eingefroren.
