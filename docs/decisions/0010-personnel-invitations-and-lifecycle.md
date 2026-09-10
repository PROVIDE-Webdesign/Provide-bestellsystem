# Personaleinladungen und Mitgliedschaftslebenszyklus

## Status

Angenommen für Arbeitsblock 2.3.

## Entscheidung

Restaurantpersonal wird über Supabase Auth eingeladen. Der Anbieter erzeugt und prüft den
Einladungslink. PROVIDE speichert deshalb keine Einladungsgeheimnisse, sondern ausschließlich die
fachlich erforderlichen Metadaten in `public.restaurant_invitations`: Restaurant, normalisierte
E-Mail-Adresse, Supabase-Benutzer, Zielrolle, Ersteller, Ablaufzeit und Lebenszyklusstatus.

Eine Einladung beginnt immer als `pending` und endet genau einmal als `accepted` oder `revoked`. Ein
Ablauf wird über `expires_at` geprüft und nicht als nachträglich zu synchronisierender Status
gespeichert. Abgeschlossene Einladungen sind unveränderlich. Pro Restaurant darf für dieselbe
E-Mail-Adresse beziehungsweise denselben Supabase-Benutzer höchstens eine offene Einladung
existieren.

Owner dürfen alle vier Restaurantrollen einladen. Manager dürfen ausschließlich `kitchen` und
`driver` einladen. Nicht verantwortliche oder suspendierte Rollen dürfen keine Einladungen
verwalten. Für Nicht-Owner wird der Standortumfang vor der Annahme in
`public.restaurant_invitation_locations` festgelegt. Manager dürfen nur Standorte vergeben, auf die
sie selbst aktuell Zugriff besitzen.

Die serverexklusive Funktion `private.accept_restaurant_invitation` prüft Zielbenutzer, Status,
Ablauf, Erstellerrolle und Standortumfang. Danach erstellt sie Mitgliedschaft und Standortrechte und
schließt die Einladung in derselben Datenbanktransaktion ab. Tabellenzugriffe und diese Funktion
bleiben den Browserrollen entzogen.

Restaurantmitgliedschaften erhalten den Zustand `active` oder `suspended`. Eine Suspendierung löscht
weder Mitgliedschaft noch Standortzuweisungen, nimmt die Person aber unmittelbar aus allen
Mandanten-, Rollen- und Standortprüfungen. Eine spätere Reaktivierung stellt den zuvor vergebenen
Standortumfang wieder her.

## Supabase-Auth-Grenze

1. Der API-Server ruft Supabase Auth mit einem ausschließlich serverseitigen Admin-Schlüssel auf.
2. Die zurückgegebene Auth-Benutzer-ID wird in der fachlichen Einladung referenziert.
3. PROVIDE speichert weder den Einladungslink noch dessen Token.
4. Nach erfolgreicher Provider-Anmeldung darf nur der API-Server die atomare Annahmefunktion
   ausführen.
5. Kundenkonten gehören nicht zu diesem Arbeitsblock; der MVP-Checkout bleibt ein Gast-Checkout.

## Folgen

- Ein verlorener Datenbankauszug enthält keinen wiederverwendbaren Einladungstoken.
- Restaurant- und Standortgrenzen gelten bereits vor der ersten Dashboardsitzung einer Person.
- Abgelaufene oder widerrufene Einladungen können keine Mitgliedschaft erzeugen.
- Die sofortige Datenzugriffssperre ist unabhängig von der verbleibenden Lebensdauer einer
  Supabase-Session.
- Das aktive Beenden vorhandener Supabase-Sessions wird in der späteren Auth-/API-Integration
  ergänzt; bis dahin blockiert die Datenbank jede fachliche Abfrage einer suspendierten Person.
- MFA wird für privilegierte Rollen separat in Arbeitsblock 2.4 anhand des Supabase-Claims `aal2`
  durchgesetzt.

## Nicht Bestandteil

- E-Mail-Template und produktiver SMTP-Versand
- Login-, Einladungs- und Passwortoberflächen
- MFA-Einrichtung und MFA-Challenge
- PROVIDE-interne Administratorrollen
- Restaurantfreigabe und Go-live-Status
