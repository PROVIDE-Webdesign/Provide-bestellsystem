# Transaktionale Outbox

## Status

Angenommen für Arbeitsblock 1.4.3.

## Entscheidung

Integrationen werden nicht direkt während einer fachlichen Datenbanktransaktion aufgerufen.
Stattdessen schreibt der serverseitige Dienst ein versioniertes Ereignis in `public.outbox_events`.
Die fachliche Änderung und das Ereignis können dadurch später in derselben Transaktion gespeichert
werden. Ein getrennt laufender Worker verarbeitet fällige Ereignisse.

Jedes Ereignis gehört verbindlich zu einem Restaurant und besitzt einen mandantenbezogen eindeutigen
Idempotenzschlüssel. Das verhindert, dass derselbe fachliche Vorgang innerhalb eines Mandanten
versehentlich mehrfach in die Outbox geschrieben wird. Die Auslieferung bleibt grundsätzlich
mindestens einmal; jeder spätere Empfänger muss Ereignisse deshalb ebenfalls idempotent behandeln.

## Zustände

- `pending`: bereit für den ersten Verarbeitungsversuch
- `processing`: von einem Worker übernommen
- `retry`: nach einem vorübergehenden Fehler erneut einzuplanen
- `published`: erfolgreich an den zuständigen Adapter übergeben
- `dead_letter`: nach nicht automatisch behebbaren Fehlern manuell zu prüfen

## Sicherheitsregeln

1. Browserrollen erhalten keinerlei Rechte auf Outbox-Ereignisse.
2. Row Level Security ist aktiviert und erzwungen; es existieren bewusst keine Browser-Policies.
3. Nur die serverseitige Service-Rolle darf Ereignisse lesen, anlegen und ihren Zustand ändern.
4. Direktes Löschen bleibt auch für die Service-Rolle zunächst gesperrt; eine spätere
   Aufbewahrungsregel erhält dafür einen kontrollierten Ablauf.
5. Nutzdaten dürfen keine Zugangsdaten oder unnötigen personenbezogenen Daten enthalten.
6. Ereignistyp und Ereignisversion bilden gemeinsam den stabilen Vertrag für spätere Adapter.

## Folgen

Ausfälle externer Anbieter blockieren später keine bereits bestätigte Bestellung. Die konkrete
Worker-Logik, Sperrfreigabe, Wiederholungsstrategie und Anbindung externer Adapter werden in einem
späteren Arbeitsblock ergänzt.
