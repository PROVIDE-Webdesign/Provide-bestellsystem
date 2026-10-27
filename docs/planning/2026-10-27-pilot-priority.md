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

Cloudflare: Zugang zum dokumentierten Bestellsystem-Preview-Konto ist jetzt bestätigt. Ein
authentifizierter Hyperdrive-GET ordnet provide-bs-postgres-preview eindeutig dem Supabase-Projekt
bobucujpbbqoustcnlyq zu. Der aktuelle Supabase-Connector hat dafür keine Berechtigung; die lokale
CLI ist ebenfalls nicht angemeldet. Das andere sichtbare, pausierte Projekt kyuanppwfxtgeyfcyqvn
bleibt unzugeordnet und unangetastet. Die bisherige Cloudflare-Anmeldung muss nicht wiederholt
werden. Der vorhandene Hyperdrive-SQL-Cache ist noch eingeschaltet; vor Checkout-Aktivierung
ausschalten. Die vorhandenen Preview-Health-URLs lieferten HTTP 403; daraus folgt kein positiver
Laufzeitnachweis.

NEXT: Supabase-Zugriff für bobucujpbbqoustcnlyq freigeben, tatsächlichen Projekt-/Schema- und
Migrationsstand lesen, danach die geschützte Checkout-Laufzeit konfigurieren und genau einen
vollständigen synthetischen Abholauftrag mit Doppelabsendung, Bestelleingang und Statuswechsel
prüfen. Anschließend erreichbaren Staging-Piloten bereitstellen. Der Termin bleibt ein Ziel;
vollständiger Bestellweg und Online-Bereitstellung sind offen.
