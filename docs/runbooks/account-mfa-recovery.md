# Konto-/MFA-Recovery: Betrieb und Nachprüfung

Dieses Runbook dokumentiert A4-D01–D06. Es erteilt keine realen Recovery-Rechte und aktiviert keine
Umgebung. PR21 bleibt Draft; Ready, Merge und Deployment brauchen einen getrennten Auftrag.

## Konfiguration vor einem später separat autorisierten Betrieb

- API und Dashboard: `ACCOUNT_RECOVERY_ENABLED=false` bleibt der Default.
- Beide: `DASHBOARD_AUTH_ENABLED` und exakte HTTPS-`ACCOUNT_RECOVERY_ORIGIN` müssen separat geprüft
  sein. Auth-Aussteller, Publikum, Browser-Publishable-Key und bestehender SSR-Zugang müssen passen.
- API: `HYPERDRIVE_CACHE_DISABLED=true`, tatsächliche DB-Verbindung und ausschließlich
  serverseitiges `SUPABASE_SERVICE_ROLE_KEY`; keine öffentliche Variable für das Secret.
- Auth-Allowlist: ausschließlich die konkrete Dashboard-Adresse `/auth/recovery`. Kein Wildcard-
  Redirect, Fragmenttoken oder benutzerbestimmter Upstream.
- Rechte und vorher vereinbarte Kontakte sind private serverseitige Register, im Produkt nicht
  editierbar. Die A4-Migration befüllt sie nicht. Ihre spätere kontrollierte Provisionierung braucht
  namentlich festgelegte verantwortliche Personen und einen getrennten geprüften Auftrag.
- Vor Auth-/CLI-Upgrades sämtliche SQL-, tatsächlichen Auth-/Sitzungs- und Realtime-Gegenproben
  erneut ausführen. `auth.sessions`, `mfa_amr_claims`, Faktor- und Auth-Audit-Schema sind gepinnte
  technische Abhängigkeiten; keine ungeprüfte Schemaänderung übernehmen.

## Bestehendes Konto wiederherstellen

1. `/recovery` öffnen. Die E-Mail-Anfrage antwortet unabhängig vom Provider-Ergebnis neutral.
   Supabase begrenzt wiederholte E-Mails; eine Anfrage erstellt keine Identität und sperrt kein
   Konto.
2. Den Link im ursprünglichen PKCE-Browserkontext öffnen. Nur der feste Callback tauscht einen
   einzelnen Code aus und entfernt den Code aus der sichtbaren Adresse. Abgelaufene, wiederholte
   oder anders gebundene Codes neu anfordern; keine Tokens manuell übernehmen.
3. Den gewünschten eigenen Vorgang bewusst öffnen. Passwortwechsel bei bestehender MFA verlangt
   zuvor den alten Faktor. Beim TOTP-Wechsel zuerst den bisherigen Faktor bestätigen, Fall öffnen,
   Ersatz einrichten und bestätigen, dann die gebundene alte Entfernung ausführen.
4. Die Fallkennung sichern. Sie enthält keine Auth-Berechtigung. Derselbe Browser nimmt den Fall aus
   `sessionStorage` wieder auf; ein anderer Browser kann nach aktueller Anmeldung die eigene
   Fallkennung öffnen. Keine fremden Fallkennungen oder Beweisunterlagen versenden.
5. Bei Faktorverlust die Fallkennung dem bereits vereinbarten Recovery-Verantwortlichen über den
   vorhandenen Kontaktweg nennen. Bestätigte E-Mail allein ersetzt keinen unabhängigen Nachweis.
6. Vor Ausführung kann das Ziel den Fall abbrechen. Eine abgelaufene/zurückgezogene Freigabe ist
   nicht ausführbar. Nach `executing` bleibt die Sperre bei Ausfall oder Ablauf erhalten.
7. Bei `awaiting_reenrollment` mit dem aktuellen Passwort neu anmelden. Den erforderlichen aktuellen
   neuen TOTP-Faktor tatsächlich verifizieren; erst dann explizit abschließen. Rechte kommen aus
   ursprünglichen aktiven Zuordnungen, niemals aus Recovery. Ein vorhandener Bann bleibt bestehen.

## Unabhängiger Bearbeiter

1. `/recovery/operate`: eigene normale Anmeldung und aktuelle AAL2-Bestätigung. Restaurantrolle oder
   bisheriger PROVIDE-Grant genügt nicht; explizites globales Recovery-Recht ist erforderlich.
2. Nur den gebundenen bekannten Fall öffnen. Das Produkt liefert ausschließlich Fallkennung, Art,
   Zustand, Fristen, erforderliche Freigabezahl und Revision; keine Kontoverzeichnisse oder PII.
3. Bestehende bestätigte E-Mail und unabhängigen Nachweis tatsächlich über den **vorher**
   vereinbarten Kontaktweg prüfen. Keine im Antrag neu genannte Adresse als Nachweis akzeptieren.
   Nur registrierte Kontaktkennung und opake Referenz erfassen, keine Dokumente, Telefonnummern oder
   E-Mail-Adressen.
4. Andere Person, nie der Zielnutzer: eine Freigabe für normales Restaurantkonto; zwei verschiedene
   aktuell berechtigte Personen für jedes Ziel mit aktivem PROVIDE-Grant. Wiederholung derselben
   Person zählt nicht als zweite Freigabe. Bei konkurrierender Revision den Stand neu laden.
5. Nur innerhalb der 15 Minuten gültigen Freigabe ausführen. Die API kontrolliert Berechtigungen,
   Sitzungen, Identitäts-/Rechtestand und Faktorbestand nochmals vor jeder externen Wirkung.
6. Nach der Wirkung bleibt Fachzugriff gesperrt, bis der Zielnutzer frisch angemeldet und mit der
   erforderlichen neuen MFA abschließt. Keine automatische Entsperrung und keine Rollenänderung.

## Timeout, DB-/Auditfehler und `needs_review`

1. Keinen Provider-Befehl blind wiederholen. Fallkennung, sichere Fehlermeldung und Zeitpunkt
   erfassen; keine Passwörter, JWTs, Links, TOTP-Codes oder QR-Geheimnisse kopieren.
2. Bei `executing` den Stand lesen oder „Auth-Zustand einmal nachprüfen“ verwenden. Diese Aktion
   prüft den Providerzustand ohne erneute Mutationsanweisung. Eine noch laufende Absicht kann für
   höchstens 30 Sekunden in `executing` bleiben. Gleiche Command-ID behauptet keine zweite Wirkung.
3. Bei nachgelagertem DB-/Auditfehler bleibt die ursprüngliche Absicht mit Sperre bestehen. Ein
   aktueller berechtigter Executor kann ihren Zustand abgleichen; verlorene Antworten sind kein
   Erfolgsbeleg. Nur tatsächlich geprüfte Auth-Wirkung darf `awaiting_reenrollment` ergeben.
4. `needs_review` ist keine Entsperr-Schaltfläche. Sperre erhalten; ursprüngliche Absicht, aktuelle
   Faktoren/Sitzungen, Provider-Beobachtungen und unveränderliche Fallereignisse durch befugte
   technische Verantwortliche vergleichen. Keine rohe SQL-Korrektur, Faktor-DML oder künstliche
   menschliche Ereigniszuordnung aus diesem Runbook ableiten.
5. Bei dauerhaft unklarer/partieller Wirkung benötigt die weitere manuelle Behandlung einen
   konkreten geprüften separaten Auftrag. Das begrenzte A4-Paket enthält keinen Force-Unlock und
   keinen automatischen Wiederholungs- oder Rechtevergabeweg.

## Einziger gesperrter Plattformadministrator / kein bestätigter E-Mail-Zugriff

Es gibt keinen Selbstreset, versteckten Superuser oder zweiten Nutzer durch Metadaten. Das Produkt
erteilt nicht seine eigenen Recovery-Rechte. Ein fehlender zweiter unabhängiger berechtigter
Bearbeiter verhindert die Ausführung; die E-Mail allein ändert daran nichts.

Der bestehende externe Provider-/Infrastruktur-Notfallprozess muss außerhalb des Produkts genutzt
werden: zuständige bereits benannte Kontoinhaber/Notfallverantwortliche identifizieren, Eigentum
über den vorhandenen unabhängigen Providerkontakt prüfen, Ticket und Freigaben dokumentieren und
jede tatsächlich vom Provider ausgeführte Wirkung gesondert festhalten. PROVIDE protokolliert einen
unbekannten Auth-Akteur nicht als bekannten Menschen. Eine reine Provider-Wiederaufnahme entsperrt
den Produktzugang nicht automatisch; Auth-Sitzung, Faktoren, aktuelle Produkt-Sperren und
verbliebene Banns sind danach separat nachzuweisen.

Wenn kein solcher externer Verantwortlicher oder Prozess verfügbar ist, bleibt der Fall blockiert.
Dieses Runbook erfindet keine Person, Zugangsdaten oder Provider-Sonderrechte. Der externe Notfall
ist im bestätigten Paketumfang ausgeschlossen und wurde hier nicht tatsächlich ausgeführt.

## Belegbare Grenzen

Neue/erneute private Realtime-Joins müssen scheitern. Ein bereits verbundener Kanal wird nicht als
garantiert sofort getrennt bezeichnet. Seine bestehenden Invalidation-Nachrichten enthalten keine
PII. Direkter Data-API-/RPC-Zugriff und alte AAL1/AAL2-/Refresh-Tokens dürfen keine Wiederaufnahme
bewirken. Öffentlicher Gastcheckout bleibt unabhängig von Konto-Recovery.

Isolierte CI mit synthetischen Konten ersetzt weder echte SMTP-Zustellung noch NVDA, natives Safari
auf Nutzergeräten oder reale Restaurant-/Provider-Notfallprüfung. F01–F03 bleiben bis zur bisherigen
Freigabe „Laptop wieder verfügbar“ eingefroren. Kein Testlauf in diesem Paket verändert reale
Nutzer.
