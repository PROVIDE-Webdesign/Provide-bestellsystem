# Authentifizierung, Sitzungen und MFA-Schutz

## Status

Angenommen für Arbeitsblock 2.4.

## Entscheidung

Supabase Auth ist die einzige Identitäts- und Sitzungsquelle für Restaurantpersonal. PROVIDE stellt
keine eigenen Passwort-, Refresh- oder Sitzungstokens aus. Restaurantrollen und Standortrechte
bleiben ausschließlich in der PROVIDE-Datenbank und werden nicht aus frei veränderbaren
Benutzermetadaten oder dauerhaft im JWT gespeicherten Fachrollen abgeleitet.

Owner und Manager benötigen für jeden fachlichen Restaurantzugriff ein Supabase-Zugriffstoken mit
dem Authenticator Assurance Level `aal2`. Küchenpersonal und Fahrer dürfen mit `aal1` oder `aal2`
innerhalb ihres ausdrücklich zugewiesenen Standortumfangs arbeiten. Ein fehlender `aal`-Claim wird
wie `aal1` behandelt; unbekannte Werte gewähren keinen Zugriff. Aktive Mitgliedschaft,
Restaurantrolle, Standortumfang und Authentifizierungsniveau werden gemeinsam geprüft. Keine dieser
Prüfungen ersetzt eine andere.

Die eigene Mitgliedschaft darf weiterhin in minimalem Umfang gelesen werden, damit eine
privilegierte Person nach der ersten Anmeldung zur MFA-Einrichtung geleitet und eine suspendierte
Person über ihren Zustand informiert werden kann. Restaurant-, Standort- und Zuweisungsdaten bleiben
bis zum erforderlichen Authentifizierungsniveau gesperrt.

## Einladungsannahme

Die serverexklusive Funktion `private.accept_restaurant_invitation` erhält neben Einladungs- und
Benutzer-ID das vom API-Server verifizierte Authentifizierungsniveau. Owner- und Manager-Einladungen
können nur mit `aal2` angenommen werden. Kitchen- und Driver-Einladungen dürfen mit `aal1` oder
`aal2` angenommen werden. Die tatsächlich verwendete Stufe wird als `accepted_at_aal` an der
Einladung dokumentiert.

Der übergebene Wert ist kein Browserparameter. Vor dem Datenbankaufruf muss der API-Server Signatur,
Aussteller, Ablauf, Benutzer-ID und `aal` des Supabase-JWT prüfen. Browserrollen können die
Annahmefunktion weiterhin nicht direkt ausführen.

## Sitzungsgrenze

Das spätere Dashboard verwendet den Supabase-PKCE-Ablauf und eine cookiegestützte SSR-Sitzung.
Geschützte Seiten und API-Aufrufe werden nicht allein aus einem lokal geladenen Sitzungsobjekt
autorisiert. Für jede Anfrage wird das Zugriffstoken verifiziert; fachliche Rechte werden danach
aktuell aus der Datenbank ermittelt. Authentifizierte Antworten dürfen nicht öffentlich oder durch
eine gemeinsame CDN-Antwort zwischengespeichert werden.

Eine Restaurantmitgliedschaft ist vom globalen Supabase-Konto getrennt. Das Suspendieren einer
Mitgliedschaft beendet daher nicht pauschal alle Sitzungen: dieselbe Person kann in einem anderen
Restaurant weiterhin aktiv sein. Die Datenbanksperre wirkt für das betroffene Restaurant sofort.
Eine spätere globale Kontosperre und ein globaler Session-Widerruf gehören zur getrennten
PROVIDE-Administration.

## MFA-Betrieb

1. Für Owner und Manager ist TOTP der erste unterstützte zweite Faktor.
2. Nach der ersten Anmeldung darf eine privilegierte Person vor `aal2` nur den Auth-/MFA-Ablauf und
   den minimalen eigenen Mitgliedschaftsstatus erreichen.
3. MFA-Einrichtung, Challenge, Faktorverwaltung und Wiederherstellung werden über Supabase Auth
   durchgeführt; PROVIDE speichert keine TOTP-Geheimnisse.
4. Das Entfernen des letzten Faktors, Wiederherstellung und Supportfreigaben benötigen vor dem
   Pilotbetrieb einen getrennten, auditierten Administrationsablauf.
5. Livewerte für maximale Sitzungsdauer und Inaktivitätsgrenze werden erst am Preview- und
   Go-live-Gate konfiguriert und niemals als Secret im Repository abgelegt.

## Folgen

- Ein gestohlenes `aal1`-Token gewährt keine Owner- oder Managerrechte.
- `aal2` erweitert weder Mandanten- noch Standortrechte.
- Eine suspendierte Mitgliedschaft bleibt auch mit `aal2` gesperrt.
- Ein Benutzer mit verschiedenen Rollen kann je Restaurant unterschiedliche MFA-Anforderungen haben.
- Die API muss Auth-Claims verifizieren, bevor sie privilegierte Datenbankfunktionen aufruft.
- Änderungen der Supabase-Projektkonfiguration bleiben ein gesondertes externes Freigabe-Gate.

## Nicht Bestandteil

- Login-, Logout-, Passwort- und MFA-Oberflächen
- Produktive Supabase-Auth-Konfiguration oder echte Schlüssel
- E-Mail-Templates und SMTP
- Kundenkonten; der MVP-Checkout bleibt ein Gast-Checkout
- PROVIDE-interne Administratorrollen und globale Kontosperren
- Produktiver Dashboard-Zugriff
