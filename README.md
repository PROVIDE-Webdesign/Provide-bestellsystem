# PROVIDE Online-Bestellsystem

Mandantenfähige Bestellplattform für Gastronomiebetriebe. Asian Kitchen dient zunächst als
Staging-Pilot.

## Projektstatus

- Architektur-SoT: `PROVIDE Bestellsystem - Architektur und Arbeitsplan A2`
- Organisatorische SoT: `PROVIDE Bestellsystem Projektprotokoll V2`
- Aktiver Arbeitsblock: `1.2 - Umgebungen und sichere Konfiguration`
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

## Sicherheit

Geheimnisse, Zugangsdaten, echte Kundendaten und Produktionskonfigurationen gehören niemals in
dieses Repository. Zulässige Variablennamen werden ausschließlich mit leeren oder ungefährlichen
Beispielwerten in `.env.example` dokumentiert.

## Rechte

Dieses Repository ist öffentlich sichtbar, aber nicht als Open Source lizenziert. Siehe
[LICENSE](LICENSE) und [SECURITY.md](SECURITY.md).
