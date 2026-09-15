# Datenbankmigrationen

Dieses Verzeichnis enthält ausschließlich aufsteigend versionierte SQL-Migrationen. Die erste
fachliche Migration legt die sichere Mandantengrenze aus Restaurants und Mitgliedschaften an. Die
transaktionale Outbox speichert spätere Integrationsereignisse sicher und mandantengebunden.
Feature-Definitionen und Restaurant-Überschreibungen ermöglichen eine standardmäßig deaktivierte,
kontrollierte Einführung neuer Funktionen. Die Standortmigration ergänzt unterhalb jedes Restaurants
eine eigene, zusammengesichert referenzierbare Betriebsgrenze. Die Personal- und Rollenmigration
begrenzt nicht verantwortliche Rollen zusätzlich auf ausdrücklich zugewiesene Restaurantstandorte.
Die Einladungs- und Lebenszyklusmigration ergänzt serververwaltete, ablaufende Personaleinladungen
und entzieht suspendierten Mitgliedschaften sofort sämtliche Mandanten- und Standortrechte. Die
Auth-Assurance-Migration verlangt für Owner und Manager zusätzlich `aal2`, lässt Kitchen und Driver
mit `aal1` in ihrem Standortumfang arbeiten und protokolliert die verifizierte Stufe bei der
Einladungsannahme. Die Onboarding- und Go-live-Migration ergänzt getrennte, serververwaltete
Zustandsmaschinen, verpflichtende Freigabeprüfungen und eine fail-closed Kundenfreigabe für
Restaurants und Standorte. Die Katalogmigration ergänzt stabile Speisekarten- und
Artikelidentitäten, unveränderliche veröffentlichte Versionen, zeitgesteuerte standortbezogene
Veröffentlichungen und eine getrennte operative Artikelverfügbarkeit. Die Bestellbarkeitsmigration
ergänzt versionierte Wochenzeiten und Kalendertagsausnahmen, getrennte Abhol- und Lieferfenster,
zeitlich begrenzte Betriebspausen sowie atomare, idempotente Kapazitätsreservierungen je
Zeitfenster. Eine nachgelagerte Berechtigungskorrektur entzieht der Service-Rolle direkte
Lebenszyklus-, Verlaufs-, Pausen- und Kapazitätsschreibrechte und erhält ausschließlich die dafür
vorgesehenen kontrollierten Funktionen als Schreibweg. Die Bestellmigration verbindet die
veröffentlichte Speisekartenversion atomar mit der reservierten Slot-Kapazität, speichert
unveränderliche Positions- und Preissnapshots und erzwingt einen kontrollierten, append-only
protokollierten Bestellstatus. Direkte Bestellschreibrechte bleiben auch für die Service-Rolle
gesperrt; Einreichung und Statuswechsel erfolgen ausschließlich über die dafür vorgesehenen
Funktionen. Die Zahlungsmigration ergänzt für jede neue Bestellung eine anbieterunabhängige
Zahlungsanforderung, idempotente Zahlungsversuche, deduplizierte Metadaten API-verifizierter
Anbieterereignisse und einen append-only Zahlungsverlauf. Betrag und Währung stammen ausschließlich
aus dem Bestell-Snapshot. Der bisherige Bestelleingang ist für die Service-Rolle gesperrt; der neue
Einstieg erstellt Bestellung und Zahlungsanforderung atomar. Onlinezahlungen bleiben durch
`payment.online` standardmäßig deaktiviert.

Die Gast-Checkout-Migration trennt den allgemeinen Bestellkontakt von den ausschließlich für eine
Lieferübergabe benötigten Daten. Beide Bereiche sind mandanten- und standortgebunden,
unveränderlich, rollenbegrenzt und über einen kontrollierten, fristgebundenen Löschlauf bereinigbar.
Personenbezogene Werte gelangen weder in Bestell- oder Zahlungstabellen noch in die Outbox. Echte
Kundendaten bleiben weiterhin gesperrt.

Bereits angewendete Migrationen werden nicht nachträglich verändert. Korrekturen erfolgen immer in
einer neuen Migration.

Die öffentliche Statusmigration ergänzt eine ausschließlich serverseitige, PII-freie Projektion für
bestehende Gast-Abholbestellungen. Sie bleibt unabhängig von einer später pausierten Speisekarte,
endet 48 Stunden nach der Abholzeit und setzt die vorgelagerte HMAC-Prüfung der API voraus.
Browserrollen erhalten keine zusätzlichen SQL- oder Tabellenrechte.

Die Dashboard-Zugriffsmigration ergänzt eine ausschließlich serverseitige Projektion der eigenen
Mitgliedschaften. Restaurant- und Standortprofile werden nur für aktive, rollen- und MFA-berechtigte
Zugriffe ausgegeben; suspendierte oder noch nicht hochgestufte Sitzungen erhalten nur den minimalen
Routingzustand.

Die Dashboard-Bestellmigration ergänzt begrenzte, service-only Listen- und Detailprojektionen sowie
einen gegen veraltete Ansichten geschützten Statusbefehl. Rollen-, MFA-, Standort- und
Mandantengrenzen werden in jeder Funktion erneut geprüft; Küche erhält keine Kontaktdaten.
