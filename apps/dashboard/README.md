# Dashboard

Geschützter Einstiegspunkt für Restaurantpersonal. Arbeitsblock 3.5 ergänzt Supabase-Anmeldung,
cookiegestützte SSR-Sitzungen, TOTP-MFA und den rollen- und standortgebundenen Zugriffskontext.

Bestellübersicht, Statusbearbeitung, Personalverwaltung und die getrennte PROVIDE-Administration
sind nicht Bestandteil dieses Schnitts. Der Zugang bleibt mit `DASHBOARD_AUTH_ENABLED=false`
standardmäßig geschlossen. Konfiguration und Störungsbehandlung stehen im
[Dashboard-Auth-Runbook](../../docs/runbooks/dashboard-authentication.md).
