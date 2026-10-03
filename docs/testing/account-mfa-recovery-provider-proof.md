# A4: isolierter Auth-Nachweis vor der Recovery-Implementierung

Verbindliche Grundlage: Architektur A2, Projektprotokoll E16 und fachlich bestätigte A4-D01 bis
A4-D06. Der Umsetzungsauftrag vom 03.10.2026 beginnt mit dem Nachweis der gepinnten
Auth-Schnittstellen. Dieser Stand implementiert noch keinen Recovery-Ablauf.

## Konkreter Prüfstand

- Branch in Draft-PR21: `codex/a4-account-mfa-recovery-20261003`.
- Unveränderte Basis PR20: `1b00f7791576b31acf07a54d3f197822e52dd1ab`.
- SDK: `@supabase/supabase-js` 2.116.0; CLI: 2.117.0, entsprechend vorhandener CI.
- `apps/api/src/recovery.integration.test.ts` verwendet ausschließlich tatsächlich ausgestellte
  Auth-Sitzungen, synthetische Konten und einen expliziten Loopback-Stack.
- Die vorhandene Datenbank-CI führt den Test nach den bisherigen Integrationsketten aus. Keine neue
  Workflow-Berechtigung, kein Provider-Projekt und keine Secrets.
- PR21 bleibt Draft; PR20 unverändert. Kein Ready-Wechsel, Merge oder Deployment.
- CI151 am Head `487aad953fe9837091c62caaf80f17289050010a`: alle fünf Jobs PASS, einschließlich
  beider tatsächlicher Provider-Gegenproben. Der anschließende Session-Gate-Stand benötigt einen
  eigenen Laufnachweis.

## Zwei notwendige Provider-Gegenproben

1. Echte PKCE-Passwort-Recovery: Provider stellt den Recovery-Token aus; der Test liest dessen Hash
   ausschließlich in der wegwerfbaren lokalen Datenbank und lässt Auth ihn über den echten
   Verify-Endpunkt prüfen. Auth stellt den PKCE-Code aus. Ein anderer Browserkontext muss scheitern;
   der gebundene Kontext muss gelingen; erneuter Codeaustausch muss scheitern. Der signierte Token
   und die aktuelle `auth.mfa_amr_claims`-Zeile müssen den Recovery-Zweck bestätigen. Ein bewusster
   Passwortwechsel muss das alte Passwort sperren und eine neue Anmeldung erlauben.
2. Echte TOTP-Einrichtung und Bestätigung, direkte `auth.mfa.unenroll`-Gegenprobe, tatsächliches
   Admin-listFactors/deleteFactor und globales Auth-Sign-out. Ein vorher ausgestellter Token behält
   seinen signierten AAL-Wert; die widerrufene Sitzung muss aus `auth.sessions` verschwinden. Der
   Test erfasst ausschließlich sichere Aktionsnamen und Spaltennamen für die anschließende
   Architekturentscheidung.

Es werden keine Zugangstokens, Passwortwerte, Recovery-Codes/-Links oder TOTP-Geheimnisse ausgegeben
oder als Artefakte gespeichert. Der Test liest keine realen Konten. Eine erfolgreiche Anweisung an
Auth wird auf Fehler geprüft; Auth- und SQL-Zustand werden unabhängig verglichen. Ohne
Loopback-Variablen sind beide Integrationstests ausdrücklich **skipped**, niemals bestanden.

## Warum noch kein technischer A4-Abschluss vorliegt

Diese Gegenproben liefern die Voraussetzung für die aktuelle Sitzungssperre, Recovery-Zweckbindung
und belegte Auth-Ereigniszuordnung. Sie implementieren weder den gesamten Fallvertrag noch dessen
fachliche Zugangssperre. Selbst ihr späterer PASS erfüllt nicht automatisch die 35 fachlichen
Prüffälle A4-T01 bis A4-T35. Alle 35 bleiben bis zum jeweiligen Implementierungs- und Laufnachweis
offen.

Die isolierten Gegenproben bestätigen: Recovery-AMR nach PKCE, weiterhin signiertes aal2 nach
direktem Faktorentfernen, physisches Entfernen der Sitzung nach globalem Sign-out und die
Aktionsnamen `factor_unenrolled`, `factor_deleted`, `user_updated_password`. Keine DML-Änderung in
`auth.mfa_factors` als Produktweg und kein UI-only-Schutz des letzten Faktors.

## Fortsetzung und Grenzen

Der Nutzer hat Upload und separaten Draft-PR am 03.10.2026 ausdrücklich freigegeben. Der Branch ist
hochgeladen, [Draft-PR21](https://github.com/PROVIDE-Webdesign/Provide-bestellsystem/pull/21) gegen
`codex/a3-viewer-permission-20261002` eröffnet und CI151 geprüft. Die vorherige Upload-Sperre ist
damit erledigt.

Die Umsetzung läuft im bestätigten Paketumfang weiter. Aktueller Arbeitsschritt: serverseitige
Sitzungsprüfung in allen fachlichen API-Adaptern, restriktive RLS-Policies einschließlich neuer
privater Realtime-Joins und unveränderliche Provider-Beobachtung beim Entfernen eines bestätigten
Faktors. Fehlende Sitzungskennung wird im Produkt nicht toleriert. Synthetische Sitzungszeilen
bestehen ausschließlich in wegwerfbaren Test-Fixtures. Fallsteuerung, Recovery-Oberfläche und der
vollständige Nachweis der 35 Prüffälle sind noch offen.

Fortschritt unverändert 69,014550264550 %, elf Funktionslücken. Planung und
Integrationstestvorbereitung erhalten keine Gutschrift. A4 bleibt technisch offen; die bisherige
A2-2-4-Bewertung ist bereits 1. F01 bis F03 bleiben eingefroren.
