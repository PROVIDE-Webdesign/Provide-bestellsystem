# A4: isolierter Auth-Nachweis vor der Recovery-Implementierung

Verbindliche Grundlage: Architektur A2, Projektprotokoll E16 und fachlich bestätigte A4-D01 bis
A4-D06. Der Umsetzungsauftrag vom 03.10.2026 beginnt mit dem Nachweis der gepinnten
Auth-Schnittstellen. Dieser Stand implementiert noch keinen Recovery-Ablauf.

## Konkreter Prüfstand

- Neuer lokaler Branch: `codex/a4-account-mfa-recovery-20261003`.
- Unveränderte Basis PR20: `1b00f7791576b31acf07a54d3f197822e52dd1ab`.
- SDK: `@supabase/supabase-js` 2.116.0; CLI: 2.117.0, entsprechend vorhandener CI.
- `apps/api/src/recovery.integration.test.ts` verwendet ausschließlich tatsächlich ausgestellte
  Auth-Sitzungen, synthetische Konten und einen expliziten Loopback-Stack.
- Die vorhandene Datenbank-CI führt den Test nach den bisherigen Integrationsketten aus. Keine neue
  Workflow-Berechtigung, kein Provider-Projekt und keine Secrets.
- Kein Produktcode, keine ausgefüllte Migration, keine Default-Aktivierung und keine Änderung von
  PR20. Kein Ready-Wechsel, Merge oder Deployment.

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

Vor Umsetzung sind insbesondere zu klären: tatsächliches Verhalten der gepinnten Auth-Version beim
Faktorentfernen, Recovery-AMR nach PKCE, aktueller Sessionzustand und verwendbare
Audit-Aktionsnamen. Keine DML-Änderung in `auth.mfa_factors` als Produktweg und kein UI-only-Schutz
des letzten Faktors.

## Fortsetzung und Grenzen

Die automatische Freigabeprüfung hat den Upload dieses Branches zweimal abgelehnt, weil sie keine
ausreichende user-authored Berechtigung zur Veröffentlichung im Remote
`PROVIDE-Webdesign/Provide-bestellsystem` festgestellt hat. Das Remote wurde lesend geprüft und
stimmt mit dem verbundenen PR20 überein; der Upload bleibt trotzdem bis zur ausdrücklichen
Nutzerfreigabe gesperrt. Es wird kein alternativer Uploadweg als Umgehung verwendet.

Nach ausdrücklicher Freigabe: diesen Branch hochladen, einen getrennten Draft-PR gegen
`codex/a3-viewer-permission-20261002` eröffnen, reale isolierte Gegenproben ausführen, mögliche
Befunde korrigieren und anschließend A4 im bereits bestätigten Paketumfang vollständig umsetzen und
prüfen. Keine erneute fachliche Entscheidung über A4-D01 bis A4-D06 notwendig.

Fortschritt unverändert 69,014550264550 %, elf Funktionslücken. Planung und
Integrationstestvorbereitung erhalten keine Gutschrift. A4 bleibt technisch offen; die bisherige
A2-2-4-Bewertung ist bereits 1. F01 bis F03 bleiben eingefroren.
