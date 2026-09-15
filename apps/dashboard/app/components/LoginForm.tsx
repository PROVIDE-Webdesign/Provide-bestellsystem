"use client";

import { useState, type FormEvent } from "react";

import { createDashboardBrowserClient } from "@/lib/supabase-browser.js";

export function LoginForm({ enabled }: { readonly enabled: boolean }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || busy) return;
    setBusy(true);
    setMessage("");
    const values = new FormData(event.currentTarget);
    const emailValue = values.get("email");
    const passwordValue = values.get("password");
    const email = typeof emailValue === "string" ? emailValue.trim() : "";
    const password = typeof passwordValue === "string" ? passwordValue : "";
    const supabase = createDashboardBrowserClient();
    if (!supabase) {
      setMessage("Die Anmeldung ist noch nicht konfiguriert.");
      setBusy(false);
      return;
    }
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) {
      setMessage("Anmeldung nicht möglich. Bitte Angaben prüfen.");
      setBusy(false);
      return;
    }
    window.location.assign("/");
  }

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label>
        E-Mail-Adresse
        <input name="email" type="email" autoComplete="username" required maxLength={254} />
      </label>
      <label>
        Passwort
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={1024}
        />
      </label>
      <button type="submit" disabled={!enabled || busy}>
        {busy ? "Anmeldung läuft …" : "Sicher anmelden"}
      </button>
      {!enabled && <p className="notice">Der Dashboard-Zugang ist standardmäßig deaktiviert.</p>}
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
