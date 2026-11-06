"use client";
import { OrderHistory } from "./OrderHistory.js";
import { OperatorSettings } from "./OperatorSettings.js";
import { LocationOperations } from "./LocationOperations.js";
import { MenuEditor } from "./MenuEditor.js";

import { parseDashboardAccessContext, type DashboardAccessContext } from "@provide/contracts";
import { useCallback, useEffect, useState } from "react";

import { createDashboardBrowserClient } from "../../lib/supabase-browser.js";
import { MfaPanel } from "./MfaPanel.js";
import { OperatorIcon } from "./OperatorVisuals.js";
import { OrderBoard } from "./OrderBoard.js";

type ViewState =
  | { readonly name: "loading" }
  | { readonly name: "signed_out" }
  | { readonly name: "unavailable" }
  | { readonly name: "ready"; readonly context: DashboardAccessContext };

const roleLabels = {
  owner: "Inhaber",
  manager: "Manager",
  kitchen: "Küche",
  driver: "Fahrer",
  viewer: "Viewer · nur lesen",
};

export function DashboardClient({
  enabled,
  menuEnabled = false,
  operationsEnabled = false,
  liveEnabled = false,
  alertsEnabled = false,
  historyEnabled = false,
  personnelEnabled = false,
}: {
  readonly enabled: boolean;
  readonly menuEnabled?: boolean;
  readonly operationsEnabled?: boolean;
  readonly liveEnabled?: boolean;
  readonly alertsEnabled?: boolean;
  readonly historyEnabled?: boolean;
  readonly personnelEnabled?: boolean;
}) {
  const [unsaved, setUnsaved] = useState(false);
  const canLeave = () => !unsaved || window.confirm("Ungespeicherte Änderungen verwerfen?");
  const [section, setSection] = useState("Bestellungen");
  const [restaurant, setRestaurant] = useState("");
  const [location, setLocation] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
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

  const membership = allowed.find((item) => item.restaurantId === restaurant) ?? allowed[0];
  const selectedLocation =
    membership?.locations.find((item) => item.id === location) ?? membership?.locations[0];
  const canManage = membership && ["owner", "manager"].includes(membership.role);
  const navigation = [
    { name: "Bestellungen", icon: "bag", enabled: true },
    { name: "Speisekarte", icon: "menu", enabled: menuEnabled && canManage },
    { name: "Verlauf", icon: "history", enabled: historyEnabled && canManage },
    { name: "Einstellungen", icon: "settings", enabled: true },
  ];
  return (
    <div
      className={`operator-shell ${["Speisekarte", "Einstellungen"].includes(section) ? `operator-management ${section === "Einstellungen" ? "operator-settings-view" : ""}` : ""}`}
    >
      <header className="operator-header">
        <strong className="operator-brand">{section === "Speisekarte" && <svg className="provide-bowl" viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 23h47c-1 14-9 21-23 21S8 37 5 23Z"/><path d="m30 23 19-22m-10 22 17-18M21 46h17"/></svg>}PROVIDE</strong>
        <select
          aria-label="Restaurant wählen"
          value={membership?.restaurantId ?? ""}
          onChange={(event) => {
            if (!canLeave()) return;
            setUnsaved(false);
            setRestaurant(event.target.value);
            setLocation("");
          }}
        >
          {allowed.map((item) => (
            <option key={item.restaurantId} value={item.restaurantId}>
              {item.restaurant?.displayName}
            </option>
          ))}
        </select>
        <span className="operator-view-label">Bestellübersicht</span>
        <div className="operator-header-actions">
          {operationsEnabled && canManage && membership && selectedLocation && (
            <LocationOperations
              key={membership.restaurantId + selectedLocation.id}
              compact
              restaurantId={membership.restaurantId}
              locations={[selectedLocation]}
            />
          )}
          {membership && <div id={`operator-inbox-${membership.restaurantId}`} />}
          <time>
            {new Intl.DateTimeFormat("de-DE", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Europe/Berlin",
            }).format(clock)}
          </time>
        </div>
      </header>
      <nav className="operator-sidebar" aria-label="Restaurantverwaltung">
        {navigation
          .filter((item) => item.enabled)
          .map((item) => (
            <button
              type="button"
              key={item.name}
              aria-current={section === item.name ? "page" : undefined}
              onClick={() => {
                if (item.name !== section && canLeave()) {
                  setUnsaved(false);
                  setSection(item.name);
                }
              }}
            >
              <OperatorIcon name={item.name === "Bestellungen" ? "clipboard" : item.icon} />
              <span>{item.name}</span>
            </button>
          ))}
      </nav>
      <div className="operator-content">
        <h1>{section}</h1>
        {memberships.length === 0 && (
          <p>Für dieses Konto ist keine Restaurantmitgliedschaft hinterlegt.</p>
        )}
        {suspended && (
          <p className="warning">
            Eine Restaurantmitgliedschaft ist suspendiert und gewährt keinen Zugriff.
          </p>
        )}
        {needsMfa && <MfaPanel onVerified={() => window.location.reload()} />}
        {membership && (
          <>
            <div hidden={section !== "Bestellungen"}>
              <OrderBoard
                key={membership.restaurantId + selectedLocation?.id}
                liveEnabled={liveEnabled}
                alertsEnabled={alertsEnabled}
                restaurantId={membership.restaurantId}
                role={membership.role}
                locations={membership.locations}
                {...(selectedLocation ? { initialLocationId: selectedLocation.id } : {})}
                onLocationChange={setLocation}
              />
            </div>
            {section === "Speisekarte" && menuEnabled && canManage && (
              <MenuEditor
                key={membership.restaurantId}
                restaurantId={membership.restaurantId}
                locations={membership.locations}
                onDirtyChange={setUnsaved}
              />
            )}
            {section === "Verlauf" && historyEnabled && canManage && (
              <OrderHistory
                key={membership.restaurantId}
                restaurantId={membership.restaurantId}
                locations={membership.locations}
              />
            )}
            {section === "Einstellungen" && (
              <OperatorSettings
                key={membership.restaurantId}
                restaurantId={membership.restaurantId}
                locations={membership.locations}
                roleLabel={roleLabels[membership.role]}
                aal={state.context.aal}
                operationsEnabled={operationsEnabled}
                personnelEnabled={personnelEnabled}
                canManage={!!canManage}
                onSignOut={() => void signOut()}
                onDirtyChange={setUnsaved}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
