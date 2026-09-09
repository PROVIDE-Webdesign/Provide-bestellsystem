# Datenbankmigrationen

Dieses Verzeichnis enthält ausschließlich aufsteigend versionierte SQL-Migrationen. Die erste
fachliche Migration legt die sichere Mandantengrenze aus Restaurants und Mitgliedschaften an. Die
transaktionale Outbox speichert spätere Integrationsereignisse sicher und mandantengebunden.
Feature-Definitionen und Restaurant-Überschreibungen ermöglichen eine standardmäßig deaktivierte,
kontrollierte Einführung neuer Funktionen. Die Standortmigration ergänzt unterhalb jedes Restaurants
eine eigene, zusammengesichert referenzierbare Betriebsgrenze. Die Personal- und Rollenmigration
begrenzt nicht verantwortliche Rollen zusätzlich auf ausdrücklich zugewiesene Restaurantstandorte.

Bereits angewendete Migrationen werden nicht nachträglich verändert. Korrekturen erfolgen immer in
einer neuen Migration.
