# Historie und regelmäßiger Gastdatenablauf

Technischer Entwurf; keine Aktivierung dieses Runbooks. Nur eindeutig zugeordnetes Staging nach
separater Freigabe verwenden. F01–F03 und produktive Daten bleiben unberührt.

1. DASHBOARD_HISTORY_ENABLED muss in API und Dashboard ausdrücklich true werden; Auth, verifizierter
   Issuer/Audience, AAL2 und cache-deaktiviertes Hyperdrive sind zusätzlich nötig. Küche/Fahrer
   erhalten keinen Historiendatenzugriff. Geschichte suspendierter Betriebe bleibt über berechtigte
   Mitgliedschaften lesbar; keine Umgehung einer Mitgliedschaftssuspendierung.
2. Der Kalender folgt der Standortzeitzone. Standard aktuelle Woche ab Montag; alte Zeiträume frei
   wählen, höchstens 93 Tage je Abfrage. Status/Art/Nummer/Name begrenzen alle Kennzahlen. Keine
   Treffer bedeutet leere Gruppen. Zahlungen/Erstattungen sind heutige Zustände der Eingangskohorte;
   keine Cashflow-Auswertung nach Providerereignisdatum. Vor-Ort-Zahlung wird nicht bestätigt. Bei
   fehlerhaftem/überlangem Abruf keine vorherigen Werte als aktuell anzeigen.
3. GUEST_RETENTION_PURGE_ENABLED separat freigeben, rechtlich bestätigte Fristen zuerst prüfen. Der
   vorhandene Minuten-Cron versucht die private Hülle; tatsächlicher Lauf höchstens alle fünf
   Minuten mit 500 terminalen, abgelaufenen Kontakten. Keine zukünftigen Cutoffs aus
   Browserbefehlen. Offene Aufträge nicht löschen. Nur PII wird entfernt, Bestell-/Preis-/Status-
   Snapshots bleiben. Abgelaufene Namen sind bereits vorher in Historie nicht recherchierbar.
4. Erfolgsnachweis private.guest_purge_runs enthält Zeitpunkt, tatsächlichen Serverstichtag und
   Anzahl; globaler Count darf nicht im Restaurantdashboard erscheinen. Eine autorisierte
   Betriebsprüfung muss deployed Cron/Flag, aktuelle Laufzeitpunkte und Rückstandsabbau tatsächlich
   belegen; CI-Scheduleraufruf ist nur technischer Anschlussnachweis.
5. Bei guest_retention_purge_failed keine Rohfehler/PII protokollieren. Flags/Hyperdrive/DB prüfen,
   keine Datumswerte vorschieben oder direkten Massendelete ausführen. Fehler rollt Lauf und
   PII-Purge gemeinsam zurück. Nächster Cron wiederholt sicher; ein Lauf innerhalb der fünf Minuten
   oder ein konkurrierender Lockinhaber ist keine Störung.
6. Bei Deaktivierung bleiben bereits purged Kontakte purged. Kein PII-Restore aus Backups ohne
   gesonderten Datenschutz-/Wiederherstellungsprozess. Diese Funktion ist kein Support-Replay,
   zentraler Alarmadapter, rechtlicher Aufbewahrungsbeschluss oder Produktionsfreigabe.
