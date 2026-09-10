# Datenbankmigrations-Runbook

## Zweck

Dieses Runbook legt den reproduzierbaren Umgang mit der PostgreSQL-Struktur fest. Es gilt für lokale
Entwicklung, automatisierte Tests, Preview und die spätere Produktion.

## Verbindliche Regeln

1. Jede Strukturänderung wird als versionierte SQL-Migration unter `supabase/migrations/`
   gespeichert.
2. Entfernte Datenbanken werden nicht direkt über den Table Editor oder SQL Editor verändert.
3. Migrationen werden zuerst gegen eine kurzlebige lokale Testdatenbank geprüft.
4. Preview und Produktion verwenden getrennte Supabase-Projekte und getrennte Zugangsdaten.
5. Zugangsdaten, Projekt-Tokens und Datenbankpasswörter werden niemals committed.
6. Nur eine verantwortliche Person wendet Migrationen auf eine entfernte Umgebung an.
7. Produktionsmigrationen bleiben bis zum dokumentierten Go-live-Gate gesperrt.

## Werkzeugstand

- Supabase CLI ist als feste Projektabhängigkeit im Root-Workspace hinterlegt.
- GitHub Actions liest dieselbe Version aus `pnpm-lock.yaml`.
- Die lokale Konfiguration enthält ausschließlich unkritische Testwerte.
- Die PostgreSQL-Hauptversion in `supabase/config.toml` wird vor dem ersten Preview-Push durch
  `show server_version;` mit dem entfernten Projekt abgeglichen.

## Lokale Befehle

Für die vollständige lokale Datenbankumgebung wird ein Docker-kompatibler Containerdienst benötigt.
Die normalen TypeScript- und Build-Prüfungen funktionieren weiterhin ohne Docker.

```bash
pnpm db:start
pnpm db:reset
pnpm db:test
pnpm db:stop
```

Unter Windows werden dieselben Skripte mit `pnpm.cmd` aufgerufen.

## Automatisierte Prüfung

Der Job `database` in `.github/workflows/ci.yml` startet auf GitHub eine isolierte PostgreSQL-
Testdatenbank und führt alle Dateien unter `supabase/tests/` aus. Dafür werden keine Zugangsdaten
des Preview-Projekts benötigt.

## Neue Migration anlegen

```bash
pnpm exec supabase migration new beschreibung_der_aenderung
```

Anschließend wird die erzeugte SQL-Datei ausgefüllt und mit einer vollständig zurückgesetzten
lokalen Datenbank sowie den Datenbanktests geprüft.

## Preview anwenden

Das Verbinden und Anwenden auf das getrennte Preview-Projekt erfolgt erst nach grüner CI und einer
eigenen Freigabe. Der geplante Ablauf lautet:

1. Supabase CLI anmelden.
2. Das Preview-Projekt anhand seiner Projektkennung verbinden.
3. Migrationsstatus prüfen.
4. Ausstehende Migrationen mit `supabase db push` anwenden.
5. Migrationsstatus und ausschließlich synthetische Prüfdaten kontrollieren.

Die konkreten Zugangsbefehle werden nicht in Logs, Screenshots oder dieses Repository kopiert.

## Mandantensicherheit

Die erste fachliche Migration legt Restaurants und Benutzerzuordnungen an. Die verbindlichen
Mandantengrenzen und Rechte sind in der
[Datenbank-Mandantengrenze](../decisions/0005-database-tenant-boundary.md) dokumentiert. Jede
spätere mandanteneigene Tabelle benötigt eine `restaurant_id`, aktivierte und erzwungene Row Level
Security sowie positive und negative Datenbanktests.

Standortbezogene Tabellen referenzieren `public.locations` immer gemeinsam über `restaurant_id` und
`location_id`. Der zusammengesetzte Fremdschlüssel verhindert, dass eine Restaurant-ID mit einem
Standort eines anderen Mandanten kombiniert wird. Owner sehen alle Standorte ihres Restaurants;
Manager, Küchenpersonal und Fahrer benötigen eine ausdrückliche Standortzuweisung.

Personalzuweisungen stehen in `public.restaurant_membership_locations`. Rollen- und
Zuweisungsänderungen werden nicht direkt aus dem Browser geschrieben. Vor einer Rollenverschärfung
müssen vorhandene Datensätze mit veralteten oder mehrdeutigen Rollen bewusst eingeordnet werden.

## Personaleinladungen

Personaleinladungen werden dreistufig angelegt:

1. Der API-Server erzeugt oder lädt den Zielbenutzer über Supabase Auth und erhält dessen stabile
   Benutzer-ID. Ein erzeugter Provider-Link bleibt dabei nur im Arbeitsspeicher des Servers.
2. Danach speichert der Server die fachliche Einladung mit derselben Auth-Benutzer-ID in
   `restaurant_invitations` und ergänzt bei Nicht-Ownern mindestens einen zulässigen Standort.
3. Erst nach erfolgreichem Datenbankabschluss versendet der Server den Provider-Link. Schlägt der
   Versand fehl, bleibt die Einladung wiederholbar; ein neuer Provider-Link wird erzeugt, ohne ein
   Geheimnis in der PROVIDE-Datenbank abzulegen.

Der Provider-Link und sein Token werden nicht in der PROVIDE-Datenbank, in Logs oder im Repository
gespeichert. Nur der Server darf `private.accept_restaurant_invitation` ausführen. Vor dem Aufruf
muss der Server den angemeldeten Benutzer über Supabase Auth verifiziert haben und genau dessen ID
als `target_user_id` übergeben.

Beim Suspendieren einer Mitgliedschaft bleiben die Datensätze bestehen. Die RLS-Hilfsfunktionen
gewähren ausschließlich Mitgliedschaften mit `status = 'active'` Zugriff. Dadurch wirkt eine
Suspendierung sofort auf Restaurant-, Rollen- und Standortabfragen. Das zusätzliche Widerrufen
aktiver Supabase-Sessions wird mit der Auth-/API-Integration ergänzt.

## Transaktionale Integrationsereignisse

Fachliche Änderungen, die später eine externe Reaktion auslösen, schreiben ihr versioniertes
Ereignis innerhalb derselben Datenbanktransaktion in `public.outbox_events`. Die Tabelle ist keine
allgemeine Protokollablage: Nutzdaten bleiben auf den für den Adapter notwendigen Umfang begrenzt
und enthalten weder Zugangsdaten noch unnötige personenbezogene Daten.

Browserrollen besitzen keine Outbox-Rechte. Supabases vertrauenswürdige Service-Rolle bleibt
ausschließlich serverseitig und besitzt vollständigen Tabellenzugriff. Der reguläre Anwendungsablauf
löscht Ereignisse nicht direkt; eine kontrollierte Aufbewahrungs- und Bereinigungsregel wird in
einem späteren Arbeitsblock beschlossen.

## Feature-Flags

Bekannte Features werden in `public.feature_definitions` registriert. Optionale Einträge in
`public.restaurant_feature_flags` überschreiben den Standardwert für genau ein Restaurant. Eine
fehlende Überschreibung übernimmt den registrierten Standard; unbekannte Feature-Schlüssel gelten
immer als deaktiviert.

Alle neuen Features starten deaktiviert. Browserrollen besitzen keine direkten Rechte auf die
Tabellen oder die interne Auflösungsfunktion. Änderungen erfolgen später ausschließlich über einen
freigegebenen serverseitigen Administrationsablauf. Feature-Flags steuern die Einführung einer
Funktion, ersetzen aber niemals deren Autorisierung oder fachliche Validierung.
