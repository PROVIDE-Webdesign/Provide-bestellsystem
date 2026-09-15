"use client";

import { parseDashboardAccessContext, type DashboardAccessContext } from "@provide/contracts";
import { useCallback, useEffect, useState } from "react";

import { createDashboardBrowserClient } from "@/lib/supabase-browser.js";
import { MfaPanel } from "./MfaPanel.js";

type ViewState =
  | { readonly name: "loading" }
  | { readonly name: "signed_out" }
  | { readonly name: "unavailable" }
  | { readonly name: "ready"; readonly context: DashboardAccessContext };

const roleLabels = { owner: "Inhaber", manager: "Manager", kitchen: "Küche", driver: "Fahrer" };

export function DashboardClient({ enabled }: { readonly enabled: boolean }) {
  const [state, setState] = useState<ViewState>({ name: "loading" });

  const load = useCallback(async () => {
    if (!enabled) {
      setState({ name: "unavailable" });
      return;
    }
    try {
      const response = await fetch("/api/access-context", { cache: "no-store" });
      if (response.status === 401) {
        setState({ name: "signed_out" });
        return;
      }
      if (!response.ok) throw new Error("Dashboard unavailable");
      const value = (await response.json()) as { data?: unknown };
      const context = parseDashboardAccessContext(value.data);
      if (!context) throw new Error("Dashboard response invalid");
      setState({ name: "ready", context });
    } catch {
      setState({ name: "unavailable" });
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  async function signOut() {
    const supabase = createDashboardBrowserClient();
    if (supabase) await supabase.auth.signOut();
    window.location.assign("/login");
  }

  if (state.name === "loading") return <p role="status">Zugriff wird sicher geprüft …</p>;
  if (state.name === "signed_out")
    return (
      <a className="primary-link" href="/login">
        Zur sicheren Anmeldung
      </a>
    );
  if (state.name === "unavailable")
    return <p role="alert">Das Dashboard ist derzeit sicher gesperrt oder nicht verfügbar.</p>;

  const memberships = state.context.memberships;
  const allowed = memberships.filter((membership) => membership.access === "allowed");
  const needsMfa = memberships.some((membership) => membership.access === "mfa_required");
  const suspended = memberships.some((membership) => membership.access === "suspended");

  return (
    <>
      <div className="toolbar">
        <span>Sicherheitsniveau: {state.context.aal.toUpperCase()}</span>
        <button type="button" className="secondary" onClick={() => void signOut()}>
          Abmelden
        </button>
      </div>
      {memberships.length === 0 && (
        <p>Für dieses Konto ist keine Restaurantmitgliedschaft hinterlegt.</p>
      )}
      {suspended && (
        <p className="warning">
          Eine Restaurantmitgliedschaft ist suspendiert und gewährt keinen Zugriff.
        </p>
      )}
      {needsMfa && <MfaPanel onVerified={() => window.location.reload()} />}
      {allowed.map((membership) => (
        <section className="panel" key={membership.restaurantId}>
          <p className="eyebrow">{roleLabels[membership.role]}</p>
          <h2>{membership.restaurant?.displayName}</h2>
          {membership.locations.length === 0 ? (
            <p>Dieser Rolle ist derzeit kein Standort zugewiesen.</p>
          ) : (
            <ul className="location-list">
              {membership.locations.map((location) => (
                <li key={location.id}>{location.displayName}</li>
              ))}
            </ul>
          )}
          <p className="notice">
            Bestellübersicht und Statusbearbeitung folgen in Arbeitsblock 3.6.
          </p>
        </section>
      ))}
    </>
  );
}
