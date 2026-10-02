# ADR 0036: Personalverwaltung und auditierte Einladungen

Status: technischer Entwurf. A1, Paket 4, 02.10.2026. Basis A2/O2, Entwurfs-PR18.

## Rechte und Standortgrenzen

POST `/v1/dashboard/personnel` und das gleichnamige Dashboard-Gateway verwenden ausschließlich die
serverseitig verifizierte JWT-Identität. Owner und Manager brauchen AAL2. Owner verwalten alle vier
Restaurantrollen; Manager ausschließlich Küche/Fahrer, deren gesamte Standortzuordnung in ihrem
aktuellen Bereich liegt. Eine Überschneidung reicht nicht. Neue und bestehende Zuordnungen werden
geprüft. Restaurantfremde Standorte, eigene Rollen-/Sperränderungen und der Entzug des letzten
aktiven Owners sind gesperrt. Eine Restaurantsperre ändert keine fremde Mitgliedschaft.

Jeder Aufruf prüft aktuelle Mitgliedschaft, Standorte und Auth-Sperre erneut. Bestehende Tokens
behalten dadurch keine entzogenen Bestellrechte. Rollen-Metadaten im Auth-Konto verleihen keine
Restaurantrechte. Viewer ist ein eigener Folgeauftrag A3.

## Versand und bewusste Annahme

Eine geprüfte Anfrage reserviert zunächst nur einen dauerhaften Versandvorgang. Supabase Auth
versendet für neue Konten den Invite-Link und für bestehende Konten einen OTP-Anmeldelink mit
`create_user=false`. Die feste Dashboard-Origin führt nach `/invitations`; beliebige Redirects
werden nicht übernommen. E-Mail-Inhalt und Linkgeheimnisse werden nicht in Personaltabellen, Audit,
Logs oder Browserbefehlen gespeichert. Der Service-Schlüssel bleibt ausschließlich im API.

Reservieren, einmaliges Claim und Abschließen sind getrennte kurze Transaktionen. Während des
externen Auth-Aufrufs hält die Anwendung keine DB-Verbindung oder DB-Sperre. Unklare Antworten
werden als `uncertain` festgehalten; sie lösen keinen automatischen erneuten Versand aus. Ein nach
30 Sekunden erneut geprüfter laufender Claim wird ebenfalls unklar. Verantwortliche können
vorbereitete/laufende/unklare/fehlgeschlagene Vorgänge bewusst abbrechen. Eine eventuell bereits
versandte Auth-Mail verleiht nach Abbruch keine Restaurantmitgliedschaft.

Erst ein bestätigter Auth-Versand und eine erneute Rechteprüfung erzeugen die native Einladung. Die
angemeldete Zielperson muss mit bestätigter aktueller E-Mail bewusst annehmen. Für Owner/ Manager
ist AAL2 nötig, für Küche/Fahrer AAL1 oder AAL2. Die Einladung gilt sieben Tage. Widerruf, Ablauf
und inzwischen entzogene Einladerrechte verhindern die Annahme. Mitgliedschaft, Standorte,
Annahmestatus, Audit und minimales Outbox-Ereignis entstehen atomar. Wiederholte Annahme erzeugt
keine zusätzliche Mitgliedschaft oder Auditzeile.

Die Eintrittsseite entfernt die Auth-Fragmente sofort aus der URL und hält sie nur im Speicher. Die
Anmeldung wird vor `setSession` ausdrücklich bestätigt. Ein optionales Passwort ist eine normale
Änderung der angemeldeten Auth-Sitzung, kein privilegierter Wiederherstellungsweg.

## Atomare Änderungen und Datenminimierung

Schreibbefehle benötigen geprüften Grund, erwartete Revision und UUID-Anfrage-ID. Mandanten-Lock,
geordnete Membership-/Standort-Locks und erneute Rechteprüfung schützen konkurrierende Änderungen.
Identischer Replay ist idempotent; geänderte Nutzlast oder veraltete Revision ergeben Konflikt.
Unveränderliche Belege und Vorher-/Nachher-Audit werden mit der Änderung geschrieben. Versand-
Statuswechsel besitzen zusätzlich ein minimales Audit und Outbox-Signal.

R19-01 trennt ursprüngliche Dispatcher-Identität/-Begründung von der letzten Statusänderung. Ein
bewusster Versandabbruch verwendet den verifizierten tatsächlichen Akteur und dessen Abbruchgrund
auch im Statusaudit. Das Status-Outbox-Ereignis verweist auf genau diesen Beleg. Automatische
Claim-/Provider-/Timeout-/Rechteentzugszustände tragen `changeKind=system`, keinen menschlichen
Akteur und einen passenden Systemgrund; `initiatorUserId` hält den ursprünglichen Kontext getrennt.
Alte unveränderliche Auditzeilen werden nicht umgeschrieben. Manager sehen weiterhin ausschließlich
ihre eigenen menschlichen Auditaktionen. Die UI bezeichnet automatische Akteure als „System“.

Die Bestätigung der eingeladenen Person wird bei jeder E-Mail-Änderung zurückgesetzt (R19-02).

Direkte service-role-Schreibrechte auf Memberships, Einladungen und deren Standorttabellen sowie die
alte nicht auditierte Annahme sind entzogen. Neue private Tabellen erzwingen RLS; ausschließlich eng
begrenzte Serverfunktionen sind ausführbar, mit leerem search_path und expliziten ACLs. Der Dienst
verwendet parameterisierte PG-Aufrufe, Zeitlimits und abgeschalteten Hyperdrive-Cache.

Listen sind begrenzt: 50 Personen mit UUID-Fortsetzung, 50 offene Einladungen, 20 Versandvorgänge,
30 Auditzeilen und höchstens 100 sichtbare Standorte. Manager sehen nur vollständig verwaltbares
Personal und ihre eigenen Auditaktionen. UI verwirft alte Personaldaten bei jeder Anfrage, Konflikt
und Entzug; unklare Schreibantworten behalten denselben Befehl nur im Arbeitsspeicher.

## Grenzen und Abnahme

`DASHBOARD_PERSONNEL_ENABLED=false` und `PERSONNEL_INVITATIONS_ENABLED=false` bleiben Defaults. Kein
Produktions-SMTP, realer Benutzer, Merge oder Deployment. CI verwendet ausschließlich lokale
Auth-/Mailpit-/DB-Dienste und synthetische Konten. HTTP prüft echte Auth-Anmeldung des Empfängers;
der administrative AAL2-Testtoken ist ausdrücklich synthetisch. Browserprüfungen verwenden die
echten Komponenten mit synthetischem Transport in Chromium, Firefox und WebKit bei 390/1440 px.
Physische MFA- und Restaurantabnahme F03 sowie F01/F02 bleiben eingefroren.

Referenzen:
[Supabase Invite](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail),
[OTP](https://supabase.com/docs/reference/javascript/auth-signinwithotp),
[E-Mail-Templates](https://supabase.com/docs/guides/auth/auth-email-templates).
