"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  parseRecoveryCase,
  type RecoveryCase,
  type RecoveryCommand,
  type RecoveryKind,
} from "@provide/contracts";
import { createDashboardBrowserClient } from "../../lib/supabase-browser.js";
import { LoginForm } from "./LoginForm.js";
import { MfaPanel } from "./MfaPanel.js";
import { requestRecoveryEmail } from "../../lib/recovery-email.js";
export type RecoverySender = (q: RecoveryCommand, password?: string) => Promise<RecoveryCase>;
const key = "provide-recovery-case-v1";
export const sendRecovery: RecoverySender = async (command, password) => {
  const r = await fetch("/api/recovery", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command, ...(password ? { password } : {}) }),
  });
  if (!r.ok)
    throw Error(
      r.status === 409
        ? "Der Fall hat sich geändert. Bitte neu laden."
        : r.status === 403
          ? "Der Nachweis oder die Berechtigung reicht für diesen Schritt nicht aus."
          : "Der Schritt ist derzeit nicht verfügbar. Bitte neu anmelden oder den Recovery-Verantwortlichen kontaktieren.",
    );
  const v: unknown = await r.json();
  const c = v && typeof v === "object" && "data" in v ? parseRecoveryCase(v.data) : undefined;
  if (!c) throw Error("Der Fall konnte nicht geprüft werden.");
  return c;
};
const labels: Record<string, string> = {
  requested: "Angefordert",
  verified: "Nachweise geprüft",
  approved: "Freigegeben",
  executing: "Auth-Wirkung wird geprüft",
  awaiting_reenrollment: "Neue Anmeldung und MFA erforderlich",
  completed: "Abgeschlossen",
  rejected: "Abgelehnt",
  cancelled: "Abgebrochen",
  expired: "Abgelaufen",
  needs_review: "Manuelle Nachprüfung erforderlich",
};
export function RecoveryPanel({
  operator = false,
  send = sendRecovery,
}: {
  readonly operator?: boolean;
  readonly send?: RecoverySender;
}) {
  const [current, setCurrent] = useState<RecoveryCase | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [newFactor, setNewFactor] = useState(""),
    [qr, setQr] = useState("");
  useEffect(() => {
    if (!operator) {
      const id = sessionStorage.getItem(key);
      if (id && /^[a-f0-9-]{36}$/i.test(id))
        void send({ action: "read", caseId: id, commandId: crypto.randomUUID() })
          .then(setCurrent)
          .catch(() => setMessage("Bitte neu anmelden und den bestehenden Fall erneut öffnen."));
    }
  }, [operator, send]);
  async function run(command: RecoveryCommand, password?: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const c = await send(command, password);
      setCurrent(c);
      if (!operator) sessionStorage.setItem(key, c.caseId);
      setMessage("Schritt geprüft.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Der Schritt konnte nicht geprüft werden.");
    } finally {
      setBusy(false);
    }
  }
  const command = (action: RecoveryCommand["action"]): RecoveryCommand => ({
    action,
    caseId: current!.caseId,
    commandId: crypto.randomUUID(),
    ...(action === "read" ? {} : { expectedRevision: current!.revision }),
  });
  async function request(kind: RecoveryKind) {
    const extra: Partial<RecoveryCommand> = {};
    if (kind === "replace_factor") {
      const supabase = createDashboardBrowserClient();
      if (!supabase) {
        setMessage("MFA ist nicht konfiguriert.");
        return;
      }
      const claims = await supabase.auth.getClaims();
      const sid = claims.data?.claims.session_id;
      const factors = await supabase.auth.mfa.listFactors();
      const old = factors.data?.totp.find((f) => f.status === "verified");
      if (!old || !sid) {
        setMessage("Zuerst den bisherigen Faktor bestätigen.");
        return;
      }
      extra.oldFactorId = old.id;
    }
    await run({
      action: "request",
      caseId: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      kind,
      reason:
        kind === "password"
          ? "forgot_password"
          : kind === "lost_factor"
            ? "factor_lost"
            : "factor_replaced",
      ...extra,
    });
  }
  async function prepareNew() {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = createDashboardBrowserClient();
      if (!supabase) throw Error("MFA ist nicht konfiguriert.");
      const r = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `PROVIDE Ersatz ${crypto.randomUUID().slice(0, 8)}`,
      });
      if (r.error) throw Error("Der neue Faktor konnte nicht eingerichtet werden.");
      setNewFactor(r.data.id);
      setQr(r.data.totp.qr_code);
      setMessage(
        "Neuen QR-Code scannen und bestätigen. Der bisherige Faktor bleibt bis dahin erhalten.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "MFA konnte nicht vorbereitet werden.");
    } finally {
      setBusy(false);
    }
  }
  async function verifyNew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const input = event.currentTarget;
    const v = new FormData(input).get("code");
    const code = typeof v === "string" ? v : "";
    if (!/^\d{6}$/.test(code)) {
      setMessage("Bitte einen sechsstelligen Code eingeben.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createDashboardBrowserClient();
      if (
        !supabase ||
        (await supabase.auth.mfa.challengeAndVerify({ factorId: newFactor, code })).error
      )
        throw Error("Der neue Faktor konnte nicht bestätigt werden.");
      input.reset();
      setQr("");
      setMessage(
        "Neuer Faktor bestätigt. Der bisherige Faktor kann jetzt kontrolliert ersetzt werden.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Code nicht bestätigt.");
    } finally {
      setBusy(false);
    }
  }
  async function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form),
      a = data.get("password"),
      b = data.get("confirmation");
    if (typeof a !== "string" || a !== b || a.length < 12) {
      setMessage("Bitte dasselbe Passwort mit mindestens zwölf Zeichen zweimal eingeben.");
      return;
    }
    form.reset();
    await run(command("begin_password"), a);
  }
  async function resetEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const value = new FormData(form).get("email");
    if (typeof value !== "string") return;
    setBusy(true);
    form.reset();
    try {
      setMessage(await requestRecoveryEmail(value, window.location.origin));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-labelledby="recovery-title">
      <h2 id="recovery-title">{operator ? "Recovery-Fall prüfen" : "Konto wiederherstellen"}</h2>
      {operator && (
        <>
          <LoginForm enabled returnTo="/recovery/operate" />
          <MfaPanel
            onVerified={() => setMessage("MFA bestätigt. Den freigegebenen Fall jetzt öffnen.")}
          />
        </>
      )}
      {operator ? (
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            const id = new FormData(e.currentTarget).get("caseId");
            if (typeof id === "string")
              void run({ action: "read", caseId: id, commandId: crypto.randomUUID() });
          }}
        >
          <label>
            Fallkennung
            <input name="caseId" required maxLength={36} />
          </label>
          <button disabled={busy}>Fall öffnen</button>
        </form>
      ) : (
        <>
          <form onSubmit={(e) => void resetEmail(e)}>
            <label>
              Bestehende E-Mail-Adresse
              <input name="email" type="email" autoComplete="email" required maxLength={254} />
            </label>
            <button disabled={busy}>Recovery-E-Mail anfordern</button>
          </form>
          <p>
            Ohne Zugriff auf die bestätigte E-Mail gibt es keine automatische Übernahme. Bei
            verlorenem MFA-Faktor prüft ein berechtigter Verantwortlicher zusätzlich einen vorher
            vereinbarten Kontaktweg.
          </p>
          <LoginForm enabled returnTo="/recovery" />
          <MfaPanel
            onVerified={() =>
              setMessage("MFA bestätigt. Den gewünschten Recovery-Schritt jetzt starten.")
            }
          />
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              const id = new FormData(e.currentTarget).get("caseId");
              if (typeof id === "string")
                void run({ action: "read", caseId: id, commandId: crypto.randomUUID() });
            }}
          >
            <label>
              Eigene Fallkennung
              <input name="caseId" required maxLength={36} pattern="[a-fA-F0-9-]{36}" />
            </label>
            <button disabled={busy}>Bestehenden Fall öffnen</button>
          </form>
          {(!current ||
            ["completed", "cancelled", "rejected", "expired"].includes(current.state)) && (
            <div className="actions">
              <button disabled={busy} onClick={() => void request("password")}>
                Passwort-Recovery öffnen
              </button>
              <button disabled={busy} onClick={() => void request("lost_factor")}>
                Verlorenen MFA-Faktor melden
              </button>
              <button disabled={busy} onClick={() => void request("replace_factor")}>
                Bisherigen Faktor kontrolliert ersetzen
              </button>
            </div>
          )}
        </>
      )}
      {current && (
        <>
          <p>
            Fallkennung: <code style={{ overflowWrap: "anywhere" }}>{current.caseId}</code>
          </p>
          <p>Status: {labels[current.state]}</p>
          <p>Anforderung gültig bis {new Date(current.expiresAt).toLocaleString("de-DE")}.</p>
          {current.approvalExpiresAt && (
            <p>
              Freigabe gültig bis {new Date(current.approvalExpiresAt).toLocaleString("de-DE")}.
            </p>
          )}
          <button disabled={busy} onClick={() => void run(command("read"))}>
            Stand neu laden
          </button>
          {operator && current.state === "requested" && (
            <form
              className="auth-form"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                const contactId = d.get("contactId"),
                  reference = d.get("reference");
                if (typeof contactId !== "string" || typeof reference !== "string") return;
                void run({
                  ...command("verify"),
                  contactId,
                  evidenceReference: reference,
                });
              }}
            >
              <p>
                Bestätigte E-Mail und unabhängigen Nachweis über den bereits vereinbarten Kontaktweg
                prüfen. Nur die Referenz erfassen.
              </p>
              <label>
                Registrierte Kontaktkennung
                <input name="contactId" required maxLength={36} />
              </label>
              <label>
                Nachweisreferenz
                <input name="reference" required pattern="[A-Za-z0-9:_-]{1,120}" maxLength={120} />
              </label>
              <button disabled={busy}>Nachweise bestätigen</button>
            </form>
          )}
          {operator && current.state === "verified" && (
            <>
              <p>
                {current.requiredApprovals} unterschiedliche berechtigte Personen sind für die
                Freigabe erforderlich.
              </p>
              <button disabled={busy} onClick={() => void run(command("approve"))}>
                Unabhängige Freigabe erteilen
              </button>
            </>
          )}
          {operator && current.state === "approved" && (
            <button disabled={busy} onClick={() => void run(command("execute"))}>
              Freigegebenen Faktorverlust ausführen
            </button>
          )}
          {!operator && current.kind === "password" && current.state === "requested" && (
            <form onSubmit={(e) => void password(e)}>
              <label>
                Neues Passwort
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={1024}
                />
              </label>
              <label>
                Passwort wiederholen
                <input
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={1024}
                />
              </label>
              <button disabled={busy}>Passwort ändern und alte Sitzungen sperren</button>
            </form>
          )}
          {!operator && current.kind === "replace_factor" && current.state === "requested" && (
            <>
              <button disabled={busy || !!newFactor} onClick={() => void prepareNew()}>
                Neuen Faktor einrichten
              </button>
              {qr && (
                <>
                  <img className="qr" src={qr} alt="Neuen Authenticator einrichten" />
                  <form onSubmit={(e) => void verifyNew(e)}>
                    <label>
                      Code des neuen Faktors
                      <input
                        name="code"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                      />
                    </label>
                    <button disabled={busy}>Neuen Faktor bestätigen</button>
                  </form>
                </>
              )}
              {newFactor && !qr && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run({ ...command("begin_replacement"), newFactorId: newFactor })
                  }
                >
                  Bisherigen Faktor kontrolliert entfernen
                </button>
              )}
            </>
          )}
          {current.state === "executing" && (
            <button disabled={busy} onClick={() => void run(command("reconcile"))}>
              Auth-Zustand einmal nachprüfen
            </button>
          )}
          {current.state === "awaiting_reenrollment" && (
            <p>
              Alte Sitzungen bleiben gesperrt. Mit dem aktuellen Passwort neu anmelden, den
              erforderlichen neuen MFA-Faktor bestätigen und dann abschließen.
            </p>
          )}
          {!operator && current.state === "awaiting_reenrollment" && (
            <button disabled={busy} onClick={() => void run(command("complete"))}>
              Mit neuer Sitzung abschließen
            </button>
          )}
          {current.state === "needs_review" && (
            <p>
              Die Sperre bleibt bestehen. Keine automatische Wiederholung. Der berechtigte
              Recovery-Verantwortliche muss den tatsächlichen Auth-Zustand und die Auditnachweise
              prüfen.
            </p>
          )}
          {["requested", "verified", "approved"].includes(current.state) && (
            <button
              disabled={busy}
              onClick={() => void run(command(operator ? "reject" : "cancel"))}
            >
              {operator ? "Fall ablehnen" : "Fall abbrechen"}
            </button>
          )}
        </>
      )}
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
    </section>
  );
}
