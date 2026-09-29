# PROVIDE Online-Bestellsystem

Mandantenfähige Bestellplattform für Gastronomiebetriebe. Asian Kitchen dient zunächst als
Staging-Pilot.

## Projektstatus

- Architektur-SoT: `PROVIDE Bestellsystem - Architektur und Arbeitsplan A2`
- Organisatorische SoT: `PROVIDE Bestellsystem Projektprotokoll V2`
- Arbeitsblock 3.1 ist abgeschlossen und formal freigegeben.
- Arbeitsblock 3.2 ist technisch endfreigegeben und über PR #1 in `main` zusammengeführt.
- Umsetzung und Nachweise: [Arbeitsblock 3.2](docs/work-blocks/3.2-public-storefront.md).
- Arbeitsblock 3.3 – Warenkorb und sicherer Gast-Abholcheckout – ist technisch endfreigegeben und
  über PR #2 in `main` zusammengeführt.
- Umsetzung und Nachweise: [Arbeitsblock 3.3](docs/work-blocks/3.3-guest-pickup-checkout.md).
- Arbeitsblock 3.4 – sicherer öffentlicher Gast-Bestellstatus – ist technisch endfreigegeben und
  über PR #3 in `main` zusammengeführt.
- Umsetzung und Nachweise: [Arbeitsblock 3.4](docs/work-blocks/3.4-public-order-status.md).
- Arbeitsblock 3.5 – sichere Dashboard-Anmeldung und MFA-Zugangsgrenze – ist technisch
  endfreigegeben und über PR #4 in `main` zusammengeführt.
- Umsetzung und Nachweise: [Arbeitsblock 3.5](docs/work-blocks/3.5-dashboard-authentication.md).
- Arbeitsblock 3.6 – operative Bestellübersicht und Statusbearbeitung – ist technisch endfreigegeben
  und über PR #5 in `main` zusammengeführt.
- Umsetzung und Nachweise: [Arbeitsblock 3.6](docs/work-blocks/3.6-dashboard-order-operations.md).
- Arbeitsblock 3.7 – zuverlässige transaktionale Gast-Bestellbenachrichtigungen – ist technisch
  endfreigegeben und über PR #6 in `main` zusammengeführt.
- Umsetzung und Nachweise: [Arbeitsblock 3.7](docs/work-blocks/3.7-order-notifications.md).
- Arbeitsblock 3.8 – sichere Lieferbestellungen und Liefergebietsprüfung – ist technisch
  endfreigegeben und über PR #7 in `main` zusammengeführt.
- Umsetzung und Nachweise: [Arbeitsblock 3.8](docs/work-blocks/3.8-secure-delivery-orders.md).
- Arbeitsblock 3.9 – Onlinezahlungen im Testbetrieb – ist formal freigegeben und umgesetzt;
  automatisierte Prüfungen sind erfolgreich, der echte Stripe-Sandbox-Nachweis steht noch aus.
- Umsetzung und Nachweise: [Arbeitsblock 3.9](docs/work-blocks/3.9-sandbox-online-payments.md).
- Gesamtfortschritt des freigegebenen MVP-Umfangs: **84 %** (gewichtete Schätzung, etwa ±2
  Prozentpunkte).
- Das Deployment der kundenbezogenen Arbeitsblöcke steht aus.
- Livezahlungen, echte Kundendaten und produktive Restaurantbestellungen sind nicht freigegeben.

## Geplante Anwendungen

- `apps/storefront`: Kundenseitige Speisekarte, Warenkorb, Checkout und Bestellstatus
- `apps/dashboard`: geschützter Restaurantzugang; PROVIDE-Administration bleibt getrennt
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

Der standardmäßig deaktivierte Gast-Abholcheckout und seine synthetische Prüfkette stehen im
[Checkout-Runbook](docs/runbooks/guest-pickup-checkout.md).

Die standardmäßig deaktivierte Benachrichtigungsverarbeitung und ihre ausschließlich synthetische
Adapterprüfung stehen im [Benachrichtigungs-Runbook](docs/runbooks/order-notifications.md).

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
