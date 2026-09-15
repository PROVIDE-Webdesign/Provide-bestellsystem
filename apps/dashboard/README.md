# Dashboard

Geschützter Einstiegspunkt für Restaurantpersonal. Arbeitsblock 3.5 ergänzt Supabase-Anmeldung,
cookiegestützte SSR-Sitzungen, TOTP-MFA und den rollen- und standortgebundenen Zugriffskontext.
Arbeitsblock 3.6 ergänzt die begrenzte Abholbestellliste, minimale Details und kontrollierte
Statusbearbeitung für Management und Küche.

Personalverwaltung und die getrennte PROVIDE-Administration sind nicht Bestandteil dieses Schnitts.
Zugang und Bestellbetrieb bleiben mit `DASHBOARD_AUTH_ENABLED=false` beziehungsweise
`DASHBOARD_ORDER_OPERATIONS_ENABLED=false` standardmäßig geschlossen. Konfiguration und
Störungsbehandlung stehen im
[Dashboard-Auth-Runbook](../../docs/runbooks/dashboard-authentication.md) und
[Dashboard-Bestell-Runbook](../../docs/runbooks/dashboard-order-operations.md).
