# Dashboard-Authentifizierung und sicherer Betriebszugang

## Status

Angenommen für Arbeitsblock 3.5.

## Entscheidung

Das Restaurant-Dashboard verwendet ausschließlich Supabase Auth. Der Browser erhält keine eigene
PROVIDE-Rolle und übermittelt keine Benutzer-ID oder Authentifizierungsstufe als Fachparameter.
Supabase verwaltet die PKCE-fähige, cookiegestützte Sitzung. Das Dashboard validiert die Sitzung
serverseitig und leitet nur das Zugriffstoken an die feste Worker-API weiter. Die Worker-API prüft
Signatur, Aussteller, Publikum, Ablauf, Subjekt, Auth-Rolle und Assurance-Level erneut gegen die
Supabase-JWKS.

Nach erfolgreicher Tokenprüfung liest ausschließlich die Service-Rolle die aktuelle
Restaurantmitgliedschaft. Die SQL-Projektion gibt für suspendierte Mitgliedschaften und für
Owner/Manager vor `aal2` nur den minimalen Routingzustand zurück. Restaurant- und Standortprofile
werden erst bei aktivem, rollen- und MFA-berechtigtem Zugriff ausgegeben.

## MFA

1. Owner und Manager benötigen `aal2`.
2. Kitchen und Driver dürfen mit `aal1` oder `aal2` eintreten.
3. Ein fehlender `aal`-Claim wird als `aal1` behandelt; unbekannte Werte werden abgewiesen.
4. TOTP-Einrichtung und Challenge laufen über Supabase Auth. PROVIDE speichert weder TOTP-Secret
   noch QR-Code oder Einmalcode.
5. Wiederherstellung und Entfernen des letzten Faktors bleiben einem späteren auditierten Ablauf
   vorbehalten.

## Sitzungs- und Cachegrenze

1. `getSession()` darf nur nach validierter Identität zum Weiterleiten des rohen Zugriffstokens
   verwendet werden und ist allein keine Autorisierungsentscheidung.
2. Tokens erscheinen weder in URL noch Logs noch eigener dauerhafter Browserablage.
3. Authentifizierte Antworten werden mit `private, no-store` beziehungsweise `no-store` markiert.
4. Der Dashboard-Browser kann Ziel-API, Benutzer-ID, Rolle, Standort oder `aal` nicht frei wählen.
5. `DASHBOARD_AUTH_ENABLED=false` ist die sichere Voreinstellung.

## Nicht Bestandteil

- operative Bestellliste, Bestelldetails oder Statusänderungen
- Personalverwaltung, Einladungsversand oder PROVIDE-Administration
- MFA-Wiederherstellung oder Entfernen des letzten Faktors
- echte Auth-Benutzer, produktive Supabase-Konfiguration oder Deployment
- Benachrichtigungen, Lieferung, Onlinezahlung oder externe Integrationen
