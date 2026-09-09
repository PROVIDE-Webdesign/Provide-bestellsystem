# Personalrollen und Standortzugriff

## Status

Angenommen für Arbeitsblock 2.2.

## Entscheidung

Restaurantpersonal erhält genau eine Rolle pro Restaurant. Die zulässigen Rollen sind `owner`,
`manager`, `kitchen` und `driver`. Die bisherige Sammelrolle `staff` wird nicht fortgeführt, weil
sie keine eindeutig prüfbare Berechtigungsgrenze beschreibt.

Owner besitzen restaurantweiten Standortzugriff. Manager, Küchenpersonal und Fahrer erhalten Zugriff
nur über ausdrückliche Einträge in `public.restaurant_membership_locations`. Jede Zuordnung enthält
Restaurant, Benutzer und Standort. Zwei zusammengesetzte Fremdschlüssel stellen sicher, dass sowohl
Mitgliedschaft als auch Standort zum gleichen Restaurant gehören.

## Rollenmodell

| Rolle     | Standortumfang                         | Spätere fachliche Verantwortung                 |
| --------- | -------------------------------------- | ----------------------------------------------- |
| `owner`   | Alle Standorte des eigenen Restaurants | Restaurant, Personal, Konfiguration und Betrieb |
| `manager` | Nur ausdrücklich zugewiesene Standorte | Standortverwaltung und operativer Betrieb       |
| `kitchen` | Nur ausdrücklich zugewiesene Standorte | Bestelleingang, Zubereitung und Küchenstatus    |
| `driver`  | Nur ausdrücklich zugewiesene Standorte | Zugewiesene Lieferungen und Lieferstatus        |

Die Tabelle legt zunächst nur die sichere Daten- und Standortgrenze fest. Die konkreten Aktionen der
Rollen werden in den jeweiligen späteren Fachblöcken zusätzlich serverseitig eingeschränkt.

## Sicherheitsregeln

1. Nicht ausdrücklich gewährter Standortzugriff ist standardmäßig gesperrt.
2. Nur Owner erhalten Zugriff ohne einzelne Standortzuweisung.
3. Restaurant- und Standort-ID werden in jeder Zuweisung gemeinsam geprüft.
4. Browserrollen dürfen Rollen und Zuweisungen lesen, soweit sie die eigene Person betreffen, aber
   nie direkt verändern.
5. Rollen- und Zuweisungsänderungen erfolgen später über autorisierte, auditierte Serverabläufe.
6. Die privilegierte PROVIDE-Administration ist keine Restaurantrolle und wird getrennt modelliert.
7. Auth-Lebenszyklus, Einladungen, Deaktivierung und MFA werden in den folgenden Teilblöcken
   ergänzt.

## Migrationsregel

Falls bereits ein Datensatz mit der alten Rolle `staff` existiert, stoppt die Migration. Die Rolle
muss dann bewusst als `manager`, `kitchen` oder `driver` eingeordnet werden. Eine stille
automatische Umdeutung wäre sicherheitsrelevant und ist deshalb ausgeschlossen.
