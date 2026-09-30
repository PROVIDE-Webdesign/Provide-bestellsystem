# 0028 – Menüauswahl und gemeinsame serverseitige Preisprüfung

Datum: 30.09.2026. Status: implementiert im Entwurf; technische Nutzerabnahme ausstehend.

## Auslöser

Paket 2 benötigt Varianten, Optionsgruppen, deklarierte Produktinformationen und nachvollziehbare
Preise. Die bestehende Speisekarte versioniert Artikel bereits unveränderlich, Bestellungen
speichern Positionen und Online-Zahlungen übernehmen den Bestellbetrag. Getrennte
Preisimplementierungen für Vorschau, Abholung, Lieferung und Onlinezahlung würden diese Garantien
schwächen.

## Entscheidung

Die optionale `menu_version_items.configuration` gehört zum vorhandenen Artikel-/Versionsaggregat.
Das streng validierte Schema enthält Varianten, Optionsgruppen mit Auswahlgrenzen, nichtnegative
Preisaufschläge, Aktivzustände, Allergene, Zusatzstoffe und einen explizit bestätigten Steuersatz in
Basispunkten. IDs sind innerhalb des Aggregats eindeutig. Auswahl-IDs werden ausschließlich im
angegebenen Restaurant, Menü, Artikel und in der wirksamen Version aufgelöst. Ein fremdes Aggregat
liefert keine gültige Auswahl. Die vorhandenen zusammengesetzten Fremdschlüssel und das Einfrieren
veröffentlichter Inhalte gelten für die gesamte Konfiguration.

Ein JSON-Aggregat vermeidet getrennt veröffentlichte Teilzustände und zusätzliche veränderliche
Auswahltabellen. Die Größe ist begrenzt: 20 Varianten, 20 Gruppen, 50 Optionen je Gruppe und
insgesamt 200 Optionen. Eine spätere übergreifende Optionsbibliothek benötigt eine eigene
Entscheidung; sie wird hier nicht vorweggenommen. Draftkopien übernehmen die Konfiguration, beginnen
aber mit einer neuen Bearbeitungsrevision.

Der interne Konfigurationsbefehl verlangt aktive Owner-/Manager-Mitgliedschaft und ausdrücklich
`aal2`, sperrt Draft und Artikel, vergleicht die erwartete Revision und schreibt einen PII-freien
Outbox-Nachweis. Die spätere Dashboard-API muss Identität und AAL aus einem verifizierten Token
ableiten. Browser erhalten keine Schreib- oder privaten Funktionsrechte. Bestehende
vertrauenswürdige Service-Rollenrechte für Draftinhalte werden nicht erweitert.

`private.price_menu_lines` ist die gemeinsame Preisquelle. Requests enthalten Artikel, Menge und
Auswahl-IDs; übergebene Preise oder weitere Felder werden abgewiesen. Genau eine aktive Variante ist
erforderlich, wenn Varianten existieren. Optionen müssen aktiv sein und die Gruppenminima/-maxima
erfüllen. Identische Konfigurationen werden nicht doppelt eingereicht; verschiedene Konfigurationen
desselben Artikels sind getrennte Positionen. IDs werden normalisiert und Optionsreihenfolgen
kanonisiert. Legacy-Requests behalten ihre bisherige Zwei-Feld-Form und Wiederholbarkeit.

Der Bruttopreis besteht aus Basis, Variantenaufschlag und Optionsaufschlägen, multipliziert mit der
Menge. Integergrenzen verhindern Überläufe. Der enthaltene Steuerbetrag wird mit PostgreSQL
`numeric` einmal pro Position gerundet; der öffentliche Vertragsparser prüft dieselbe Rechnung mit
`BigInt`. Ein konfigurierter Artikel besitzt einen deklarierten Satz für die vollständige Auswahl.
Unterschiedlich besteuerte Extras und Steuern auf Liefergebühren benötigen einen gesonderten
fachlichen Ausbau.

Bestellpositionen erhalten einen unveränderlichen `selection_snapshot` mit Auswahlbezeichnungen,
Aufschlägen, Allergenen, Zusatzstoffen, Steuersatz und Steuerbetrag. Bestehende Zeilen und Menüs mit
`NULL` werden als unbekannte historische Deklaration behandelt; es werden keine Daten erfunden. Die
Funktion des Steuersatzes ist ein deklarierter technischer Vertrag, keine automatische
steuerrechtliche Klassifikation. Die Fixture mit 700 Basispunkten ist ausschließlich synthetisch.

Finale Einreichung, Veröffentlichung, Rollback und Artikelverfügbarkeit verwenden dieselbe
Menüsperre pro Restaurant/Standort/Menü. Nach Wartezeit wird der Menübewertungszeitpunkt um die
verstrichene Serverzeit fortgeschrieben. Eine während der Sperre wirksam gewordene Veröffentlichung
kann so nicht mit dem alten Statementzeitpunkt übergangen werden. Identische Bestellwiederholungen
werden weiterhin vor der Prüfung der aktuellen Menüversion aus dem unveränderlichen Snapshot
bedient.

## Warenkorbvorschau und Grenzen

Die öffentliche API-Route `POST /v1/storefront/{restaurant}/{location}/cart-quote` ist
ausschließlich lesend und benötigt `CART_QUOTE_ENABLED=true`, Hyperdrive mit deaktiviertem Cache
sowie die bestehenden öffentlichen Restaurant-/Standort-Gates. Sie nimmt keine Kontakt-, Adress-
oder Browserpreisdaten entgegen. Lieferung benötigt lediglich eine PLZ. Die Antwort benennt
`current`, `changed` oder `unavailable`, die aktuelle Menüversion und serverseitige Positionen bzw.
begrenzte Konfliktgründe. Sie erzeugt keine Bestellung, Reservierung, Zahlungsaufträge oder
Provideraufrufe.

Die Vorschau ersetzt die finale Einreichungsprüfung nicht. Oberfläche, Auswahlbedienung,
Gatewayweiterleitung, Warenkorb-Persistenz, Veröffentlichungskonfliktanzeige und der Menüeditor
folgen im nächsten Teilpaket. Die neue Quote ist standardmäßig geschlossen; bestehende
Runtime-Konfiguration wird hier nicht aktiviert. Zeitliche Varianten-/Optionsstopps sind ebenfalls
noch offen.
