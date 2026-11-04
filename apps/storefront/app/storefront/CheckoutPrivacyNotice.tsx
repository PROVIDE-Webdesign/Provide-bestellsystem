export function CheckoutPrivacyNotice({ noticeVersion }: { readonly noticeVersion: string }) {
  return (
    <details className="checkout-privacy" id="checkout-privacy-notice">
      <summary>Datenschutzhinweis zum Test-Checkout</summary>
      <p id="checkout-privacy-context" className="fine-print">
        Technische Hinweise zum internen Testbetrieb. Die vollständige Datenschutzfreigabe steht
        noch aus. Konfigurierte Hinweiskennung: <code>{noticeVersion}</code>.
      </p>
      <p>
        <strong>Bitte nur erfundene Testdaten verwenden.</strong> Dies ist keine echte
        Restaurantbestellung.
      </p>
      <h3>Welche Angaben sind Pflicht?</h3>
      <p>
        Für die Abholung benötigen wir deinen Namen und mindestens eine Kontaktmöglichkeit: E-Mail
        oder Telefon mit Landesvorwahl. Du kannst auch beides angeben. Bei einer Lieferung ist eine
        Telefonnummer erforderlich; E-Mail ist optional.
      </p>
      <h3>Welche Angaben werden verarbeitet?</h3>
      <p>
        Für die Preis- und Verfügbarkeitsprüfung werden Gerichtsauswahl, Mengen und gewünschter
        Bestellzeitpunkt an das Bestellsystem übertragen. Beim Absenden werden zusätzlich Name und
        die angegebenen Kontaktmöglichkeiten (Telefon oder E-Mail, auf Wunsch beides) für die
        Testbestellung gespeichert. Der Kontaktname wird im geschützten Restaurant-Dashboard
        angezeigt. Bei Lieferung kommen Postleitzahl und Lieferadresse hinzu.
      </p>
      <h3>Browser und Sicherheitsprüfung</h3>
      <p>
        Der Warenkorb kann bis zu 24 Stunden lokal im Browser gespeichert werden. Der geschützte
        Checkout verwendet ein sicheres, für JavaScript nicht lesbares Sitzungscookie. Für die
        Wiederaufnahme eines Bestellversuchs und den Bestellstatus bleiben zeitlich begrenzte
        Zugriffsdaten im Browserspeicher. In diesen Warenkorb- und Wiederaufnahmespeichern werden
        keine Namen, Telefonnummern oder E-Mail-Adressen abgelegt.
      </p>
      <p>
        Hosting und Schutz laufen über Cloudflare; Testbestellungen werden in der Supabase-Datenbank
        verarbeitet. Beim Starten der Sicherheitsprüfung wird Cloudflare Turnstile geladen. Dabei
        werden technische Verbindungsdaten an Cloudflare übertragen.
      </p>
      <h3>Wie lange bleiben Test-Kontaktdaten gespeichert?</h3>
      <p>
        Für Name und angegebene Kontaktmöglichkeiten haben wir eine Frist von 14 Tagen ab Eingang
        der Testbestellung festgelegt. Die vorgesehene automatische Bereinigung entfernt diese
        Angaben nach Ablauf der Frist, sobald die Bestellung abgeschlossen, abgelehnt oder storniert
        ist. Offene Bestellungen bleiben bis zur Klärung von der Bereinigung ausgenommen.
      </p>
      <p>
        Bestellnummer, Artikel, Preise und Bestellstatus bleiben für die Prüfung des Testbetriebs
        gespeichert. Das Ablaufen des Zugangs zum Bestellstatus löst keine Löschung der Bestellung
        aus.
      </p>
      <p className="fine-print">
        Die 14-Tage-Frist gilt für die Kontaktdaten der Testbestellungen. Die Fristen für die
        übrigen Bestelldaten, technische Protokolle und Sicherungskopien sind noch zu klären. Für
        den späteren Betrieb mit echten Restaurants werden die Aufbewahrungsregeln gesondert
        festgelegt.
      </p>
    </details>
  );
}
