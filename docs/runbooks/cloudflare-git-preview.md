# Cloudflare Workers Builds: bestehender Storefront-Pilot

Stand 28.10.2026: Git-Verbindung zum bestehenden Worker ist bestätigt. Nach Korrektur der
Contracts-Buildreihenfolge wurde Commit `2b82753` erfolgreich gebaut und veröffentlicht. Die neue
Menüzuordnung verwendet jetzt die vom Nutzer exportierten veröffentlichten Artikel-IDs; ihren
eigenen automatischen Build anschließend beobachten. Checkout-Abnahme steht noch aus. Dieser Weg
benötigt nach erfolgreicher Einrichtung keinen laufenden Nutzer-PC und keinen bezahlten
Desktop-Commander-Zugriff.

## Einmalige Verknüpfung

Im eigenen normalen Browser das bereits verwendete Cloudflare-Konto öffnen. Workers & Pages →
`provide-bs-storefront-preview` → Settings → Builds → Connect. Den bestehenden Worker verbinden,
keine neue Anwendung anlegen.

Bei GitHub ausschließlich `PROVIDE-Webdesign/Provide-bestellsystem` für diese Integration auswählen.
Berechtigungen im tatsächlichen Freigabedialog prüfen und selbst bestätigen. Keinen separaten
persönlichen API-Token erzeugen oder in den Chat kopieren. Workers Builds verwaltet den
erforderlichen Deployment-Zugang im eigenen Einrichtungsablauf.

| Feld                                             | Wert                                      |
| ------------------------------------------------ | ----------------------------------------- |
| Git-Repository                                   | `PROVIDE-Webdesign/Provide-bestellsystem` |
| Deploy-/Production-Branch dieses Preview-Workers | `codex/pilot-20261028`                    |
| Root directory                                   | `apps/storefront`                         |
| Build command                                    | `pnpm run build`                          |
| Deploy command                                   | `pnpm deploy:cloud-preview`               |
| Zusätzliche Branch-/PR-Preview-Builds            | deaktiviert lassen                        |
| Build variable `NODE_VERSION`                    | `24.22.1`                                 |
| Build variable `PNPM_VERSION`                    | `11.19.0`                                 |

Die automatische Abhängigkeitsinstallation eingeschaltet lassen. Das Repository besitzt
`packageManager: pnpm@11.19.0` und ein Lockfile. Der bestehende API-Worker und das Dashboard werden
mit dieser Verbindung nicht gebaut oder bereitgestellt. `main` wird nicht gemergt. Bei einer neuen
kostenpflichtigen Option abbrechen; zusätzliche Ausgaben sind nicht freigegeben.

## Vorhandene Laufzeitwerte erhalten

`deploy:cloud-preview` führt nach dem vollständigen Build den Node-Helfer
`scripts/prepare-storefront-cloud-build.mjs` aus und startet den im Projekt fixierten Wrangler. Der
Helfer ist auf den bereits zugeordneten Storefront-Preview-Worker und das bestehende
Cloudflare-Konto begrenzt. Er bearbeitet ausschließlich die generierte Datei unter `dist/`:
Repository-`vars` werden entfernt und `keep_vars: true` gesetzt. Damit werden insbesondere
API-Adresse, Checkoutschutz, Origin, öffentliche Turnstile-Konfiguration und Hinweisversion nicht
durch lokale Platzhalter ersetzt. `--keep-vars` ist zusätzlich am Deploy-Befehl gesetzt. Vorhandene
verschlüsselte Secrets bleiben bei Wrangler-Deployments erhalten.

Die neue Asian-Kitchen-Funktion ist dadurch noch nicht freigeschaltet. Ihr bestehender
Laufzeitschalter wird nicht automatisch geändert. Nach Veröffentlichung des vollständigen
synthetischen Menüs kann `ASIAN_KITCHEN_DEMO_ENABLED=true` unter Settings → Variables & Secrets des
Storefront-Preview-Workers bewusst gesetzt werden. Keine Geheimnisse kopieren, exportieren oder als
Buildvariablen duplizieren. Bei abweichender vorhandener Konfiguration erst klären.

## Build-Minuten begrenzen

Unter Settings → Builds → Build watch paths folgende Include-Pfade eintragen:

```text
apps/storefront/*
packages/contracts/*
scripts/build-asian-kitchen-demo.mjs
scripts/prepare-storefront-cloud-build.mjs
pnpm-lock.yaml
pnpm-workspace.yaml
package.json
tsconfig.base.json
```

Exclude-Pfade:

```text
docs/*
*.md
```

Damit lösen reine Protokolländerungen regulär keinen Build aus. Cloudflare dokumentiert Ausnahmen
unter anderem für Pushes mit mindestens 20 Commits; deshalb keine Freiminuten- Garantie ableiten und
den ersten Build im Dashboard beobachten. Der Free-Plan nennt aktuell 3.000 Build-Minuten pro Monat,
einen parallelen Build und maximal 20 Minuten pro Build.

## Erster tatsächlicher Nachweis

Der Storefront-Befehl baut zuerst `@provide/contracts`, danach die Asian-Kitchen-Dateien und
anschließend Vinext. Das Contracts-Paket exportiert `dist/index.js`; bei einem frischen
Cloud-Checkout existiert diese Datei vor seinem TypeScript-Build nicht. Die bisherige lokale
Monorepo-Buildreihenfolge über Turbo hatte diesen Schritt bereits vorgeschaltet.

Der Cloud-Build für `2b82753` war erfolgreich (Build `14db5e97-318c-4736-9b7a-0376d8d991ff`,
Worker-Version `8b4d3dac-698d-4439-882d-9beaf3e657b4`). Der Nutzer bestätigte durch ein
iPhone-Video, dass die zusätzliche Asian-Kitchen-Seite samt Menü und Bildern lädt.

Der Nutzer hat inzwischen das vollständige synthetische Menü veröffentlicht. Der unter
`docs/pilot/asian-kitchen-published-catalog-20261028.json` festgehaltene öffentliche Katalog enthält
12 verfügbare Artikel und 8 Varianten. Nach jedem neuen Import die tatsächlichen veröffentlichten
IDs bewusst prüfen; die Importoberfläche vergibt neue Artikel-IDs. Die neue Manifeständerung
benötigt ihren eigenen erfolgreichen automatischen Build.

Nach erfolgreicher Zuordnungsbereitstellung den Storefront-Laufzeitschalter aktivieren und genau
einen echten Durchlauf mit Variante, Turnstile, Dashboard-Bearbeitung und demselben Kundenstatus
unter `/asian-kitchen/` belegen. Keine echte Restaurantfreigabe, Lieferung, Onlinezahlungen oder
Mail aktivieren.

## Primärquellen

- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/ci-cd/builds/build-image/
- https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/
- https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth
- https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy
