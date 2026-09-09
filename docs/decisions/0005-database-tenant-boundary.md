# Datenbank-Mandantengrenze

## Status

Angenommen für Arbeitsblock 1.4.2.

## Entscheidung

`public.restaurants` bildet die Wurzel jedes Mandanten. Benutzer erhalten Zugriff ausschließlich
über `public.restaurant_memberships`. Jede spätere mandanteneigene Tabelle muss eine verbindliche
`restaurant_id` besitzen und ihre Row-Level-Security-Regeln auf diese Grenze zurückführen.

Der Browser darf die beiden Grundtabellen nur lesen. Anonyme Rollen erhalten keine Tabellenrechte.
Direkte Schreibrechte für angemeldete Benutzer werden zunächst nicht vergeben. Änderungen an
Restaurants und Mitgliedschaften laufen ausschließlich über den serverseitigen Dienst mit seiner
geschützten Service-Rolle und müssen dort autorisiert sowie protokolliert werden.

## Sicherheitsregeln

1. Row Level Security ist auf allen mandantenbezogenen Tabellen aktiviert und erzwungen.
2. Ohne gültige Mitgliedschaft liefert eine Abfrage keine Restaurantdaten.
3. Angemeldete Benutzer sehen nur ihre eigenen Mitgliedschaftszeilen.
4. Rollenwerte sind ab Arbeitsblock 2.2 auf `owner`, `manager`, `kitchen` und `driver` begrenzt.
5. Hilfsfunktionen liegen im nicht öffentlichen Schema `private`, verwenden einen leeren
   `search_path` und werden nur gezielt freigegeben.
6. Service-Zugangsdaten dürfen ausschließlich in einer serverseitigen Laufzeit existieren.

## Folgen

Die sichere Voreinstellung ist bewusst restriktiv. Spätere Schreibfunktionen werden als konkrete
API-Anwendungsfälle ergänzt, statt pauschale Tabellenrechte an Browser-Clients zu vergeben. Dadurch
bleibt die Mandantentrennung unabhängig von Fehlern in der Benutzeroberfläche wirksam.
