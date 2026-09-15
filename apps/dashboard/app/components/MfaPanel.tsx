"use client";

import { useState, type FormEvent } from "react";

import { createDashboardBrowserClient } from "@/lib/supabase-browser.js";

export function MfaPanel({ onVerified }: { readonly onVerified: () => void }) {
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function prepare() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const supabase = createDashboardBrowserClient();
    if (!supabase) {
      setMessage("MFA ist noch nicht konfiguriert.");
      setBusy(false);
      return;
    }
    const listed = await supabase.auth.mfa.listFactors();
    if (listed.error) {
      setMessage("Die MFA-Faktoren konnten nicht geladen werden.");
      setBusy(false);
      return;
    }
    const existing =
      listed.data.totp.find((factor) => factor.status === "verified") ?? listed.data.totp[0];
    if (existing) {
      setFactorId(existing.id);
      setMessage("Bitte den sechsstelligen Code aus deiner Authenticator-App eingeben.");
      setBusy(false);
      return;
    }
    const enrolled = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "PROVIDE Dashboard",
    });
    if (enrolled.error) {
      setMessage("Die MFA-Einrichtung konnte nicht gestartet werden.");
      setBusy(false);
      return;
    }
    setFactorId(enrolled.data.id);
    setQrCode(enrolled.data.totp.qr_code);
    setMessage("QR-Code scannen und anschließend den sechsstelligen Code eingeben.");
    setBusy(false);
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId || busy) return;
    const codeValue = new FormData(event.currentTarget).get("code");
    const code = typeof codeValue === "string" ? codeValue.trim() : "";
    if (!/^\d{6}$/.test(code)) {
      setMessage("Bitte einen gültigen sechsstelligen Code eingeben.");
      return;
    }
    const supabase = createDashboardBrowserClient();
    if (!supabase) return;
    setBusy(true);
    const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (result.error) {
      setMessage("Der Code konnte nicht bestätigt werden.");
      setBusy(false);
      return;
    }
    onVerified();
  }

  return (
    <section className="panel" aria-labelledby="mfa-title">
      <p className="eyebrow">Zusätzlicher Schutz</p>
      <h2 id="mfa-title">Zweiten Faktor bestätigen</h2>
      {!factorId && (
        <button type="button" onClick={() => void prepare()} disabled={busy}>
          MFA sicher einrichten oder öffnen
        </button>
      )}
      {qrCode && <img className="qr" src={qrCode} alt="QR-Code für die Authenticator-App" />}
      {factorId && (
        <form className="mfa-form" onSubmit={(event) => void verify(event)}>
          <label>
            Authenticator-Code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            Code bestätigen
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
