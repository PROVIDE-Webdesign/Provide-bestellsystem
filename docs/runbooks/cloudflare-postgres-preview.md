# Runbook: Cloudflare-/PostgreSQL-Preview

Dieses Runbook schließt Arbeitsblock 1.3 ab. Es dürfen keine Zugangsdaten in Chat, Git, Screenshots
oder Shell-Befehle kopiert werden.

## 1. Konten und Regionen

1. Im PROVIDE-eigenen Cloudflare-Konto anmelden und MFA aktivieren.
2. In einer PROVIDE-eigenen Supabase-Organisation ein ausschließlich für Preview bestimmtes Projekt
   anlegen.
3. Als Region ausdrücklich Frankfurt / `eu-central-1` wählen.
4. Nur synthetische Testdaten verwenden.

## 2. Minimalen Datenbankbenutzer anlegen

Für den Spike einen eigenen Login-Benutzer erstellen. Er benötigt für `SELECT 1` nur das Recht, sich
mit der ausgewählten Datenbank zu verbinden. Keine Tabellenrechte und keine administrativen Rollen
vergeben.

Das zufällige Passwort ausschließlich im jeweiligen Secret-Dialog speichern. Es gehört weder in eine
lokale Datei noch in die Git-Historie.

## 3. Hyperdrive einrichten

1. In Supabase die direkte PostgreSQL-Verbindung verwenden, nicht den Pooler.
2. In Cloudflare eine Hyperdrive-Konfiguration mit diesem direkten Endpunkt und dem minimalen
   Spike-Benutzer erstellen.
3. Die erzeugte Hyperdrive-ID in `apps/api/wrangler.jsonc` anstelle der dokumentierten
   Platzhalter-ID eintragen. Die ID ist keine Datenbank-Zugangsinformation; Benutzername und
   Passwort bleiben in Cloudflare.

## 4. Preview bereitstellen

Nach erfolgreicher Anmeldung mit Wrangler aus dem Repository-Stamm ausführen:

```powershell
pnpm check
pnpm --filter @provide/storefront deploy:preview
pnpm --filter @provide/api deploy:preview
```

Die ausgegebenen Preview-URLs notieren. Keine geheimen Werte in GitHub-Issues oder Chat posten.

## 5. Abnahme

Folgende Aufrufe müssen jeweils HTTP 200 liefern:

| Dienst     | Pfad               | Erwartung                                  |
| ---------- | ------------------ | ------------------------------------------ |
| Storefront | `/`                | interne Spike-Seite wird angezeigt         |
| Storefront | `/api/health`      | Storefront meldet sich gesund              |
| API        | `/health`          | API meldet sich gesund                     |
| API        | `/health/database` | Hyperdrive-Abfrage liefert `healthy: true` |

Zusätzlich prüfen:

1. GitHub-CI ist grün.
2. Cloudflare-Logs enthalten keine Zugangsdaten.
3. Supabase enthält keine echten Personen-, Bestell- oder Zahlungsdaten.
4. Ein absichtlich nicht erreichbarer Datenbankzugang gibt nur eine neutrale Fehlermeldung aus.

## 6. Abschluss oder Rückbau

Bei bestandener Abnahme werden die Preview-URLs, Zeitstempel und Commit-ID im Spike-Protokoll
festgehalten und ADR 0004 auf „Angenommen“ gesetzt.

Bei Abbruch werden Worker, Hyperdrive-Konfiguration, Spike-Benutzer und Preview-Projekt entfernt
oder deaktiviert. Verwendete Passwörter werden anschließend rotiert. Ein Wechsel auf den
React-Router-Fallback benötigt eine neue dokumentierte Entscheidung.
