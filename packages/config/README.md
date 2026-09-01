# `@provide/config`

Zentrale Laufzeitvalidierung für alle Anwendungen des PROVIDE-Bestellsystems.

## Sicherheitsgrenze

- `@provide/config/public` gibt ausschließlich ausdrücklich freigegebene Browserwerte zurück.
- `@provide/config/server` ergänzt Datenbank- und Sitzungsgeheimnisse nur für Serverprozesse.
- Ungültige oder fehlende Werte führen beim Start zu einem Fehler statt zu einem unsicheren
  Teilbetrieb.

Die Variablennamen und der betriebliche Ablauf stehen im
[Umgebungs- und Secret-Runbook](../../docs/runbooks/environments-and-secrets.md).
