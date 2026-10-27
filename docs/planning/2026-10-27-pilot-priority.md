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

NEXT: exakten Produktstand installieren, bauen und eine getrennte Pilotlaufzeit vorbereiten. Termin
ist ein Ziel; eine belastbare Zusage setzt den funktionierenden vollständigen Bestellweg und
erreichbare Bereitstellung voraus.
