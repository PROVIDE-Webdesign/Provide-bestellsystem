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
      <h3>Welche Angaben werden verarbeitet?</h3>
      <p>
        Für die Preis- und Verfügbarkeitsprüfung werden Gerichtsauswahl, Mengen und gewünschter
        Bestellzeitpunkt an das Bestellsystem übertragen. Beim Absenden werden zusätzlich Name,
        Telefonnummer und E-Mail-Adresse für die Testbestellung gespeichert und im geschützten
        Restaurant-Dashboard angezeigt. Bei Lieferung kommen Postleitzahl und Lieferadresse hinzu.
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
      <p className="fine-print">
        Die tatsächlichen Speicher- und Löschfristen der Bestelldaten sind noch nicht abschließend
        bestätigt. Das Ablaufen eines Statuszugangs bedeutet nicht, dass die gespeicherte Bestellung
        bereits gelöscht wurde.
      </p>
    </details>
  );
}
