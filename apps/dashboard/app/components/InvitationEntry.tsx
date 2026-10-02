"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createDashboardBrowserClient } from "@/lib/supabase-browser.js";
import { readInvitationSessionFragment } from "@/lib/invitation-session.js";
import { LoginForm } from "./LoginForm.js";
import { InvitationInbox } from "./InvitationInbox.js";
export function InvitationEntry() {
  const [state, setState] = useState<"checking" | "confirm" | "login" | "ready">("checking"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const fragment = useRef<ReturnType<typeof readInvitationSessionFragment>>(undefined),
    captured = useRef(false);
  useEffect(() => {
    let current = true;
    if (!captured.current) {
      captured.current = true;
      fragment.current = readInvitationSessionFragment(location.hash);
      history.replaceState(null, "", location.pathname);
    }
    if (fragment.current) {
      setState("confirm");
      return;
    }
    const client = createDashboardBrowserClient(false);
    if (!client) {
      setState("login");
      return;
    }
    void client.auth
      .getClaims()
      .then((r) => {
        if (current) setState(!r.error && r.data?.claims?.sub ? "ready" : "login");
      })
      .catch(() => {
        if (current) setState("login");
      });
    return () => {
      current = false;
    };
  }, []);
  async function confirm() {
    if (busy || !fragment.current) return;
    setBusy(true);
    const client = createDashboardBrowserClient(false);
    try {
      if (!client) throw Error();
      const r = await client.auth.setSession(fragment.current);
      fragment.current = undefined;
      if (r.error) throw Error();
      const claims = await client.auth.getClaims();
      if (claims.error || !claims.data?.claims?.sub) throw Error();
      setState("ready");
    } catch {
      fragment.current = undefined;
      setState("login");
      setMessage("Einladungsanmeldung nicht möglich. Bitte neu anmelden.");
    } finally {
      setBusy(false);
    }
  }
  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const form = e.currentTarget;
    const value = new FormData(form).get("password");
    try {
      const client = createDashboardBrowserClient(false);
      if (!client || typeof value !== "string" || value.length < 12 || value.length > 1024)
        throw Error();
      const r = await client.auth.updateUser({ password: value });
      if (r.error) throw Error();
      form.reset();
      setMessage("Passwort gespeichert.");
    } catch {
      setMessage("Passwort konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p role="status">{message}</p>
      {state === "checking" ? (
        <p>Sitzung wird geprüft …</p>
      ) : state === "confirm" ? (
        <section className="panel">
          <p>
            Die Anmeldung aus diesem Einladungslink wird erst nach deiner Bestätigung übernommen.
          </p>
          <button type="button" disabled={busy} onClick={() => void confirm()}>
            Einladungsanmeldung bestätigen
          </button>
        </section>
      ) : state === "login" ? (
        <LoginForm enabled returnTo="/invitations" />
      ) : (
        <>
          <InvitationInbox />
          <details className="panel">
            <summary>Passwort für künftige Anmeldungen festlegen</summary>
            <form onSubmit={(e) => void password(e)}>
              <label>
                Neues Passwort
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={1024}
                  autoComplete="new-password"
                />
              </label>
              <button disabled={busy}>Passwort speichern</button>
            </form>
          </details>
        </>
      )}
    </>
  );
}
