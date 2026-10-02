"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  parsePersonnelCommand,
  parsePersonnelState,
  restaurantRoles,
  type PersonnelCommand,
  type PersonnelState,
  type RestaurantRole,
} from "@provide/contracts";
const roleLabel: Record<RestaurantRole, string> = {
  owner: "Inhaber",
  manager: "Manager",
  kitchen: "Küche",
  driver: "Fahrer",
};
const dispatchLabel = {
  pending: "Versand vorbereitet",
  sending: "Versand läuft – nicht erneut senden",
  sent: "Auth-Versand bestätigt",
  uncertain: "Versand unklar – zuerst prüfen oder abbrechen",
  failed: "Versand fehlgeschlagen",
  cancelled: "Versand abgebrochen",
};
export function Personnel({ restaurantId }: { readonly restaurantId: string }) {
  const [data, setData] = useState<Extract<PersonnelState, { mode: "management" }>>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<PersonnelCommand>(),
    [target, setTarget] = useState(""),
    [role, setRole] = useState<RestaurantRole>("kitchen"),
    [status, setStatus] = useState<"active" | "suspended">("active"),
    [locs, setLocs] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const sequence = useRef(0),
    controller = useRef<AbortController | null>(null);
  const send = useCallback(
    async (q: PersonnelCommand) => {
      controller.current?.abort();
      const c = new AbortController();
      controller.current = c;
      const seq = ++sequence.current;
      setBusy(true);
      setData(undefined);
      setMessage("");
      try {
        const r = await fetch("/api/personnel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(q),
          cache: "no-store",
          signal: AbortSignal.any([c.signal, AbortSignal.timeout(22000)]),
        });
        if (seq !== sequence.current) return;
        if (!r.ok) {
          if (r.status === 503 && q.action !== "read") setPending(q);
          else setPending(undefined);
          setMessage(
            r.status === 409
              ? "Der Stand wurde geändert. Neu laden und die Änderung erneut prüfen."
              : r.status === 403
                ? "Personalrechte entzogen. Geladene Daten wurden verworfen."
                : "Personalverwaltung derzeit nicht verfügbar.",
          );
          return;
        }
        const envelope = (await r.json()) as { data?: unknown };
        const state = parsePersonnelState(envelope.data);
        if (!state || state.mode !== "management" || state.restaurantId !== restaurantId)
          throw Error("Invalid personnel state");
        if (seq !== sequence.current) return;
        setData(state);
        setPending(undefined);
        setTarget("");
        setReason("");
        setConfirmed(false);
        setLocs([]);
        setMessage(
          q.action === "read"
            ? "Aktuelle Personalrechte geladen."
            : "Änderung auditiert. Aktueller Personalstand geladen.",
        );
      } catch {
        if (seq === sequence.current && !c.signal.aborted) {
          setPending(q.action === "read" ? undefined : q);
          setMessage("Antwort unklar. Dieselbe Anfrage kann sicher wiederholt werden.");
        }
      } finally {
        if (seq === sequence.current) setBusy(false);
      }
    },
    [restaurantId],
  );
  useEffect(() => {
    setPending(undefined);
    void send({ action: "read", restaurantId });
    const visible = () => {
      if (document.visibilityState === "visible") void send({ action: "read", restaurantId });
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      sequence.current++;
      controller.current?.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [restaurantId, send]);
  const command = (q: unknown) => {
    const parsed = parsePersonnelCommand(q);
    if (parsed) void send(parsed);
    else setMessage("Rolle, Standort und Änderungsgrund vollständig prüfen.");
  };
  const common = () => ({
    restaurantId,
    expectedRevision: data!.revision,
    requestId: crypto.randomUUID(),
    reason,
  });
  const roles = data?.actorRole === "owner" ? restaurantRoles : (["kitchen", "driver"] as const);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data || busy || !confirmed) return;
    if (target)
      command({
        ...common(),
        action: "member",
        userId: target,
        role,
        status,
        locationIds: role === "owner" ? [] : locs,
      });
    else {
      const email = new FormData(e.currentTarget).get("email");
      command({
        ...common(),
        action: "invite",
        email: typeof email === "string" ? email.trim().toLowerCase() : "",
        role,
        locationIds: role === "owner" ? [] : locs,
      });
    }
  }
  return (
    <section className="panel personnel">
      <h3>Personalverwaltung</h3>
      <p>
        Aktuelle Rechte gelten je Restaurant und Standort. Eine Restaurantsperre lässt andere
        Restaurantmitgliedschaften bestehen.
      </p>
      <p role="status">{busy ? "Personalrechte werden geprüft …" : message}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setPending(undefined);
          void send({ action: "read", restaurantId });
        }}
      >
        Personal neu laden
      </button>
      {pending && (
        <button type="button" disabled={busy} onClick={() => void send(pending)}>
          Dieselbe Personalanfrage wiederholen
        </button>
      )}
      {data && (
        <>
          <p>
            Verwaltungsstand {data.revision} · {roleLabel[data.actorRole]}
          </p>
          <ul className="personnel-list">
            {data.members.map((m) => (
              <li key={m.userId}>
                <strong>{m.email ?? m.userId}</strong> · {roleLabel[m.role]} ·{" "}
                {m.status === "active" ? "Aktiv" : "Gesperrt"}
                <p>
                  {m.role === "owner"
                    ? "Alle Standorte"
                    : m.locationIds
                        .map((id) => data.locations.find((l) => l.id === id)?.displayName ?? id)
                        .join(", ") || "Kein Standort"}
                </p>
              </li>
            ))}
          </ul>
          {data.nextCursor && (
            <button
              type="button"
              onClick={() => void send({ action: "read", restaurantId, cursor: data.nextCursor! })}
            >
              Weitere Mitarbeitende
            </button>
          )}
          <form onSubmit={submit}>
            <h4>Bewusste Personaländerung</h4>
            <label>
              Person oder Einladung
              <select
                value={target}
                onChange={(e) => {
                  const id = e.target.value;
                  setTarget(id);
                  setConfirmed(false);
                  const m = data.members.find((x) => x.userId === id);
                  setRole(m?.role ?? "kitchen");
                  setStatus(m?.status ?? "active");
                  setLocs(m?.locationIds ?? []);
                }}
              >
                <option value="">Neue Einladung</option>
                {data.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.email ?? m.userId}
                  </option>
                ))}
              </select>
            </label>
            {!target && (
              <label>
                E-Mail der eingeladenen Person
                <input name="email" type="email" required maxLength={254} autoComplete="off" />
              </label>
            )}
            <label>
              Neue Personalrolle
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as RestaurantRole);
                  setConfirmed(false);
                }}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel[r]}
                  </option>
                ))}
              </select>
            </label>
            {target && (
              <label>
                Mitgliedschaft
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as "active" | "suspended");
                    setConfirmed(false);
                  }}
                >
                  <option value="active">Aktiv</option>
                  <option value="suspended">Im Restaurant sperren</option>
                </select>
              </label>
            )}
            {role !== "owner" && (
              <fieldset>
                <legend>Zugewiesene Standorte</legend>
                {data.locations.map((l) => (
                  <label key={l.id}>
                    <input
                      type="checkbox"
                      checked={locs.includes(l.id)}
                      onChange={(e) => {
                        setConfirmed(false);
                        setLocs(
                          e.target.checked ? [...locs, l.id] : locs.filter((x) => x !== l.id),
                        );
                      }}
                    />
                    {l.displayName}
                  </label>
                ))}
              </fieldset>
            )}
            <label>
              Grund der Personaländerung
              <input
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setConfirmed(false);
                }}
                required
                minLength={8}
                maxLength={300}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Ich habe Person, Rolle und Standorte geprüft.
            </label>
            <button disabled={busy || !confirmed || (!target && !data.inviteDeliveryEnabled)}>
              {target ? "Personaländerung anwenden" : "Person einladen"}
            </button>
            {!data.inviteDeliveryEnabled && (
              <p>
                Einladungsversand ist derzeit deaktiviert. Bestehende Mitgliedschaften können
                weiterhin verwaltet werden.
              </p>
            )}
          </form>
          <h4>Offene Einladungen</h4>
          <p>
            Einladungen gelten sieben Tage; Rechte entstehen erst nach Anmeldung und bewusster
            Annahme. Ablauf und Widerruf sperren die Annahme.
          </p>
          {data.invitations.map((i) => (
            <article className="history-card" key={i.id}>
              <strong>{i.email}</strong>
              <p>
                {roleLabel[i.role]} ·{" "}
                {i.expired
                  ? "Abgelaufen"
                  : `Gültig bis ${new Date(i.expiresAt).toLocaleString("de-DE")}`}
              </p>
              <button
                type="button"
                disabled={!confirmed || reason.trim().length < 8}
                onClick={() => command({ ...common(), action: "revoke", invitationId: i.id })}
              >
                Einladung widerrufen
              </button>
            </article>
          ))}
          <h4>Einladungsversand</h4>
          {data.dispatches.map((d) => (
            <article className="history-card" key={d.id}>
              <strong>{d.email}</strong>
              <p>{dispatchLabel[d.status]}</p>
              {!["sent", "cancelled"].includes(d.status) && (
                <button
                  type="button"
                  disabled={!confirmed || reason.trim().length < 8}
                  onClick={() =>
                    command({ ...common(), action: "cancelDispatch", dispatchId: d.id })
                  }
                >
                  Versandvorgang abbrechen
                </button>
              )}
            </article>
          ))}
          <h4>Personalaudit</h4>
          <div className="admin-audit">
            {data.audit.map((a) => (
              <details key={a.id}>
                <summary>
                  {new Date(a.at).toLocaleString("de-DE")} · {a.action}
                </summary>
                <p>Grund: {a.reason}</p>
                <p>Akteur: {a.actorUserId}</p>
                <h5>Vorher</h5>
                <pre>{JSON.stringify(a.before, null, 2)}</pre>
                <h5>Nachher</h5>
                <pre>{JSON.stringify(a.after, null, 2)}</pre>
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
