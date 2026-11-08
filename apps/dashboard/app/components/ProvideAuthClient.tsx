"use client";
import { useEffect, useState } from "react";
import { createDashboardBrowserClient } from "@/lib/supabase-browser.js";
import { LoginForm } from "./LoginForm.js";
import { MfaPanel } from "./MfaPanel.js";
import { ProvideAdmin } from "./ProvideAdmin.js";
import { SupportCases } from "./SupportCases.js";
export function ProvideAuthClient({ support = false }: { support?: boolean }) {
  const [nonce, setNonce] = useState(0),
    [state, setState] = useState<"checking" | "login" | "mfa" | "ready">("checking");
  useEffect(() => {
    let current = true;
    setState("checking");
    const client = createDashboardBrowserClient();
    if (!client) {
      setState("login");
      return;
    }
    void (async () => {
      try {
        const claims = await client.auth.getClaims();
        if (!current) return;
        if (claims.error || !claims.data?.claims?.sub) {
          setState("login");
          return;
        }
        const level = await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if (current) setState(!level.error && level.data.currentLevel === "aal2" ? "ready" : "mfa");
      } catch {
        if (current) setState("login");
      }
    })();
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "USER_UPDATED" || event === "SIGNED_IN") {
        setState("checking");
        setNonce((n) => n + 1);
      }
    });
    return () => {
      current = false;
      data.subscription.unsubscribe();
    };
  }, [nonce]);
  if (state === "checking") return <p role="status">Sitzung wird geprüft …</p>;
  if (state === "login")
    return <LoginForm enabled returnTo={support ? "/provide/support" : "/provide"} />;
  if (state === "mfa") return <MfaPanel onVerified={() => setNonce((n) => n + 1)} />;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setState("checking");
          void createDashboardBrowserClient()
            ?.auth.signOut()
            .catch(() => undefined)
            .finally(() => setNonce((n) => n + 1));
        }}
      >
        Abmelden
      </button>
      {support ? <SupportCases /> : <ProvideAdmin />}
    </>
  );
}
