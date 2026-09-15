# 0019: Öffentliche Storefront-Lesegrenze

## Status

Fachlicher Umfang von Arbeitsblock 3.2 am 14. September 2026 ausdrücklich freigegeben.
Implementierung lokal; Abschluss erst nach den GitHub-Gates `check` und `database`.

## Entscheidung

Die erste kundennahe Funktion verbindet veröffentlichte Speisekarten und eine unverbindliche
Bestellbarkeitsprüfung mit der Storefront. Der Browser verwendet ausschließlich öffentliche
GET-Anfragen. Die Storefront vermittelt diese an die konfigurierte API; sie besitzt keinen
Datenbankzugang und leitet keine Cookies oder Authorization-Header weiter.

`private.read_storefront_catalog(text,text)` löst Restaurant und Standort gemeinsam anhand ihrer
Slugs auf. Sie verwendet den bestehenden Go-live-, Feature- und Veröffentlichungsresolver mit
serverseitiger Auswertungszeit. Sie liefert alle am Standort aktuell wirksamen Speisekarten in
stabiler Reihenfolge. Entwürfe, zukünftige Veröffentlichungen und inaktive Artikel fehlen.
`available`, `sold_out` und `unavailable` folgen den bestehenden Standortregeln; ein fehlender
Artikel-Override bedeutet wie bei der Bestelleinreichung `available`.

Die neue Funktion gibt Restaurantname/-Slug, Standortname/-Slug, Zeitzone, Standortadresse,
Speisekarten-/Versions-/Artikel-IDs, Kategorien, Namen, Beschreibungen, Währungen, Centpreise und
Artikelstatus aus. Personen-, Zahlungs-, Mitarbeiter- und Auditdaten werden nicht projiziert.
Zentrale Laufzeitparser rekonstruieren diese Allowlist nochmals vor der HTTP-Ausgabe.

`private.read_storefront_availability(text,text,text,timestamptz,integer)` verwendet dieselbe
Sichtbarkeitsgrenze und den bestehenden Bestellbarkeitsresolver. Die öffentliche Antwort enthält nur
Status, Erfüllungsart, Wunschzeitpunkt, Artikelanzahl und Auswertungszeitpunkt. Gründe,
Kapazitätszähler, Zeitplan-IDs und interne Slots bleiben intern. Der Aufruf reserviert nichts und
prüft noch keine konkrete Artikelauswahl.

## Sicherheitsgrenzen

1. Beide SQL-Funktionen sind nur für `service_role` ausführbar. Es gibt keine zusätzlichen Browser-
   oder Tabellenrechte. `security definer` verwendet einen leeren `search_path`.
2. Die API verwendet feste, parametrisierte SQL-Aufrufe in einer nur lesenden Transaktion mit
   `SET LOCAL ROLE service_role` und einem fünfsekündigen Statement-Limit. Eine Verbindung wird nach
   jeder Anfrage geschlossen; Fehler geben keine internen Details aus.
3. Slugs, RFC3339-Zeitpunkte mit explizitem Offset, Bestellart und ganzzahlige Mengen von 1 bis 1000
   werden vor dem Datenbankaufruf geprüft. Unbekannte und doppelte Query-Parameter sind unzulässig.
   Der Client kann keinen Auswertungszeitpunkt, Preis oder internen Mandantenschlüssel vorgeben.
4. Unbekannte und nicht öffentlich freigegebene Bereiche erhalten einheitlich `404 not_found`. Eine
   reine Bestellpause lässt die unabhängig freigegebene Speisekarte sichtbar und liefert
   `unavailable`; eine Pause der Go-live-Freigabe verbirgt den Bereich vollständig.
5. Antworten verwenden `no-store`. Der Storefront-CDN-Cache ist deaktiviert. Hyperdrive muss ohne
   Query-Caching betrieben werden; erst nach Prüfung darf `HYPERDRIVE_CACHE_DISABLED=true` gesetzt
   werden. Diese Variable dokumentiert die geprüfte Konfiguration, sie ändert Hyperdrive nicht.
6. Der öffentliche API-Payload ist auf 1 MiB begrenzt. Eine Überschreitung liefert einen Fehler,
   keine unbemerkt abgeschnittene Speisekarte. Die Gateway-Antwort wird ebenfalls begrenzt gelesen.
7. Die UI rechnet Standort-Wanduhrzeiten in UTC um. Nicht existierende oder doppelte Uhrzeiten bei
   Sommerzeitwechseln werden zurückgewiesen. Änderungen der Auswahl verwerfen alte Ergebnisse und
   laufende Anfragen. Eine Verfügbarkeitsantwort ist ausdrücklich keine Reservierung.

## Betrieb und Folgen

Neue Endpunkte benötigen keine neuen externen Dienste. Die bestehenden Hyperdrive- und Worker-
Konfigurationen bleiben Platzhalter; es erfolgt kein Rollout. Die PostgreSQL-Verbindungsrolle muss
`SET ROLE service_role` ausführen dürfen. Ihr tatsächlicher Rechteumfang und deaktiviertes
Hyperdrive-Caching werden vor einer Vorschau geprüft.

Die bestehende Asian-Kitchen-Demo bleibt ein getrenntes Projekt. Synthetische Fixtures liegen im
Bestellsystem und werden ausschließlich in einer wegwerfbaren lokalen/CI-Datenbank geladen.

Der Cache-Betriebsentscheid folgt der
[Hyperdrive-Dokumentation](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/):
Zugriffs- und andere sofort wirksame Zustände benötigen eine Konfiguration ohne Query-Caching.

## Abgrenzung

Warenkorb, Checkout, Bestellübermittlung, Gastdaten, Personal-Authentifizierung, Dashboard,
Liefergebiets-/Adressprüfung, Zahlungen und tatsächliche Bereitstellungen sind spätere Freigaben.
