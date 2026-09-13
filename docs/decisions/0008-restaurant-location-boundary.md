# Restaurant- und Standortgrenze

## Status

Angenommen für Arbeitsblock 2.1.

## Entscheidung

`public.restaurants` bleibt die Wurzel eines Mandanten. `public.locations` bildet die
darunterliegende Standortgrenze. Jeder Standort gehört unveränderlich genau zu einem Restaurant und
besitzt einen nur innerhalb dieses Restaurants eindeutigen Slug.

Der zusammengesetzte eindeutige Schlüssel `(restaurant_id, id)` ist absichtlich zusätzlich zur
globalen Standort-ID vorhanden. Spätere standortbezogene Tabellen müssen beide Werte gemeinsam
referenzieren. Dadurch kann eine Zeile nicht versehentlich die Restaurant-ID eines Mandanten mit der
Standort-ID eines anderen Mandanten verbinden.

## Sicherheitsregeln

1. Row Level Security ist für Standorte aktiviert und erzwungen.
2. Owner sehen alle Standorte ihres Restaurants. Andere Personalrollen sehen nur ausdrücklich
   zugewiesene Standorte.
3. Anonyme Nutzer erhalten keine direkten Standortrechte.
4. Browsernutzer besitzen keine direkten Schreibrechte; Standortänderungen erfolgen später über
   autorisierte Serverabläufe.
5. Die Einschränkung auf einzelne Personalstandorte ist ab Arbeitsblock 2.2 verbindlich.
6. Unvollständige Adressdaten bleiben während der Einrichtung zulässig. Die spätere Go-live-Prüfung
   verlangt einen vollständigen, nachgewiesenen Standort.
7. `setup`, `active` und `suspended` beschreiben ausschließlich den Betriebszustand des Standorts.
   Der separate Onboarding- und Go-live-Status wird durch die serverseitige Zustandsmaschine aus
   Arbeitsblock 2.5 verwaltet.

## Folgen

Das Schema unterstützt bereits mehrere Standorte pro Restaurant, ohne den MVP zur Nutzung mehrerer
Standorte zu zwingen. Fachliche Tabellen aus späteren Arbeitsblöcken erhalten eine überprüfbare
Mandanten- und Standortzuordnung. Rollen, Einladungen und MFA werden bewusst nicht in dieser
Migration vermischt. Die Kundenfreigabe erfolgt getrennt über den Onboarding- und Go-live-Zustand.
