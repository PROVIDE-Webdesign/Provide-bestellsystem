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

A4 ergänzt die getrennten minimalen Wege `/recovery` und `/recovery/operate`. Beide bleiben mit
`ACCOUNT_RECOVERY_ENABLED=false` geschlossen. Die globale explizite Recovery-Berechtigung ist
unabhängig von Restaurantrollen und PROVIDE-Grants. Ablauf, Wiederaufnahme, tatsächliche Auth-
Grenze und Störungsbehandlung stehen im
[Recovery-Runbook](../../docs/runbooks/account-mfa-recovery.md).
