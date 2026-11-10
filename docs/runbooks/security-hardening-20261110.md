# Sicherheitskorrektur vom 10.11.2026

Bezug: Sicherheitsprüfung vom 10.11.2026, Befunde 1–4; A2-11-1 (Produktionssicherheit, Last- und
Release-Prüfung), A2-6-1 (authentifizierter Eingang) und A2-9-7 (Monitoring und getestete
Alarmierung).

## Zusammengehöriges Paket

1. Produktion erzwingt HTTPS vor der Bearbeitung einer Anfrage. HTTPS-Antworten erhalten HSTS ohne
   `includeSubDomains` oder `preload`. Dashboard-Anmeldecookies werden bei Browser-, Server- und
   Proxy-Schreibvorgängen mit `Secure` gesetzt.
2. `/health` bleibt öffentlich und benötigt keine Datenbankabfrage. `/health/database` benötigt
   einen eigenen Bearer-Schlüssel, der unabhängig von allen anderen Schlüsseln ist. Fehlende
   Konfiguration sperrt den Zugriff. Verbindungs- und Abfragezeiten sind begrenzt; die
   Datenbankfrist gilt nur innerhalb der Prüftransaktion.
3. Shop und Dashboard verwenden einen gemeinsamen HTTP-Schutz vor dem eigentlichen Vinext-Handler.
   Statische Dateien gehen ebenfalls zuerst durch den Worker (`assets.run_worker_first = true`). Die
   Header gelten auch für Fehlerseiten. Eine CSP beschränkt einbettende Seiten; Turnstile innerhalb
   des Shops und Übergaben per Link/API bleiben möglich.
4. Der Schutz vor geleakten Passwörtern bleibt von der Supabase-Tarifverfügbarkeit abhängig. Am
   10.11.2026 wurde für die Organisation der kostenlose Tarif bestätigt; keine kostenpflichtige
   Änderung ist Bestandteil dieses Pakets.

## Monitoring und Veröffentlichung

`DATABASE_HEALTH_TOKEN` muss als verwaltetes Worker-Secret gesetzt werden. Zulässig sind 43–128
Zeichen aus Buchstaben, Ziffern, Bindestrich und Unterstrich; mindestens 32 zufällige Bytes
verwenden. Keine Wiederverwendung eines API-, Datenbank-, Zahlungs- oder Benutzerpassworts.

Das identische Geheimnis erhält der bestehende Produktionsmonitor über das systemd-Credential
`database-health-token`. Die Quelldatei gehört root und hat Modus 0600.
`ops/production-monitor-auth.conf` ergänzt den vorhandenen Dienst; der bisherige Healthchecks-Zugang
bleibt bestehen. `ops/production-monitor.py` ist die versionierte Fortführung des bereits
verwendeten Monitors. Der Schlüssel gelangt ausschließlich über stdin an curl, niemals über
Prozessargumente, Protokolle oder URLs.

Reihenfolge: Rücksetzversionen sichern; Secret und Monitor-Credential vorbereiten; Monitor
aktualisieren und prüfen; neue Worker-Versionen zunächst hochladen; geprüfte Versionen aktivieren;
anonyme und autorisierte Prüfungen sowie den regulären Dienst nachweisen. Vor Aktivierung antwortet
der alte Datenbank-Check weiterhin auf den zusätzlich authentifizierten Monitoraufruf, sodass die
Vorbereitung keinen Alarm auslöst.

Bei einer Zurücksetzung der API funktioniert der Monitor mit dem zusätzlichen Header weiterhin. Ein
Zurücksetzen auf einen älteren Stand öffnet jedoch den hier geschlossenen Sicherheitsbefund erneut
und ist deshalb nur eine kurzfristige Wiederherstellungsmaßnahme.

Die Betriebskonfiguration muss das neue Worker-Einstiegsmodul und `run_worker_first` aus dem Build
übernehmen. Bestehende Produktions-Feature-Sperren bleiben erhalten. Dieses Paket gibt weder echten
Bestellbetrieb noch Livezahlungen frei.

## Abnahme

- HTTP auf API, Dashboard, Shop sowie einer statischen Datei liefert ausschließlich eine
  HTTPS-Weiterleitung.
- HTTPS-Seiten und Fehlerantworten enthalten die Schutzheader. Eine fremde Seite kann den Shop nicht
  einbetten.
- Neue Anmeldung und Tokenverlängerung schreiben Secure-Cookies; Sitzungswiderruf und vorhandene
  Rechteprüfungen funktionieren weiter.
- Anonyme bzw. falsch signierte Monitoringaufrufe erreichen die Datenbankfunktion nicht. Der
  reguläre Monitor erhält mit seinem eigenen Schlüssel einen erfolgreichen Datenbankstatus.
- Ein simuliertes Datenbank-Timeout wird begrenzt beendet und gibt keine internen Daten preis.
- Projektprüfung, gezielte Sicherheitstests und isolierte Datenbanktests werden am gespeicherten
  Stand dokumentiert. Die ausgelieferten Versionskennungen werden separat gebunden.

Die automatisierte Passwort-Leak-Prüfung wird erst nach passender Tariffreigabe als erledigt
gewertet.
