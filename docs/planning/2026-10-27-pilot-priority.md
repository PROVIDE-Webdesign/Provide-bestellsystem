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
User explicitly approved the project-only 24-hour management token. All 46 source migrations and exact original history versions verified. One fictional test restaurant with two menu items and a normal Auth owner is seeded; no orders or cloud MFA factors yet. Public-table RLS remains enabled. Real Turnstile widget created. Three preview worker builds/deployments and the complete synthetic checkout/status path are next. Payments, mail and delivery remain disabled.
