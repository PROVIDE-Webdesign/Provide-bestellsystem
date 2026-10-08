"use client";
import { useEffect, useRef, useState } from "react";
interface Turnstile {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      cData: string;
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
      "response-field": false;
    },
  ): string;
  remove(id: string): void;
}
let loading: Promise<Turnstile> | null = null;
function loadTurnstile(): Promise<Turnstile> {
  const host = window as Window & { turnstile?: Turnstile };
  if (host.turnstile) return Promise.resolve(host.turnstile);
  if (loading) return loading;
  loading = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () =>
      host.turnstile ? resolve(host.turnstile) : reject(Error("Challenge unavailable"));
    script.onerror = () => reject(Error("Challenge unavailable"));
    document.head.append(script);
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}
export default function CheckoutChallenge({
  siteKey,
  issueId,
  onToken,
}: {
  siteKey: string;
  issueId: string;
  onToken: (token: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [message, setMessage] = useState("Sicherheitsprüfung wird geladen …");
  useEffect(() => {
    let disposed = false,
      id: string | undefined,
      api: Turnstile | undefined;
    void loadTurnstile()
      .then((value) => {
        if (disposed || !container.current) return;
        api = value;
        id = value.render(container.current, {
          sitekey: siteKey,
          action: "checkout_issue",
          cData: issueId,
          "response-field": false,
          callback: (token) => {
            setMessage("Sicherheitsprüfung bestätigt.");
            callback.current(token);
          },
          "error-callback": () => {
            setMessage("Sicherheitsprüfung nicht verfügbar. Dein Warenkorb bleibt erhalten.");
            callback.current(null);
          },
          "expired-callback": () => {
            setMessage("Sicherheitsprüfung abgelaufen. Bitte starte sie erneut.");
            callback.current(null);
          },
        });
      })
      .catch(() => {
        if (!disposed)
          setMessage("Sicherheitsprüfung nicht verfügbar. Dein Warenkorb bleibt erhalten.");
      });
    return () => {
      disposed = true;
      if (id && api) api.remove(id);
    };
  }, [siteKey, issueId]);
  return (
    <section aria-label="Sicherheitsprüfung für diese Bestellung">
      <div ref={container} />
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
