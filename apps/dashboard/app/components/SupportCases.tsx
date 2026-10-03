"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  parseSupportCommand,
  parseSupportState,
  supportKinds,
  supportReasons,
  type SupportCommand,
  type SupportState,
} from "@provide/contracts";
const labels: Record<string, string> = {
  payment_review: "Zahlung prüfen",
  refund_failed: "Erstattung fehlgeschlagen",
  email_uncertain: "E-Mail-Annahme ungewiss",
  email_dead_letter: "E-Mail ausgeschöpft",
  acceptance_overdue: "Annahme überfällig",
  incident: "Standortvorfall",
  open: "Offen",
  in_progress: "In Bearbeitung",
  waiting: "Wartend",
  resolved: "Geschlossen",
  critical: "Kritisch",
  high: "Hoch",
  normal: "Normal",
  claim: "Übernehmen",
  assign: "Zuweisen",
  status: "Status",
  priority: "Priorität",
  deadline: "Frist",
  triage: "Interne Bearbeitung",
  handover: "Übergabe",
  awaiting_internal: "Interne Klärung ausstehend",
  awaiting_provider: "Anbieterklärung ausstehend",
  source_confirmed: "Aktueller interner Abschlussnachweis",
  misassignment: "Fehlzuordnung",
  duplicate: "Doppelter Fall",
  out_of_scope: "Außerhalb des Umfangs",
  reopened: "Erneut geöffnet",
  priority_changed: "Priorität angepasst",
  deadline_changed: "Frist angepasst",
  incident_recorded: "Standortvorfall erfasst",
};
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
};
type Update = Extract<SupportCommand, { action: "update" }>;
export function SupportCases() {
  const [restaurantId, setRestaurant] = useState(""),
    [locationId, setLocation] = useState("");
  const [data, setData] = useState<SupportState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<SupportCommand | null>(null),
    [operation, setOperation] = useState<Update["operation"]>("claim");
  const [kind, setKind] = useState<(typeof supportKinds)[number]>("incident");
  const serial = useRef(0),
    controller = useRef<AbortController | null>(null),
    lastRead = useRef<SupportCommand | null>(null),
    currentData = useRef<SupportState | null>(null),
    sendRef = useRef<(q: SupportCommand, background?: boolean) => Promise<void>>(() =>
      Promise.resolve(),
    );
  function clear() {
    serial.current++;
    controller.current?.abort();
    setData(null);
    currentData.current = null;
    setPending(null);
    setBusy(false);
    setError("");
    lastRead.current = null;
  }
  async function send(q: SupportCommand, background = false) {
    if (!parseSupportCommand(q)) {
      setError("Bitte gültige interne Referenzen und Pflichtfelder angeben.");
      return;
    }
    const seq = ++serial.current;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    if (!background) setData(null);
    currentData.current = null;
    setError("");
    setBusy(true);
    setPending(null);
    if (q.action === "read") lastRead.current = q;
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(q),
        cache: "no-store",
        signal: AbortSignal.any([c.signal, AbortSignal.timeout(10000)]),
      });
      if (seq !== serial.current) return;
      if (!response.ok) {
        setData(null);
        if (response.status >= 500 && q.action !== "read") setPending(q);
        if ([401, 403].includes(response.status)) lastRead.current = null;
        setError(
          response.status === 409
            ? "Stand geändert. Bitte den Fall erneut laden."
            : [401, 403].includes(response.status)
              ? "Zugang oder Berechtigung fehlt. Angezeigte Daten wurden entfernt."
              : "Abgleich derzeit nicht verfügbar.",
        );
        return;
      }
      const envelope = (await response.json()) as { data?: unknown };
      if (seq !== serial.current) return;
      const next = parseSupportState(envelope.data);
      if (
        !next ||
        next.restaurantId !== q.restaurantId ||
        next.locationId !== q.locationId ||
        ((q.action === "update" || (q.action === "read" && q.caseId !== null)) &&
          (next.cases.length !== 1 || next.cases[0]?.caseId !== q.caseId))
      )
        throw Error("Invalid projection");
      setData(next);
      currentData.current = next;
      if (q.action !== "scan")
        lastRead.current = {
          action: "read",
          restaurantId: q.restaurantId,
          locationId: q.locationId,
          cursor: null,
          caseId:
            q.action === "read" ? q.caseId : next.cases.length === 1 ? next.cases[0]!.caseId : null,
        };
    } catch {
      if (seq === serial.current) {
        setData(null);
        setError("Antwort ausgeblieben. Ein erneuter Versuch verwendet denselben Auftrag.");
        if (q.action !== "read") setPending(q);
      }
    } finally {
      if (seq === serial.current) setBusy(false);
    }
  }
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden && currentData.current && lastRead.current)
        void sendRef.current(lastRead.current, true);
    };
    const interval = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      serial.current++;
      controller.current?.abort();
    };
  }, []);
  const scope = { restaurantId, locationId };
  const read = (caseId: string | null = null, cursor: string | null = null) =>
    void send({ action: "read", ...scope, caseId, cursor });
  const date = (value: string) =>
    new Date(value).toLocaleString("de-DE", {
      timeZone: data?.timezone ?? "UTC",
      timeZoneName: "short",
    });
  const selected =
    data?.cases.length === 1 &&
    lastRead.current?.action === "read" &&
    lastRead.current.caseId !== null
      ? data.cases[0]
      : undefined;
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void send({
      action: "create",
      ...scope,
      requestId: crypto.randomUUID(),
      kind,
      sourceId: kind === "incident" ? null : text(f, "sourceId"),
      severity: text(f, "severity") as "normal",
      reason: kind === "incident" ? "incident_recorded" : "triage",
    });
  }
  function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const f = new FormData(event.currentTarget);
    const state = operation === "status" ? (text(f, "state") as Update["state"]) : null;
    const reason =
      operation === "priority"
        ? "priority_changed"
        : operation === "deadline"
          ? "deadline_changed"
          : operation === "claim" || operation === "assign"
            ? "handover"
            : (text(f, "reason") as Update["reason"]);
    const deadlineValue = text(f, "deadline");
    const deadline =
      operation === "deadline" &&
      deadlineValue &&
      Number.isFinite(Date.parse(`${deadlineValue}:00Z`))
        ? new Date(`${deadlineValue}:00Z`).toISOString()
        : null;
    void send({
      action: "update",
      ...scope,
      requestId: crypto.randomUUID(),
      caseId: selected.caseId,
      expectedRevision: selected.revision,
      operation,
      assigneeUserId: operation === "assign" ? text(f, "assignee") || null : null,
      state,
      severity: operation === "priority" ? (text(f, "severity") as "normal") : null,
      deadline,
      reason,
      sourceFingerprint:
        operation === "status" && state === "resolved" && reason === "source_confirmed"
          ? (data?.currentSource?.fingerprint ?? null)
          : null,
    });
  }
  return (
    <section className="panel support-cases" aria-label="Supportfälle">
      <p>
        Nur gespeicherte interne Nachweise. Beobachtungszeit bezeichnet den internen Lesezeitpunkt.
        Anbieterantworten werden hier nicht neu abgefragt.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          read();
        }}
        className="support-form"
      >
        <label>
          Mandanten-ID
          <input
            name="restaurant"
            value={restaurantId}
            onChange={(e) => {
              clear();
              setRestaurant(e.target.value.trim());
            }}
            required
          />
        </label>
        <label>
          Standort-ID
          <input
            name="location"
            value={locationId}
            onChange={(e) => {
              clear();
              setLocation(e.target.value.trim());
            }}
            required
          />
        </label>
        <button disabled={busy}>Fälle laden</button>
      </form>
      {busy && <p role="status">Berechtigung und Nachweise werden geprüft …</p>}
      {error && <p role="alert">{error}</p>}
      {pending && (
        <button onClick={() => void send(pending)} disabled={busy}>
          Denselben Auftrag erneut versuchen
        </button>
      )}
      {data && (
        <>
          <p>
            Standortzeit: {data.timezone}. Interne Bearbeitungsziele; keine zugesicherte
            Antwortzeit.
          </p>
          {data.canManage && (
            <div className="support-actions">
              <button
                onClick={() =>
                  void send({
                    action: "scan",
                    ...scope,
                    requestId: crypto.randomUUID(),
                    cursor: null,
                  })
                }
              >
                Internen Abgleich starten (max. 100 Quellen)
              </button>
              {data.scanCursor && (
                <button
                  onClick={() =>
                    void send({
                      action: "scan",
                      ...scope,
                      requestId: crypto.randomUUID(),
                      cursor: data.scanCursor,
                    })
                  }
                >
                  Abgleich fortsetzen
                </button>
              )}
            </div>
          )}
          {data.scanned > 0 && (
            <p role="status">
              {data.scanned} interne Quellen geprüft.
              {data.scanCursor ? " Weitere Quellen stehen aus." : " Dieser Abgleich ist beendet."}
            </p>
          )}
          {!data.cases.length && <p>Keine erfassten Fälle in dieser Auswahl.</p>}
          <ul className="support-list">
            {data.cases.map((c) => (
              <li key={c.caseId}>
                <button onClick={() => read(c.caseId)}>
                  {c.orderNumber ?? "Standortvorfall"} · {labels[c.kind]}
                </button>
                <p>
                  {labels[c.state]} · {labels[c.severity]} · Frist {date(c.deadline)}
                  {Date.parse(c.deadline) < Date.parse(data.serverNow) && c.state !== "resolved"
                    ? " · Überfällig"
                    : ""}
                </p>
                <p>
                  Fall {c.caseId} · Revision {c.revision}
                </p>
                {c.resolution && (
                  <p>
                    {c.resolution === "administrative"
                      ? "Administrativ geschlossen; kein technischer Erfolgsnachweis."
                      : "Mit internem Abschlussnachweis geschlossen."}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {data.nextCursor && (
            <button onClick={() => read(null, data.nextCursor)}>Weitere Fälle</button>
          )}
          {selected && (
            <section aria-label="Falldetail">
              <h2>Falldetail</h2>
              <p>Zuständig: {selected.assigneeUserId ?? "Nicht zugewiesen"}</p>
              <p>Grund: {labels[selected.reason]}</p>
              {selected.previousCaseId && <p>Vorheriger Fall: {selected.previousCaseId}</p>}
              {data.currentSource && (
                <>
                  <p>
                    Gespeicherter Zustand: {data.currentSource.stateCode} · Beobachtet{" "}
                    {date(data.currentSource.observedAt)}
                  </p>
                  <p>
                    {data.currentSource.recordedAt
                      ? `Gespeicherter Nachweiszeitpunkt: ${date(data.currentSource.recordedAt)}`
                      : "Kein gesonderter Anbieter-Nachweiszeitpunkt gespeichert."}
                  </p>
                  <p>
                    {data.currentSource.canClose
                      ? "Interner Abschlussnachweis vorhanden."
                      : "Kein aktueller technischer Abschlussnachweis."}
                  </p>
                  <p>Interne Quelle: {data.currentSource.sourceId}</p>
                </>
              )}
              <button onClick={() => read(selected.caseId)}>Nachweis erneut lesen</button>
              <button onClick={() => read()}>Zur Fallliste</button>
              {data.canManage && (
                <form onSubmit={update} className="support-form">
                  <label>
                    Aktion
                    <select
                      value={operation}
                      onChange={(e) => setOperation(e.target.value as Update["operation"])}
                    >
                      {["claim", "assign", "status", "priority", "deadline"].map((v) => (
                        <option key={v} value={v}>
                          {labels[v]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {operation === "assign" && (
                    <label>
                      Zuständige Benutzer-ID (leer: nicht zugewiesen)
                      <input name="assignee" />
                    </label>
                  )}
                  {operation === "priority" && (
                    <label>
                      Priorität
                      <select name="severity">
                        {["normal", "high", "critical"].map((v) => (
                          <option key={v} value={v}>
                            {labels[v]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {operation === "deadline" && (
                    <label>
                      Neue interne Frist (UTC)
                      <input name="deadline" type="datetime-local" required />
                    </label>
                  )}
                  {operation === "status" && (
                    <>
                      <label>
                        Status
                        <select name="state">
                          {["open", "in_progress", "waiting", "resolved"].map((v) => (
                            <option key={v} value={v}>
                              {labels[v]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Grund
                        <select name="reason">
                          {supportReasons
                            .filter((v) =>
                              [
                                "triage",
                                "awaiting_internal",
                                "awaiting_provider",
                                "source_confirmed",
                                "misassignment",
                                "duplicate",
                                "out_of_scope",
                                "reopened",
                              ].includes(v),
                            )
                            .map((v) => (
                              <option key={v} value={v}>
                                {labels[v]}
                              </option>
                            ))}
                        </select>
                      </label>
                    </>
                  )}
                  <button>Fallaktion speichern</button>
                </form>
              )}
              <h3>Letzte 30 Fallnachweise</h3>
              <ul>
                {data.audit.map((a) => (
                  <li key={a.id}>
                    {date(a.at)} · {labels[a.action]} ·{" "}
                    {a.provenance === "system_observed" ? "Intern beobachtet" : "Benutzeraktion"} ·{" "}
                    {labels[a.reason]} · Revision {a.revision}
                    <p>
                      {a.before ? `${labels[a.before.state]} → ` : ""}
                      {labels[a.after.state]} · {labels[a.after.severity]} · Frist{" "}
                      {date(a.after.deadline)} · Zuständig{" "}
                      {a.after.assigneeUserId ?? "Nicht zugewiesen"}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.canManage && (
            <form onSubmit={create} className="support-form">
              <h2>Fall erfassen</h2>
              <label>
                Falltyp
                <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  {supportKinds.map((v) => (
                    <option key={v} value={v}>
                      {labels[v]}
                    </option>
                  ))}
                </select>
              </label>
              {kind !== "incident" && (
                <label>
                  Interne Quellen-ID
                  <input name="sourceId" required />
                </label>
              )}
              <label>
                Initiale Priorität
                <select name="severity">
                  {["normal", "high", "critical"].map((v) => (
                    <option key={v} value={v}>
                      {labels[v]}
                    </option>
                  ))}
                </select>
              </label>
              <button>Fall erfassen</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
