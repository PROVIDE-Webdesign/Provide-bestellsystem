# Versionierter Speisekarten- und Produktkatalog

## Status

Angenommen für Arbeitsblock 2.6.

## Entscheidung

Speisekarten werden als stabile Identität mit getrennten Versionen modelliert. `menus` und
`menu_items` liefern langfristige IDs. `menu_version_sections` und `menu_version_items` bilden den
vollständigen, kundensichtbaren Inhalt einer Version ab. Preise werden als ganzzahliger Betrag in
der kleinsten Währungseinheit gespeichert; die ISO-Währung wird einmal an der Version festgehalten.

Nur Entwürfe dürfen geändert werden. Eine Veröffentlichung friert Inhalt, Währung und Preise der
Version dauerhaft ein. Korrekturen und geplante Preiswechsel entstehen als neue Versionen. Dadurch
kann eine spätere Bestellung sowohl `menu_version_id` als auch ihren Preis-Snapshot speichern und
bleibt unabhängig von späteren Katalogänderungen nachvollziehbar.

## Veröffentlichung und Rollback

`menu_publications` ist eine unveränderliche Zeitleiste je Restaurant, Standort und Speisekarte.
Jeder Eintrag benennt eine bereits veröffentlichte Version und einen Wirksamkeitszeitpunkt. Der
zeitlich letzte wirksame Eintrag entscheidet, welche Version aufgelöst wird. Geplante Preise werden
daher durch eine zukünftige Veröffentlichung aktiviert; ein Rollback fügt einen neuen Eintrag für
eine frühere unveränderte Version hinzu und überschreibt keine Historie.

Die interne Auflösung bleibt fail-closed. Sie liefert nur dann eine Version, wenn Restaurant und
Standort die Go-live-Prüfung weiterhin erfüllen, `catalog.public_menu` für das Restaurant aktiviert
ist und eine wirksame Veröffentlichung existiert. Eine öffentliche Speisekarten-API ist nicht Teil
dieses Arbeitsblocks.

## Standortverfügbarkeit

Kurzfristige Betriebszustände eines Artikels werden nicht in einer veröffentlichten Version
verändert. `menu_item_location_availability` hält stattdessen je Standort den aktuellen Zustand
`available`, `sold_out` oder `unavailable`. Jede tatsächliche Änderung erzeugt einen
unveränderlichen Eintrag in `menu_item_availability_transitions`.

## Sicherheit und Nachvollziehbarkeit

1. Alle fachlichen Fremdschlüssel führen `restaurant_id` mit und verhindern Kombinationen über
   Mandantengrenzen hinweg.
2. Owner und Manager benötigen eine aktive Mitgliedschaft und `aal2`; Manager bleiben auf ihre
   zugewiesenen Standorte beschränkt.
3. Browserrollen erhalten nur RLS-gefilterte Lesezugriffe und keine direkten Schreibrechte.
4. Veröffentlichungen, Rollbacks und Verfügbarkeitswechsel laufen über serverseitige Funktionen.
5. Veröffentlichungs- und Verfügbarkeitsverläufe sind append-only.
6. Jede erfolgreiche operative Änderung erzeugt in derselben Transaktion ein Outbox-Ereignis.

Der Server muss Benutzer-ID und Authentifizierungsniveau aus einem verifizierten Supabase-Token
ableiten. Frei übermittelte Browserparameter gelten nicht als Nachweis.

## Folgen

- Veröffentlichte Namen, Beschreibungen und Preise sind reproduzierbar und revisionssicher.
- Standorte können dasselbe Katalogfundament nutzen und Artikel unabhängig als ausverkauft
  markieren.
- Zeitgesteuerte Preiswechsel und Rücknahmen benötigen keine Mutation historischer Datensätze.
- Künftige Bestellungen müssen die angewandte Version und ihre Geldwerte als Snapshot referenzieren.

## Nicht Bestandteil

- Öffentliche Speisekarten-, Warenkorb-, Bestell- oder Zahlungsendpunkte
- Dashboard- oder Storefront-Oberflächen
- Rechtlich verbindliche Allergen- und Zusatzstoffangaben
- Bestandsmengen, Rezepturen oder automatische Warenwirtschaft
- Produktive Feature-Aktivierung, echte Restaurantdaten oder Produktionskonfiguration
