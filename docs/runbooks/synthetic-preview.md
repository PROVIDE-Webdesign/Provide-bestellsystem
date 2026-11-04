# Synthetische Restaurantvorschau

Diese Einrichtung gilt nur fuer ein isoliertes Preview-Projekt mit erfundenen Daten. Produktives
Onboarding und Go-live bleiben gesperrt und werden nicht als bestanden eingetragen.

Ein DB-Betreiber verifiziert zuerst Projekt-ID und APP_ENV=preview fuer API, Shop und Dashboard.
Versand und Onlinezahlung muessen deaktiviert sein. Kein neues Benutzerrecht wird vergeben.
private.synthetic_test_environment wird ausschliesslich im bestaetigten Preview-Projekt mit dessen
Projektkennung und einer hoechstens sieben Tage gueltigen Frist eingerichtet. Die Migration selbst
erteilt keine Freigabe und enthaelt keine Projekt- oder Restaurant-IDs.

Danach konfiguriert der Betreiber jede synthetische Restaurant-/Standortkombination mit
private.configure_synthetic_test_location(project_ref, restaurant_id, location_id, expires_at,
reason). Restaurant und Standort muessen jeweils einen test- Kurzname und TEST Anzeigename haben.
Suspendierte oder bereits produktiv freigegebene Bereiche werden abgewiesen.

Diese Operation aktiviert nur das operative Profil und befristet Speisekarte, Abholung und neue
Bestellungen. Sie ersetzt keine Speisekarte, Zeiten, Kapazitaeten oder Adresspflege. Lieferungen
bleiben fuer synthetisch registrierte Standorte gesperrt. Onlinezahlungen bleiben standardmaessig
ebenfalls gesperrt. Die gesonderte Migration synthetic_preview_payments ermoeglicht ausschliesslich
eine ausdrueckliche, auditierte Betreiberfreigabe fuer den vorhandenen synthetischen Standort und
seine konkrete Plattform-/Haendlerzuordnung. Die bestehenden Go-live-Funktionen bleiben
unveraendert. Die drei Bestellpruefstellen verwenden einen getrennten Resolver fuer Test- oder
Echtbetrieb. Bestehende echte Bereiche ohne Testregistrierung verwenden weiterhin ausschliesslich
die bisherigen Go-live-Pruefungen.

Konfiguration ist nur dem DB-Betreiber zugaenglich; anon, authenticated und service_role erhalten
keine direkten Schreib- oder Aufrufrechte. Aenderungen der Standortregistrierung werden mit echter
Wartungsherkunft und ohne vorgetaeuschten Benutzer im vorhandenen Audit gespeichert. Befristung und
Suspendierung sperren neue Bestellungen sofort; vorhandene Bestellungen bleiben bearbeitbar.
Freigabe entfernen oder vorzeitig beenden bedeutet expires_at mit passendem created_at setzen oder
den Teststandort suspendieren; vorhandene Daten nicht loeschen. Das Entfernen der Registrierung ist
keine Produktionsfreigabe.

Abnahme: zweimaliger Setup-Durchlauf ohne Shopanpassung, getrennte Kataloge, Preise und Varianten,
Zeitfenster und Kapazitaeten, eine echte geschuetzte Testbestellung pro Restaurant. Gueltige
Menschpruefung bleibt erforderlich. Kein Turnstile-Testschluessel und keine Umgehung.

Vor einem echten Restaurantbetrieb vollstaendige normale Betriebsfreigabe und separate Abnahme.

## Gesonderte Onlinezahlungs-Testfreigabe

Vor Freigabe muessen APP_ENV=preview, Stripe-Testschluessel, aktive Accounts-v2-Kartenfaehigkeit
beider Haendler, Connect-Webhook, Signaturgeheimnis, Zahlungszugangsgeheimnis, Ruecksprung-Ursprung
und uncached Hyperdrive verifiziert sein. Der DB-Betreiber ruft
private.configure_synthetic_test_online_payments(project_ref, restaurant_id, location_id,
expires_at, reason) auf. Die Frist darf weder Standort, Vorschauumgebung noch Haendlerzuordnung
ueberleben und ist auf sieben Tage begrenzt. Eine neue Migration allein aktiviert nichts.
Restaurant- und Standort-Funktionssperren bleiben wirksam. Kontowechsel, Ablauf und Sperre
schliessen neue Zahlungen; vorhandene Zahlungsaufgaben behalten ihren Empfaenger und bleiben
abgleichbar. Produktions-Go-live wird nicht veraendert.

E149: Migrationen und Bereitstellung vorbereitet und lokal geprueft; entfernte Anwendung wegen
ausstehender Werkzeugfreigabe und Stripe-Verifizierung noch nicht erfolgt.
