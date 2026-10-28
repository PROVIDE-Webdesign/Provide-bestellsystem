# Pilot zuerst - Nutzerentscheidung 27.10.2026

Zieltermin: 28.10.2026 (Europe/Berlin). Vorrang hat ein bedienbarer Staging-Pilot mit synthetischen
Daten: Speisekarte, Warenkorb, Testbestellung, Bestelleingang und Statuswechsel. Diese Eingrenzung
ist die Arbeitsannahme; kein bereits bestätigter Restaurant-Echtbetrieb.

Der Nutzer beauftragt, alle nicht absolut notwendigen Prüfungen aufzuschieben und den Piloten
schnellstmöglich fertigzustellen. Die bisher empfohlene allgemeine PR25-Endprüfung wird
zurückgestellt. Keine bloß organisatorischen Endprüf-, Archiv- oder Kontoinventurschleifen als
Voraussetzung für diesen Testpiloten. Gültige historische Prüfergebnisse wiederverwenden.

Notwendig für diesen Pilotpfad: erfolgreicher Build/Start, Datenbankanbindung, korrekte Preise und
Summen, höchstens eine Bestellung bei Doppelabsendung, sicherer Dashboardzugriff und
nachvollziehbare Statuswechsel. Fehler, die diese Wege blockieren, direkt korrigieren und gezielt
nachprüfen. Vollständige neue Browser-/Last-/Restore-/Provider-/Auditmatrizen und optionale
Funktionsausbauten folgen später. Offene Nachweise bleiben offen.

Echte Zahlungen, Mailversand, Restaurantdeklarationen und echte Kundendaten sind nicht Bestandteil
der anfänglichen Staging-Arbeitsannahme. Produktionsfreigabe und reale
Händler-/Geräte-/Datenschutzabnahme werden durch diese Beschleunigung nicht als erledigt behauptet.

Basis: Produktkandidat PR24 cbc78a2240eba05840b6cd712c89025bb6377635. Separater isolierter Worktree
/ Branch codex/pilot-20261028; PR8-Arbeitsbaum und bisherige lokale Daten unangetastet. Keine
automatische Migration der bisherigen Datenbank. Supabase-Cloudprojekt ist aktuell INACTIVE und noch
nicht eindeutig dem Bestellsystem zugeordnet. Ein lokaler Bestellsystem-Stack ist vorhanden; dessen
Daten werden nicht zurückgesetzt.

Stand 27.10.2026: fünf Buildaufgaben bestanden, getrennte lokale Pilotdatenbank mit 46 Migrationen
und synthetischen Gerichten gestartet. Speisekarte und Warenkorb im tatsächlichen Browser bestätigt.
Passwortanmeldung sowie reguläre MFA-Einrichtung und Codeprüfung funktionieren; danach ist der
Inhaberzugriff mit AAL2 und die leere Bestellübersicht (HTTP 200) bestätigt. Noch keine
Testbestellung.

Cloudflare und Datenbank: Der freigegebene Wiederstart des tatsächlichen Projekts
bobucujpbbqoustcnlyq (provide-bs-preview, PROVIDE Webdesign) ist abgeschlossen. Das Dashboard meldet
Healthy; eine normale SQL-Leseabfrage funktioniert. Anwendungstabellen und Migrationsregister sind
noch nicht vorhanden. Die 46 bestehenden Migrationen sind in der Cloud noch nicht angewendet.
Hyperdrive-SQL-Caching ist jetzt deaktiviert und durch erneuten authentifizierten GET bestätigt.

Browserzugriff auf das richtige Supabase-Projekt ist vorhanden. Der native Supabase-Connector bleibt
für dieses Projekt unberechtigt und die lokale CLI unangemeldet. Ein Zugangsentwurf ist auf genau
dieses Projekt und 24 Stunden begrenzt. Es wurde noch kein Token erzeugt und es wurden keine
Tokenrechte vergeben. Die automatische Freigabeprüfung blockierte bereits die Auswahl der
Datenbank-Schreibrechte, weil die konkrete Rechtefreigabe noch fehlt.

NEXT: Die konkret begrenzten Tokenrechte und das private Hinterlegen für die CLI freigeben lassen.
Danach die 46 vorhandenen Migrationen übernehmen, den geschützten Checkout konfigurieren, einen
synthetischen Abholauftrag mit Doppelabsendung, Bestelleingang und Statuswechsel prüfen und den
Staging-Piloten bereitstellen. Keine erneute Cloudflare-Anmeldung und keine Reaktivierung des
anderen, unzugeordneten Supabase-Projekts. Der Zieltermin bleibt 28.10.2026.

## 2026-10-27: Cloud schema ready

User explicitly approved the project-only 24-hour management token. All 46 source migrations and
exact original history versions verified. One fictional test restaurant with two menu items and a
normal Auth owner is seeded; no orders or cloud MFA factors yet. Public-table RLS remains enabled.
Real Turnstile widget created. Three preview worker builds/deployments and the complete synthetic
checkout/status path are next. Payments, mail and delivery remain disabled.

## Runtime blocker confirmed

Cloud checkout guard returned SQLSTATE 25006. The existing dedicated Hyperdrive role retained
default_transaction_read_only=on from the original read-only spike. Within the approved pilot write
scope this role is set to off; statement timeout and explicit service_role switching remain. Its
connection pool must be refreshed before repeating the essential smoke path.

## Online pilot result, 2026-10-27

All three preview workers deployed. Actual deployed version IDs and implementation commits are
recorded in the checkpoint. After correcting the existing read-only runtime role and restarting its
Hyperdrive pool, catalog, checkout bootstrap, server-side cart quote (EUR15.50), real password
login, real MFA enrollment/verification (AAL2 owner), access context and the empty order board all
passed against cloud services. The customer journey stopped at a visible real managed Turnstile
checkbox (Verify you are human); no CAPTCHA interaction or provider mock was performed. There are
still zero test orders. Submit, duplicate submission, status transition and customer status remain
NOT_RUN. Pilot is not yet accepted. Cloud browser execution environment is currently unavailable;
normal browser interaction cannot be continued there. Public screenshot contains only the synthetic
test contact and menu. Private credentials and all raw browser/session/worker logs remain outside
Git.

## User video / confirmed native runtime blocker

The uploaded 65-second phone recording shows successful real managed Turnstile verification followed
by a server preparation failure; no order exists. Two pending issue claims confirm failure before
provider completion. A native workerd probe reproduced TypeError constructing Request with
redirect:error; redirect:manual is accepted. Correct only the Siteverify adapter to manual mode and
retain rejection of every non-2xx response, with focused redirect rejection regression checks. User
recording and contact details remain private and are not copied into Git.

Siteverify runtime correction is deployed: API version f9849f1e-5956-476b-81c4-563177149d5f,
implementation 84ed37b27a2f0390004518df7f3a2c3e166f5a69. All55 focused tests and API typecheck
passed. A real cloud negative challenge changed from HTTP503 to intentional HTTP409 with a persisted
rejected outcome and no issued session; cross-issue reuse of the earlier invalid token remains
HTTP403. Positive checkout still needs a fresh real challenge; the normal browser is available again
and a fictional contact/cart is prepared.

## Essential internal pickup pilot completed

User explicitly approved the actual Cloudflare checkbox. The prepared real cloud browser then
received a server-issued checkout session and submitted BS-00000001, two dishes/EUR15.50. Exactly
one order exists. Normal owner password/TOTP MFA UI actions advanced it through accepted, preparing
and ready; the same customer browser displayed Abholbereit. Two cloud database replays of the
original committed, human-verified session returned the same order after independent matching of the
original normalized payload fingerprint; conflicting fingerprint was rejected. This is backend
replay evidence, not a claimed second browser HTTP submission. All essential scope-specific cases
now pass; no production/live-payment acceptance is inferred. Expanded matrices remain deferred. The
test harness was adapted to the existing intentional detail-panel close after status changes;
product status code was unchanged.
