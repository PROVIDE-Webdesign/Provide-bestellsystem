# O1 Supportfälle bedienen und prüfen

Voraussetzung: bewusste getrennte Aktivierung von `SUPPORT_CASES_ENABLED` in API und Dashboard,
aktuelle AAL2-Sitzung, uncached Hyperdrive und unabhängig vergebene Supportgrants. Migrationen und
Deployment vergeben/aktivieren keine realen Berechtigungen. Grantverwaltung ist nicht Teil dieser
UI.

1. `/provide/support` öffnen, anmelden/MFA durchführen und exakte interne Mandanten-/Standort-IDs
   wählen. Read-only kann Fälle und gespeicherte Nachweise lesen, keine Fälle bearbeiten/scannen.
2. Mit Manage einen internen Abgleich bewusst starten und angezeigte Fortsetzungen einzeln
   durchführen. Jede Seite liest höchstens 100 Quelleneinträge; ein abgelaufener Cursor verlangt
   einen neuen Scan. Niemals daraus eine neue Providerantwort oder Vollständigkeit nach nur einer
   unvollständigen Seite ableiten.
3. Fall öffnen, internen Quellzustand und getrennten Nachweis-/Beobachtungszeitpunkt prüfen.
   Übernehmen, berechtigt zuweisen oder unzugewiesen lassen. Wartestatus mit korrektem Grund setzen;
   interne Fristen sind keine externen SLAs. UTC-Eingabe wird in Standortzeit angezeigt.
4. Technischen Abschluss nur bei angezeigtem aktuellem internem Beleg beantragen. Bei Conflict den
   Beleg erneut lesen. Administrative Schließung verlangt einen passenden Grund und bestätigt
   ausdrücklich keine Zahlung, Erstattung oder Zustellung. Wiederöffnung benötigt `reopened`.
5. Bei ausgebliebener Antwort den angebotenen **gleichen Auftrag** wiederholen. Kein neuer
   Request-ID-Auftrag als unkontrollierter Ersatz. 401/403 entfernt Daten; Zugangs-/MFA-Recovery
   gehört in den bestehenden A4-Prozess, nicht in die Supportfallverwaltung.

Die Oberfläche enthält keine Kundenkontakte, freies Notizfeld, Provider-URLs,
PaymentIntent-Erfassung, Refund-/Versand-Retry oder Bestellbearbeitung. Benötigte externe Provider-
oder Fachaktionen müssen separat mit den vorhandenen Rollen, Runbooks und Freigaben bearbeitet
werden. Es gibt keinen automatischen Eskalationsversand und keine zusätzlichen Zahlungen für diesen
Prüflauf.

Prüfung im ausdrücklich isolierten Teststack: `supabase test db`, alle Pflichtchecks und
`src/support.integration.test.ts` mit den bestehenden maskierten Loopback-Testvariablen der CI.
Keine produktive Verbindung und keine realen Konten verwenden. Browserlauf verwendet die echte
Komponente mit ausdrücklich synthetischem Transport; 390/1440 Pixel, Chromium/Firefox/WebKit. Dies
ersetzt keine physischen Geräte- oder Screenreaderabnahmen.
