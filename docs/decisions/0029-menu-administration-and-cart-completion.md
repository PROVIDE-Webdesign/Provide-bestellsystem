# 0029: Menüpflege und angeschlossener Warenkorb

Datum: 01.10.2026. Aufbau auf ADR0028 und Entwurfs-PR #11.

## Entscheidung

Dashboardpflege und Kundenauswahl verwenden denselben versionierten Menüvertrag. Der neue
Menüendpunkt akzeptiert ausschließlich verifizierte Dashboardidentitäten mit AAL2 und bestehender
Standortberechtigung. Owner und zugewiesene Manager dürfen Entwürfe bearbeiten, veröffentlichen,
zurückrollen und Verfügbarkeitsstopps setzen. Direkte Tabellenrechte bleiben gesperrt.

Entwürfe besitzen eine optimistische Bearbeitungsrevision. Veröffentlichung und Preisprüfung nutzen
die vorhandene Veröffentlichungssperre. Konfigurationen verlangen ausdrücklich bestätigte fachliche
Deklarationen; unbekannte Altdaten werden nicht ergänzt. Veröffentlichte Versionen bleiben
unveränderlich. Zeitpunkte werden in der Standortzeitzone eingegeben und als UTC-Instant
gespeichert. Die öffentliche Projektion verwendet das vertraglich vereinbarte Millisekundenformat,
auch bei PostgreSQL-Zeitstempeln mit höherer Genauigkeit.

Artikel, Varianten und Optionen erhalten append-only Stopps mit Akteur, Grund und optionalem Ende.
Die neueste Entscheidung gilt; ein abgelaufener neuer Stopp reaktiviert keinen älteren Stopp. Die
endgültige serverseitige Preisprüfung berücksichtigt diese Regeln unabhängig von der Oberfläche.

Kundenpositionen unterscheiden Artikel und normalisierte Auswahl-IDs. Vorschaupreise stammen aus
veröffentlichten Daten; vor Abgabe ist eine aktuelle Serverquote und bewusste Bestätigung
erforderlich. Änderungen an Auswahl, Menge, Erfüllungsart, Termin oder Lieferpostleitzahl entwerten
die Bestätigung. Die finale Bestellung prüft weiterhin selbst. Konflikte erhalten den Warenkorb und
verlangen Neuprüfung.

Der lokale Warenkorb enthält ausschließlich begrenzte Positionsdaten, ist an Restaurant und Standort
gebunden und läuft 24 Stunden nach Anlage ab. Kontaktdaten, Tokens und Freigaben werden nicht
gespeichert. Nach Wiederherstellung ist erneut eine Serverprüfung nötig. Küchenansichten erhalten
die unveränderlichen Varianten-/Extra-Snapshots der Bestellung statt aktueller Menütexte.

## Grenzen

Deklarierte Produktsteuern sind vorhanden; vollständige Bestellkopf-Steueraufteilung und die
fachliche Steuerbehandlung der Liefergebühr bleiben M7. Pilotdaten und Importparität O6 sind offen.
Diese Entscheidung aktiviert keine Runtime-Flags und beinhaltet weder Merge noch Deployment oder
produktive Freigabe.
