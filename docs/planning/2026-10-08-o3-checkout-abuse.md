# O3 Checkout-Sitzung und Missbrauchsschutz

## Fachliche Bestätigung und Umsetzung

Der Nutzer bestätigt am 08.10.2026 um 18:33:08 Uhr Europe/Berlin O3-D01-D12 und den begrenzten
Paketumfang aus E30 und beauftragt die Umsetzung. Grundlage ist
`PROVIDE_Bestellsystem_O3_Vorbereitung_2026-10-08_V001.json`: 56 vorbereitete Fälle, davon 50
isoliert automatisierbar und sechs getrennte externe/fachliche/physische Freigabegrenzen.

Getrennter Zweig `codex/o3-checkout-abuse-20261008`, Basis PR22 ausschließlich am freigegebenen Head
`9d734c48c34fad2d07f592be085c898ca15c2e26`, Tree `940a724d957d6840ba170042b2c24376ee20e2ef`.
Bestehende Endfreigaben werden nicht auf neue Heads übertragen. Das begrenzte Paket ist
implementiert; die Startbestätigung selbst ist weder Testnachweis noch technische Endfreigabe.

Work / Sol / hoch. Start 18:33:08 Uhr, anfängliche Schätzung 90-150 Minuten einschließlich
Nachweisen. Kein Ready-Wechsel, Merge, Deployment, neue Providerzahlung, reales Konto oder externe
Cloudflare-/Supabase-Konfigurationsänderung. F01-F03 eingefroren. Defaults bleiben geschlossen.

## Verbindliche Paketgrenzen

- Höchstens eine verbindliche Bestellung pro Checkout-Sitzung: 30 Minuten Schreibfenster, 90 Minuten
  Gesamtdauer für ausschließlich lesende Ergebniswiederherstellung.
- Scope-/Vorgangsbindung, 256-Bit-Browsernachweis ausschließlich im sicheren HttpOnly-Cookie,
  servergebundener CSRF-Nachweis und authentisierter Gatewayvertrag. Kein Headerdurchreichen.
- Stabile Bestell-Idempotenz, atomarer Receipt und Wiederherstellung nach tatsächlichem
  Commitverlust.
- PostgreSQL-Token-Buckets: atomare begrenzte Zähler, getrennte Primär-/Netzwerkgruppen,
  pseudonymisierte vertrauenswürdige Herkunft, TTL und Speicherobergrenzen gemäß O3-D06/D09.
- Turnstile nur für Sessionstart/Erneuerung mit serverseitigem Nachweis. Lokale Adapter für
  automatisierte Prüfungen; keine echten Providerzahlungen.
- Bestehende SQL-20-Grenze, Status-/Zahlungstoken und Zahlungsfristen erhalten. Kein neuer
  Authproxy, Coupon, Kundenkonto, Adressprovider oder A4-Fachprozess. Direkte
  Supabase-Auth-/WAF-/Challenge- und reale Last-/Datenschutz-/Geräteabnahmen bleiben separat.

## Nachweisstand

Die Umsetzung und gezielten Korrekturen liegen im getrennten Draft-PR23. Die
[56-Fälle-Matrix](../testing/checkout-session-abuse.md),
[ADR0040](../decisions/0040-checkout-session-abuse-boundary.md), das
[Runbook](../runbooks/checkout-session-abuse.md) und
[Arbeitsblock 3.25](../work-blocks/3.25-checkout-session-abuse.md) trennen tatsächliche Nachweise
von den sechs weiterhin offenen externen/fachlichen/physisch zu prüfenden Grenzen. Ein
Unit-/Adapter-PASS ist kein echter DB-/HTTPS-/Provider-PASS. Der abschließende Umsetzungsnachweis
wird ausschließlich nach vollständig erfolgreichem Pflichtlauf an dessen Head/Tree gebunden;
technische Endfreigabe bleibt separat. NEXT: separate technische Endfreigabeprüfung von PR23 am im
aktuellen Umsetzungsnachweis belegten Head.
