"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  parsePersonnelState,
  type PersonnelCommand,
  type PersonnelInvitation,
} from "@provide/contracts";
import { MfaPanel } from "./MfaPanel.js";
export function InvitationInbox() {
  const [items, setItems] = useState<PersonnelInvitation[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [mfa, setMfa] = useState(false);
  const seq = useRef(0);
  const send = useCallback(async (q: PersonnelCommand) => {
    const n = ++seq.current;
    setItems([]);
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/personnel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(q),
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      if (n !== seq.current) return;
      if (!r.ok) {
        setMessage(
          r.status === 403
            ? "Die Annahme benötigt die passende Anmeldung und gegebenenfalls MFA."
            : r.status === 409
              ? "Einladung abgelaufen, widerrufen oder Einladungsrechte geändert."
              : "Einladungen derzeit nicht verfügbar. Neu laden oder dieselbe Einladung erneut annehmen.",
        );
        return;
      }
      const v = (await r.json()) as { data?: unknown };
      const state = parsePersonnelState(v.data);
      if (n !== seq.current) return;
      if (!state || state.mode !== "inbox") throw Error();
      setItems(state.invitations);
      setMfa(false);
      setMessage(
        q.action === "accept"
          ? "Einladung angenommen. Die Mitgliedschaft ist jetzt verfügbar."
          : "Deine offenen Einladungen sind geladen.",
      );
    } catch {
      if (n === seq.current) setMessage("Einladungen derzeit nicht verfügbar. Bitte neu laden.");
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void send({ action: "inbox" });
    return () => {
      seq.current++;
    };
  }, [send]);
  return (
    <section className="panel personnel">
      <h2>Deine Restaurant-Einladungen</h2>
      <p role="status">{busy ? "Einladungen werden geprüft …" : message}</p>
      <button type="button" disabled={busy} onClick={() => void send({ action: "inbox" })}>
        Einladungen neu laden
      </button>
      {items.map((i) => (
        <article className="history-card" key={i.id}>
          <h3>{i.restaurantName}</h3>
          <p>
            Rolle:{" "}
            {{ owner: "Inhaber", manager: "Manager", kitchen: "Küche", driver: "Fahrer" }[i.role]} ·
            Gültig bis {new Date(i.expiresAt).toLocaleString("de-DE")}
          </p>
          <p>
            Standorte:{" "}
            {i.role === "owner"
              ? "Alle Restaurantstandorte"
              : i.locations.map((l) => l.displayName).join(", ")}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void send({ action: "accept", invitationId: i.id })}
          >
            Einladung bewusst annehmen
          </button>
          {["owner", "manager"].includes(i.role) && (
            <button type="button" onClick={() => setMfa(true)}>
              MFA für verantwortliche Rolle prüfen
            </button>
          )}
        </article>
      ))}
      {mfa && <MfaPanel onVerified={() => void send({ action: "inbox" })} />}
      <p>
        <a href="/">Zum Restaurant-Dashboard</a>
      </p>
    </section>
  );
}
