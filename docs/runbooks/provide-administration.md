# PROVIDE-Administration: Prüfung und Betriebsvorbereitung

Entwurfsstand A2/O2. Noch keine Betriebsfreigabe. ADR0035 beschreibt den
Rechte-/Transaktionsschnitt.

1. Neue Migration ausschließlich in isolierter Prüfung anwenden. Es wird kein echter Nutzer
   berechtigt. Zusätzliche Pflichtpunkte sperren vorhandene Freigaben bis zur erneuten Prüfung.
2. Für eine ausdrücklich autorisierte spätere Bereitstellung muss ein DB-Betreiber eine bestätigte
   Auth-User-ID in `private.provide_admin_grants` eintragen. Null/Null bedeutet global, Mandant/Null
   mandantenweit, Mandant/Standort nur diesen Standort. Keine Restaurantmitgliedschaft als Ersatz
   verwenden. Erst Rolle/Scope verifizieren; Grant-Vergabe wird selbst auditiert.
3. Auth und Administration in einer isolierten Umgebung können danach gezielt eingeschaltet werden.
   Hyperdrive-Cache muss deaktiviert, JWT-Issuer/Audience müssen korrekt sein. Der separate
   Live-Schalter bleibt aus. `/provide` verwendet dieselbe sichere Sitzung und fordert MFA an.
4. Mandanten/Standorte entstehen im Setup ohne automatische Owner-Zuordnung. Im Restaurantbereich
   kann ein global berechtigter PROVIDE-Administrator über **Ersten Inhaber zuordnen** ein bereits
   registriertes Konto mit bestätigter E-Mail und verifizierter MFA zuweisen. Benutzer-ID und
   Restaurant-Kurzname bewusst bestätigen. Das Restaurant muss im Setup und vollständig ohne
   Mitgliedschaften sein; die Aktion ersetzt keine Einladung, Kontoanlage oder spätere
   Personalverwaltung. Gesperrte Konten und wiederholte Erstzuordnungen sind ausgeschlossen. Gleiche
   Anfrage-IDs sind idempotent, die Zuordnung wird im Verwaltungs- und Personal-Audit geführt. Der
   Inhaber erhält keine PROVIDE-Rechte und keine automatische Bestellfreigabe.

   Im Standortbereich **Standortadresse pflegen** wählen und Straße/Hausnummer, optionalen Zusatz,
   Postleitzahl, Stadt und zweistelligen Ländercode erfassen. Der bestehende Standort-Grant gilt;
   die Restaurantzuordnung ist unveränderlich. Eine spätere Adressänderung öffnet die
   Standortprüfungen erneut und sperrt neue Bestellungen bis zur bewussten erneuten Freigabe.

5. Nachweise strukturiert referenzieren; keine Geheimnisse, Gastdaten oder freie E-Mail-Adressen in
   Grund/Referenz. Pflichtprüfungen können Nichtanwendbarkeit als belegten fachlichen Fall
   dokumentieren. F01–F03 liefern derzeit keine echte Deklarations-/Import-/Geräteabnahme.
6. Konkurrierender Stand: 409 blendet alte Daten aus. Neu laden, Revision/Audit prüfen und bewusste
   neue Änderung senden. Bei unklarer 503/Timeout-Antwort nur dieselbe Anfrage-ID wiederholen oder
   zuerst Audit laden. Replay ist nach Rechteentzug weiterhin verboten.
7. Befristete Features vor Ablauf prüfen. Mandantensperre gilt auch bei Standortfreigabe; das
   Entfernen einer Standortüberschreibung erbt die aktuelle Mandantenregel. Unbekannt bleibt aus.
8. Kritische Nachweisgrundlage ändern bzw. Prüfpunkt erneut öffnen sperrt neue Bestellfreigabe.
   Historische Aufträge bleiben erhalten. Suspendieren sperrt neue Aufnahme, bestehende
   Betriebs-/Historienrechte richten sich weiterhin nach dem getrennten Restaurantkontext.

Abschlussnachweis: pnpm check, alle pgTAP-Dateien, Security Advisors, echter HTTP-Parallelitäts- und
Rechteentzugstest, bestehende private Realtime-Integration, drei Browser bei 390/1440 px samt
visuell kontrollierten Artefakten. Lokale Integrations-Skips sind kein Nachweis. Keine Aktivierung
allein aufgrund grüner Tests; kein Merge/Ready/Deployment in diesem Auftrag.
