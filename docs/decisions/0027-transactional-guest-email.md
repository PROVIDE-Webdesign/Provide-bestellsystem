# Entscheidung 0027: verpflichtender Gastkontakt und transaktionale E-Mail

Grundlage: A2-Hauptblock 8, Projektprotokoll V2/E01 und die bestätigten Entscheidungen vom
30.09.2026. Implementierungsbasis ist der Inhalt von PR #8 am Commit
`4e422f5b9ce7324e56bdb2b4e8d4cbd76ca3c8cc`; dessen Abnahme bleibt offen.

Jede neue Gastbestellung benötigt E-Mail, Name und Telefonnummer. Ein Konto ist weiterhin unnötig.
API, Oberfläche und die gemeinsame Datenbankgrenze setzen die Pflicht durch. Alte Kontakte ohne
E-Mail dürfen bestehen bleiben und unverändert wieder gelesen werden. Der wiederholte
Datenbankaufruf eines bereits gespeicherten alten Kontakts bleibt idempotent; die neue API
akzeptiert keine neue Abgabe ohne E-Mail. Löschen abgelaufener persönlicher Daten bleibt möglich.

E-Mail erhält einen eigenen privaten, PII-freien Versandnachweis. Der bestehende SMS-Vertrag bleibt
unverändert. Ein transaktionaler Outbox-Trigger legt genau einen versionierten Auftrag je Ereignis
an. Der Kontakt wird erst im serverseitigen Claim aus dem unveränderlichen Kontaktsnapshot
projiziert.

Nachrichten entstehen bei freigegebenem Eingang, Annahme, Ablehnung/Stornierung, Zeitkorrektur,
Abholbereitschaft, tatsächlichem Versand einer Lieferung und bestätigter vollständiger Erstattung.
Zubereitungsbeginn und Abschluss bleiben auf der Statusseite. Eine auslieferbereite Bestellung gilt
noch nicht als unterwegs. Die Onlinezahlung blockiert Eingangsnachrichten bis zur verifizierten
Erfassung ohne Schließungs- oder Erstattungsauftrag. Browser-Rückkehr reicht nicht aus.

Annehmen bestätigt die gewünschte Zeit. Spätere Korrekturen und die ausdrückliche Unterwegs-Meldung
liegen in einem eigenen, rollenbegrenzten und auditierten Bestellinformationsvertrag. Der
ursprüngliche Bestellsnapshot und die reservierte Kapazität werden dabei nicht verändert. Eine
ETA-Korrektur liegt zwischen jetzt und maximal zwei Stunden nach dem ursprünglichen Wunschzeitpunkt.
Nach Versand oder terminalem Bestellstatus ist sie gesperrt. Umbuchen auf andere Kapazität gehört
nicht zu diesem Vertrag.

Zeitkorrekturen prüfen Status und Revision. Ablehnungs- und Stornierungsgründe nutzen einen festen
sachlichen Katalog ohne freien Kundentext. Eine verzögerte Anbieterschließung behält den zuvor
erfassten Grund. Anbieterbestätigte Erstattungsbeträge kommen aus dem Zahlungsereignis; kein Betrag
wird aus dem Browser übernommen.

Die Statusfähigkeit liegt im URL-Fragment; sie wird clientseitig gelesen und aus der Adresszeile
entfernt. Serverzugriffe erhalten den Token nur im geschützten Status-POST. Bestehende HMAC-, Scope-
und Ablaufprüfungen gelten weiter.

Anbieterannahme heißt `accepted`, Zustellung erst nach passendem Nachweis `delivered`. Unklare
Annahme und abgelaufene Worker-Claims erzwingen einen Abgleich über denselben Idempotenzschlüssel.
Ein fehlgeschlagener Abgleich erlaubt kein blindes Resend. Nach höchstens sechs Versuchen entsteht
ein Dead Letter. Unbestätigte Annahme bleibt für manuellen Wiederholungsversand gesperrt. Erlaubte
Wiederholungen benötigen Owner/Manager mit MFA und erzeugen Audit.

Der Standardadapter bleibt unkonfiguriert; das neue Versand-Gate bleibt aus. Der injizierte
synthetische Adapter akzeptiert ausschließlich `@example.invalid`, führt keine Netzwerkanfragen aus
und dient automatisierten Tests. Brevo, Domainkonfiguration, reale Empfänger, Anbieter-Webhooks,
Kosten und Deployment sind ein separates späteres Paket. Es gibt keine echte Zustellabnahme.
