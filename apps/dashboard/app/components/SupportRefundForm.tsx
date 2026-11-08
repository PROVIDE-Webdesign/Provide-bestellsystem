"use client";
import { useState, type FormEvent } from "react";
import {
  parseSupportRefundCommand,
  parseSupportRefundState,
  type SupportRefundCommand,
  type SupportRefundState,
} from "@provide/contracts";

const states = {
  queued: "Beauftragt",
  pending: "Bei Stripe in Bearbeitung",
  succeeded: "Bestätigt",
  failed: "Fehlgeschlagen",
  review: "Manuelle Prüfung nötig",
};
const reasons = {
  customer_request: "Kundenwunsch",
  missing_item: "Fehlende Position",
  service_issue: "Serviceproblem",
};
const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

export function SupportRefundForm(
  scope: Pick<SupportRefundCommand, "restaurantId" | "locationId" | "caseId">,
) {
  const [command, setCommand] = useState<SupportRefundCommand | null>(null);
  const [result, setResult] = useState<SupportRefundState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget),
      raw = f.get("amount"),
      value = (typeof raw === "string" ? raw : "").trim().replace(",", ".");
    if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(value)) {
      setMessage("Bitte einen gültigen Eurobetrag eingeben.");
      return;
    }
    const [whole, fraction = ""] = value.split(".");
    const next = parseSupportRefundCommand({
      action: "partial_refund",
      ...scope,
      requestId: crypto.randomUUID(),
      amountMinor: Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
      reason: f.get("reason"),
    });
    if (!next) {
      setMessage("Bitte Betrag und Grund prüfen.");
      return;
    }
    setCommand(next);
    setMessage("");
  }
  async function send() {
    if (!command || busy) return;
    setBusy(true);
    setSubmitted(true);
    setMessage("");
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        setMessage(
          response.status === 409
            ? "Der Auftrag passt nicht zum aktuellen Bestell- oder Zahlungsstand."
            : response.status === 403
              ? "Für diese Teilrückzahlung fehlt die Berechtigung."
              : "Antwort unklar. Derselbe Auftrag kann erneut abgefragt werden.",
        );
        return;
      }
      const envelope = (await response.json()) as { data?: unknown };
      const parsed = parseSupportRefundState(envelope.data, command);
      if (!parsed) throw Error("Invalid refund projection");
      setResult(parsed);
    } catch {
      setMessage("Antwort unklar. Derselbe Auftrag kann erneut abgefragt werden.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Test-Teilrückzahlung">
      <h3>Test-Teilrückzahlung</h3>
      {command ? (
        <>
          <p>
            {euro.format(command.amountMinor / 100)} · {reasons[command.reason]}
          </p>
          {result && <p role="status">{states[result.state]}</p>}
          {!result || result.state === "pending" || result.state === "queued" ? (
            <button type="button" disabled={busy} onClick={() => void send()}>
              {submitted ? "Auftrag erneut abfragen" : "Test-Teilrückzahlung beauftragen"}
            </button>
          ) : null}
          {(!submitted || result?.state === "failed" || result?.state === "succeeded") && (
            <button
              type="button"
              onClick={() => {
                setCommand(null);
                setResult(null);
                setMessage("");
                setSubmitted(false);
              }}
            >
              {submitted ? "Neuen Auftrag vorbereiten" : "Zurück"}
            </button>
          )}
        </>
      ) : (
        <form onSubmit={prepare} className="support-form">
          <label>
            Betrag in Euro
            <input name="amount" inputMode="decimal" required />
          </label>
          <label>
            Grund
            <select name="reason">
              {Object.entries(reasons).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button>Test-Teilrückzahlung prüfen</button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
