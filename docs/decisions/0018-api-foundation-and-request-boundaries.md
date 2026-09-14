# 0018: API-Grundlage und Anfragegrenzen

## Entscheidung

Die API startet mit einer kleinen, expliziten öffentlichen Oberfläche. Jede Anfrage erhält eine
Request-ID, Antworten verwenden einheitliche JSON-Hüllen und Fehler geben weder interne Details noch
Datenbankinformationen preis.

## Grenzen

1. CORS ist eine feste Allowlist je Umgebung und spiegelt keine beliebigen Origins.
2. Methoden und Pfade werden zentral geroutet; unbekannte Pfade und falsche Methoden erhalten
   eindeutige Fehlerantworten.
3. JSON-Anfragen werden auf Content-Type, UTF-8 und 64 KiB begrenzt, bevor spätere Fachlogik sie
   verarbeitet.
4. Logs enthalten nur Ereignisname und Request-ID, nie Anfragekörper, Tokens, E-Mail-Adressen oder
   Verbindungszeichenketten.

## Folgen

Neue Geschäfts-Endpunkte müssen die zentrale Router-, Antwort-, CORS- und Logging-Grundlage
verwenden. Authentifizierung, Berechtigungen, Bestellungen und Zahlungen bleiben gesonderte
Arbeitsblöcke und werden hier nicht vorweggenommen.
