# PROVIDE Online-Bestellsystem

Mandantenfähige Bestellplattform für Gastronomiebetriebe. Asian Kitchen dient zunächst als
Staging-Pilot.

## Projektstatus

- Architektur-SoT: `PROVIDE Bestellsystem - Architektur und Arbeitsplan A2`
- Organisatorische SoT: `PROVIDE Bestellsystem Projektprotokoll V2`
- Arbeitsblock 3.1 ist abgeschlossen und formal freigegeben.
- Aktiver Arbeitsblock: `3.2 - Öffentliche Storefront und Speisekarte` (PR #1 veröffentlicht;
  Pflichtprüfungen `check` und `database` grün; technische Endfreigabe und Merge ausstehend).
- Umsetzung und Nachweise: [Arbeitsblock 3.2](docs/work-blocks/3.2-public-storefront.md).
- Livezahlungen, echte Kundendaten und produktive Restaurantbestellungen sind nicht freigegeben.

## Geplante Anwendungen

- `apps/storefront`: Kundenseitige Speisekarte, Warenkorb, Checkout und Bestellstatus
- `apps/dashboard`: Restaurant-Dashboard und PROVIDE-Administration
- `apps/api`: Geschäftslogik, Webhooks, Jobs und Integrationsadapter
- `packages/contracts`: Anbieterunabhängige Typen und fachliche Verträge
- `packages/ui`: Geteilte, barrierearme UI-Bausteine
- `packages/config`: Geteilte, sichere Werkzeug- und Laufzeitkonfiguration

## Lokaler Einstieg

Voraussetzungen:

- Node.js 24
- pnpm 11

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm check
```

Unter Windows PowerShell lautet der Kopierbefehl:

```powershell
Copy-Item .env.example .env.local
```

Die Beispielwerte sind nur für die lokale Entwicklung bestimmt. Vorschau- und
Produktionskonfigurationen werden getrennt in der jeweiligen Plattform hinterlegt. Details stehen im
[Umgebungs- und Secret-Runbook](docs/runbooks/environments-and-secrets.md).

Die versionierte Datenbankstruktur wird mit der Supabase CLI verwaltet. Der Einstieg und die Regeln
für lokale sowie entfernte Migrationen stehen im
[Datenbankmigrations-Runbook](docs/runbooks/database-migrations.md).

## Verbindliche Abschlussregel

Nach jedem technisch abgeschlossenen Arbeitsblock nennt der Abschlussbericht den Gesamtfortschritt
des PROVIDE Bestellsystems in Prozent, einschließlich Berechnungsgrundlage und verbleibender
Unsicherheit. Ein Arbeitsblock zählt erst nach erfolgreicher lokaler Prüfung, Commit, Push und
grünen Pflichtprüfungen als technisch abgeschlossen.

## Sicherheit

Geheimnisse, Zugangsdaten, echte Kundendaten und Produktionskonfigurationen gehören niemals in
dieses Repository. Zulässige Variablennamen werden ausschließlich mit leeren oder ungefährlichen
Beispielwerten in `.env.example` dokumentiert.

## Rechte

Dieses Repository ist öffentlich sichtbar, aber nicht als Open Source lizenziert. Siehe
[LICENSE](LICENSE) und [SECURITY.md](SECURITY.md).
