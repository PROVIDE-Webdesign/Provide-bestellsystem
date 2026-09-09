# Datenbankmigrationen

Dieses Verzeichnis enthält ausschließlich aufsteigend versionierte SQL-Migrationen. Die erste
fachliche Migration legt die sichere Mandantengrenze aus Restaurants und Mitgliedschaften an. Die
transaktionale Outbox speichert spätere Integrationsereignisse sicher und mandantengebunden.

Bereits angewendete Migrationen werden nicht nachträglich verändert. Korrekturen erfolgen immer in
einer neuen Migration.
