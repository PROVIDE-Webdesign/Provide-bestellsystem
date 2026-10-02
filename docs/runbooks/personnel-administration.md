# Personalverwaltung betreiben

Der technische Entwurf baut auf PR18 auf. Die Personaloberfläche steht nur aktivem Owner/Manager mit
MFA zur Verfügung. A1 und Auth müssen in API und Dashboard ausdrücklich eingeschaltet werden;
Defaults bleiben aus. Einladungsversand braucht zusätzlich den eigenen API-Schalter, den
serverseitigen `SUPABASE_SERVICE_ROLE_KEY` und die feste `PERSONNEL_DASHBOARD_ORIGIN`. Die Origin
muss zur Dashboard-Domain und Supabase Redirect-Allowlist passen. Der Browser erhält keinen
Service-Schlüssel. Kein Produktionsanschluss wurde mit diesem Arbeitsblock hergestellt.

1. Personalstand neu laden, Person oder neue Einladung wählen.
2. Rolle und sämtliche Standorte prüfen. Manager dürfen ausschließlich Küche/Fahrer innerhalb ihrer
   eigenen Standorte verwalten. Owner brauchen keine einzelne Standortzuordnung.
3. Änderungsgrund angeben und Person/Rolle/Standorte bewusst bestätigen.
4. Anwenden, anschließend aktualisierten Stand und Vorher-/Nachher-Audit prüfen.
5. Bei Konflikt neu laden und Änderung neu prüfen. Bei unklarer Antwort dieselbe Anfrage
   wiederholen; kein neuer Befehl nur wegen einer verlorenen Antwort.

Restaurantsperren entziehen aktuelle Rechte beim nächsten Zugriff auch mit bestehendem Token. Sie
sind keine globale Auth-Sperre. Reaktivierung und Standortwechsel sind ebenfalls bewusst auditiert.
Eigenänderungen sind gesperrt; der letzte aktive Owner bleibt erhalten.

Einladungen: Auth-Mail versendet nur Anmeldung, keine Mitgliedschaft. Die Zielperson bestätigt die
Anmeldung auf `/invitations`, prüft die Restaurant-Einladung und nimmt bewusst an. Für
verantwortliche Rollen zuerst MFA prüfen. Ablauf nach sieben Tagen oder Widerruf sperren die
Annahme. Abgelaufene offene Einladungen zuerst bewusst widerrufen, dann neu einladen.

Versandzustände `sending`/`uncertain`: nicht automatisch erneut senden. Nach Providerprüfung kann
ein unklarer Vorgang bewusst abgebrochen und ein neuer Vorgang geprüft werden. Ein Abbruch stoppt
die Mitgliedschaftserzeugung; eine bereits versandte Auth-Mail ist technisch möglich. Eine
Statuszeile `sent` bezeichnet bestätigten Auth-Versand, keine geprüfte Inbox-Zustellung.

Prüfung: `pnpm check` lokal; DB-, tatsächliche Auth-/HTTP-/Realtime- und native Browserprüfungen
über alle fünf Pflichtjobs desselben finalen CI-Heads. Lokal bleiben drei umgebungsabhängige
Integrationsdateien ohne explizite Loopback-Zugangsdaten übersprungen. CI startet Mailpit, maskiert
lokale Auth-Schlüssel und prüft einen echten Empfänger-JWT sowie sofortigen Zugriffsentzug.
SQL-Datei 0033 ergänzt die bestehenden Rollen-/Einladungs-/MFA-Invarianten; keine Tests entfernt.
Keine echte physische MFA-Abnahme, Produktions-SMTP- oder Restaurantfreigabe daraus ableiten.
