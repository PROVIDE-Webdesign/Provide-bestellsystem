# Vorschau · Testbestellung BS-00000023 vom 04.11.2026

Die mobile Asian Kitchen Demo führte zur Stripe-Sandbox. Für zwei Positionen wurden 14,80 €
reserviert. Der Orderstatus war zunächst `submitted`, die Zahlung `authorized`, das Verfahren
`manual`. Bis zum Annahmeschluss um 21:46:38 Uhr Ortszeit war kein Erfassungsauftrag angefordert.
Die Vorschau zeigte danach `cancelled` und `expired`.

## Dashboard

Die während des Tests ausgelieferte Dashboard-Version `81d45a6b-f06a-4dfd-947d-d5583cc0b70f` war der
Audio-Build auf älteren Checkout-Verträgen. Dieser Stand kennt die Zahlungszustände `authorized` und
`capture_pending` nicht. Im Video steht im Suchfeld außerdem `BS-00000421`; der Auftrag des
Durchlaufs lautet `BS-00000023`.

## Datenbankbefund für Bestellsystem 15

In der Vorschau gab es für BS-00000023 keinen Eintrag im priorisierten Bestelleingang.
`private.order_acceptance_eligible(uuid)` akzeptiert Onlinebestellungen erst bei
`p.status='captured'`. Bei manueller Erfassung muss das Restaurant bereits nach der Reservierung
annehmen können. Die Erfassung beginnt erst nach der Annahmeanforderung.

Die identische Funktion steht in der Migration
`supabase/migrations/20261001100545_private_order_realtime_alerts.sql` des geprüften
Produktionskandidaten `b35ec50`. Bestellsystem 15 übernimmt die Datenbankkorrektur und den Abgleich
mit dem Release-Kandidaten. Reproduktion für den Integrationstest:

1. Eine neue Sandbox-Abholbestellung mit manueller Erfassung reservieren.
2. Nach der Reservierung muss sie bis zur bestehenden Annahmefrist einmal im filterunabhängigen
   Eingang erscheinen und den Bestellalarm auslösen.
3. Bei einer Annahme genau eine Erfassungsanforderung auslösen und erst nach bestätigter Erfassung
   auf angenommen wechseln. Bei Fristablauf ohne Annahme Reservierung freigeben und den Eintrag im
   offenen Eingang auflösen.
4. Ausschluss von Zahlungen ohne Reservierung und von bereits geschlossenen Vorgängen sowie
   bestehendes Verhalten von Zahlung bei Abholung und automatischer Erfassung prüfen.

## Wiederherstellung der Dashboard-Vorschau

Die Dashboard-Vorschau wurde auf Version `bf854071-a46d-450d-98ba-8417b1ba3eae` aktualisiert. Der
ausgelieferte Code enthält Audio-Korrektur und beide manuellen Zahlungszustände. Typprüfung, 68
Dashboard-Tests, Build und die Prüfsummen der ausgelieferten Dashboard- und Vertragsmodule sind
bestätigt. Im angemeldeten Dashboard war BS-00000023 anschließend als „Storniert · Zahlung beendet“
mit 14,80 € sichtbar. Der nächste Bestellalarm-Test folgt auf die Korrektur der Eingangslogik. Die
bestehende Bestellung bleibt ein Nachweis für die abgelaufene Reservierung.

## Wiederholung mit BS-00000024

Die Sandbox reservierte 14,80 €. Eine Erfassung wurde über die Annahme im Dashboard angefordert. In
der Vorschau ist genau ein Stripe-Ereignis `payment_intent.succeeded` zum Zahlungsauftrag
hinterlegt. Die Bestellung durchlief Eingegangen → Angenommen → In Zubereitung → Abholbereit →
Abgeschlossen. Der Abschluss und der Zahlungsstatus `captured` sind lesend in der Vorschau belegt.

Der Eintrag im priorisierten Bestelleingang entstand erst nach der Erfassungsanforderung. Der Alarm
bei der Reservierung bleibt daher offen. Der ursprüngliche Gast-Tab war nicht wiederherstellbar. Der
Gast-Endstatus dieser Testbestellung bleibt ohne eigenen Sichtnachweis.

## Gaststatus nach geschlossenem Tab und Alarm bei geschlossenem Dashboard

Der Shop-Commit `8c69f57` speichert befristete Statuszugänge und Bestellnummern nach Restaurant und
Standort im Browser. Die Vorschau-Version `4cdc1618-a9a6-4acc-bf7f-8b4c8fbf6c62` wurde mit
BS-00000022 geprüft. Ein neuer Tab zeigte „Meine Bestellungen“ und lud den aktuellen
Abschlussstatus. 106 Shop-Tests, Typprüfung, Lint und Build bestanden. Bei BS-00000024 fehlt der
vorherige Gastzugang.

Für Bestellsystem 15: Der Alarm bei geschlossenem Dashboard benötigt einen serverseitigen
Web-Push-Versand und die Korrektur der Eingangsberechtigung für reservierte Zahlungen. Die
Versandgrundlage ist ein dauerhaft gespeichertes Eingangsereignis mit eindeutiger Zustellung je
Gerät. Geräte-Abos werden nach Restaurant und Standort autorisiert, bei Rechteentzug gesperrt und
bei ungültigem Endpunkt entfernt. Die Meldung auf dem Sperrbildschirm enthält keine Kundendaten.
Testfälle sind Zahlung bei Abholung, manuelle Reservierung vor Annahme, doppelte Ereignisse und ein
geschlossenes Dashboard auf einem echten Gerät. Die Dashboard-Web-App wird auf dem iPhone dem
Home-Bildschirm hinzugefügt und die Mitteilungen werden per Bedienaktion freigegeben.

[WebKit zum iPhone-Setup](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
