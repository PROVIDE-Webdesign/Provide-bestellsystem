# Offener Bestelleingang und Hintergrundalarm

Ausgangsstand: Release-Kandidat `b35ec50`. Die gemeinsame Vorschau, ihre Datenbank und die
Veröffentlichung werden von Bestellsystem 15 verwaltet. Dieses Paket betrifft API, Dashboard und
zwei Datenbankmigrationen. Der bestehende Shop mit „Meine Bestellungen“ bleibt beim Vorschautest
Teil des Durchlaufs.

## Änderungen

- Eine manuell vorautorisierte Bestellung erscheint während der Zahlungsfrist im offenen Eingang.
  Wenn das Restaurant die Abbuchung anstößt, endet der Annahmealarm. Der Bestellstatus wechselt nach
  Stripe-Bestätigung auf „Angenommen“. Die konfigurierte Annahmefrist anderer Bestellungen gilt
  weiter.
- Pro Browserinstallation kann ein Standort für Hintergrundalarme aktiviert werden. Rolle, Standort
  und gültige Dashboard-Sitzung werden bei der Anmeldung des Geräts und vor dem Versand geprüft. Die
  Push-Nachricht auf dem Sperrbildschirm enthält weder Bestellnummer noch Gastdaten.
- Der API-Worker kann sofort nach erfolgreichem Checkout oder Zahlungsabgleich senden. Der
  bestehende Minutentakt übernimmt ausstehende Versuche. Abgelaufene oder erledigte Bestellungen
  werden nicht neu versendet. Der Vordergrundton bleibt ein separater Schalter.
- Für iPhone und iPad das Dashboard in Safari zum Home-Bildschirm hinzufügen. Von dort anmelden, im
  gewünschten Standort „Hintergrundalarm aktivieren“ antippen und Mitteilungen erlauben. Lautstärke,
  Stummschaltung und Fokus folgen den Einstellungen des Geräts.

## Gemeinsame Vorschau

1. Beide Migrationen in der Reihenfolge `20261104214247`, `20261104214315` in der Vorschau
   einspielen und die API sowie das Dashboard aus demselben abgestimmten Stand bauen. Der Checkout
   bleibt in der Stripe-Sandbox.
2. Pro Umgebung ein separates VAPID-Schlüsselpaar erzeugen. `ORDER_PUSH_VAPID_PRIVATE_KEY`
   ausschließlich als Secret des API-Workers setzen. `ORDER_PUSH_VAPID_PUBLIC_KEY` und
   `ORDER_PUSH_VAPID_SUBJECT` im API-Worker konfigurieren. Für den Subject eine betreute Adresse im
   Format `mailto:…` verwenden. Der Dashboard-Build benötigt den privaten Schlüssel nicht.
3. `DASHBOARD_ORDER_PUSH_ENABLED=true` in API und Dashboard setzen. Vorhandene Auth-,
   Order-Operations- und Order-Alerts-Schalter sowie die ungecachte Hyperdrive-Verbindung verwenden.
   Die API behält ihren Minutentakt. Prüfen, dass Manifest und Service Worker am Dashboard-Ursprung
   ausgeliefert werden.
4. Bei geschlossenem Dashboard und aktiviertem Hintergrundalarm genau eine neue
   Asian-Kitchen-Bestellung mit der Stripe-Testkarte vorautorisieren. Eingang und Mitteilung müssen
   vor der Abbuchung sichtbar sein. Die Mitteilung öffnet das Dashboard. Die Annahme löst genau eine
   Abbuchung aus und der offene Eingang wird geschlossen. Nach Abschluss im frischen Gast-Tab „Meine
   Bestellungen“ öffnen und den Endstatus derselben Bestellung abgleichen.

Bei einem Rollback zuerst die Push-Schalter beider Worker deaktivieren. Die beiden privaten Tabellen
und die SQL-Korrektur können dabei bestehen bleiben. Eine VAPID-Schlüsselrotation erfordert erneutes
Abonnieren auf den Restaurantgeräten.

## Geprüft

Isolierte Testdatenbank mit 47 Testdateien und 3.211 bestandenen Prüfungen, darunter 31 neue
Prüfungen für Vorautorisierung, Annahme, Fristablauf, Standorttrennung, Wiederholungen und
Zugriffsverlust. API- und Dashboard-Builds, Lint, TypeScript und Unit-Tests. In Chromium wurde dem
echten Service Worker bei geschlossenen Tabs des Dashboard-Ursprungs eine simulierte Nachricht
zugestellt. Die Wiederholung wurde zu einer sichtbaren Mitteilung zusammengefasst. Externe
Push-Zustellung, iPhone-Ton und der gemeinsame Bestelldurchlauf werden auf der abgestimmten Vorschau
abgenommen.
