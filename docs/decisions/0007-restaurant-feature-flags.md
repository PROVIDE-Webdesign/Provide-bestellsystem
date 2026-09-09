# Mandantenfähige Feature-Flags

## Status

Angenommen für Arbeitsblock 1.4.4.

## Entscheidung

Neue Produktfunktionen werden über serverseitig verwaltete Feature-Flags kontrolliert. Das zentrale
Register `public.feature_definitions` beschreibt ausschließlich bekannte Features und ihren sicheren
Standardwert. `public.restaurant_feature_flags` enthält optionale, mandantenspezifische
Überschreibungen.

Die Auflösung folgt einer festen Reihenfolge:

1. Existiert ein Eintrag für das Restaurant und das Feature, gilt dessen Wert.
2. Andernfalls gilt der registrierte Standardwert.
3. Unbekannte Feature-Schlüssel gelten immer als deaktiviert.

Die getrennten Datenbanken für Entwicklung, Test, Preview und Produktion bilden zugleich die
Umgebungsgrenze. Dadurch können Standardwerte je Umgebung verwaltet werden, ohne Umgebungsnamen in
fachlichen Tabellen zu speichern.

## Erste Feature-Schlüssel

- `ordering.accept_orders`
- `fulfillment.pickup`
- `fulfillment.delivery`
- `payment.online`

Alle vier Features starten deaktiviert. Ihre fachliche Implementierung und Aktivierung sind nicht
Teil dieses Arbeitsblocks.

## Sicherheitsregeln

1. Feature-Schlüssel müssen im zentralen Register vorhanden sein und dem festgelegten Format folgen.
2. Browserrollen erhalten weder Tabellenrechte noch Zugriff auf die interne Auflösungsfunktion.
3. Supabases vertrauenswürdige Service-Rolle verwaltet und liest die Flags ausschließlich
   serverseitig.
4. Fehlende oder unbekannte Werte werden immer als deaktiviert behandelt.
5. Ein Restaurant kann pro Feature höchstens eine Überschreibung besitzen.
6. Feature-Flags ersetzen keine Autorisierung, Mandantenprüfung oder fachliche Validierung.
7. Änderungen in Produktion bleiben bis zu einem späteren Freigabe- und Auditablauf gesperrt.

## Folgen

Funktionen können später kontrolliert für den Asian-Kitchen-Piloten oder einzelne Restaurants
freigeschaltet werden. Die Anwendungen konsumieren die Flags erst in einem späteren Arbeitsblock
über eine serverseitige Schnittstelle; bis dahin bleibt das Systemverhalten unverändert.
