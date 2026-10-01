# ADR0031: Unveränderliche lesbare Bestellnummer

Status: implementiert, technische Abnahme über CI am Entwurfs-PR. Datum: 01.10.2026.

PostgreSQL vergibt für jeden Auftrag eine globale BIGINT-Identität, abgesichert durch NOT NULL,
UNIQUE, GENERATED ALWAYS, NO CYCLE und einen Änderungsverbot-Trigger. Die Formatierung ist `BS-` mit
mindestens acht Dezimalstellen. Größere Werte werden nicht gekürzt; JavaScript überträgt
ausschließlich Text. Lücken sind zulässig. Diese Referenz ist kein Zugangsmerkmal und kein
steuerlicher Belegnummernkreis.

Bestehende Aufträge bekommen bei der Migration eine Nummer. Alte Clientantworten ohne Nummer zeigen
übergangsweise die vollständige UUID. Bestehende Datensätze werden außerhalb isolierter
Testdatenbanken in diesem Schnitt nicht migriert.

Nur zuvor autorisierte Serverprojektionen erhalten die Nummer: Abhol-/Liefer-/ Onlinebestätigung,
tokengebundener Gaststatus, Dashboard und Benachrichtigungsjobs. Der private Projektionshelfer ist
VOLATILE, damit er auch den unmittelbar zuvor innerhalb desselben Statements eingefügten Auftrag
lesen kann. Browserrollen dürfen ihn und die Nummernsuche nicht direkt aufrufen. Öffentliche
Statuszugriffe behalten UUID und signierten Token als gemeinsame Zugangsgrenze.

Die genaue Nummernsuche prüft zuerst Rolle, AAL und Standort. Sie nutzt den eindeutigen Index und
projiziert ausschließlich erlaubte Zusammenfassungsfelder. Keine Suche über Kundendaten und keine
Kontaktinformationen in Listen. Status- und Erfüllungsfilter werden auch bei einer Nummernsuche
angewandt.

Nachweise: Vertrags- und API-Tests, parallele reale HTTP/PostgreSQL-Bestellungen mit idempotenter
Wiederholung, pgTAP-Berechtigungs-/Unveränderlichkeitsprüfungen und dieselbe Bedienung in drei
Browser-Engines bei 390/1440 Pixeln. Ein physisches Gerät wird dadurch nicht als abgenommen
gewertet.
