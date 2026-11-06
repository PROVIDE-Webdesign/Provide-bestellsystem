"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseLocationOperationsState,
  type LocationOperationsState,
  type DashboardLocationAccess,
} from "@provide/contracts";
import {
  todayOpening,
  preparedSettingsChanges,
  type SettingsTopic,
} from "../../lib/management-ui.js";
import { LocationOperations } from "./LocationOperations.js";
import { Personnel } from "./Personnel.js";
import { OperatorIcon } from "./OperatorVisuals.js";
export function OperatorSettings({
  restaurantId,
  locations,
  roleLabel,
  aal,
  operationsEnabled,
  personnelEnabled,
  canManage,
  onSignOut,
  onDirtyChange,
}: {
  restaurantId: string;
  locations: readonly DashboardLocationAccess[];
  roleLabel: string;
  aal: string;
  operationsEnabled: boolean;
  personnelEnabled: boolean;
  canManage: boolean;
  onSignOut: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [locationId, setLocation] = useState(locations[0]?.id ?? "");
  const [topic, setTopic] = useState<SettingsTopic | "account" | null>(null);
  const [state, setState] = useState<LocationOperationsState | null>(null);
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(Date.now());
  const received = useRef(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!operationsEnabled || !canManage || !locationId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(
        `/api/operations?${new URLSearchParams({ restaurantId, locationId })}`,
        {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        },
      );
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setState(null);
        throw Error(
          response.status === 401 || response.status === 403
            ? "Zugriff nicht mehr bestätigt. Bitte neu anmelden."
            : "Standortregeln konnten nicht geladen werden.",
        );
      }
      const body = (await response.json()) as { data?: unknown };
      const parsed = parseLocationOperationsState(body.data);
      if (!parsed) throw Error("Ungültige Standortregeln.");
      if (!controller.signal.aborted) {
        received.current = Date.now();
        setTick(Date.now());
        setState(parsed);
        setMessage("");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setState(null);
        setMessage(
          error instanceof Error ? error.message : "Standortregeln derzeit nicht erreichbar.",
        );
      }
    }
  }, [restaurantId, locationId, operationsEnabled, canManage]);
  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);
  const close = () => {
    setTopic(null);
    onDirtyChange(false);
    void load();
  };
  const config = state?.versions.find(
    (version) => version.id === state.currentVersionId,
  )?.configuration;
  const clock = state ? Date.parse(state.serverNow) + tick - received.current : tick;
  const overrides = state?.overrides.filter((item) => Date.parse(item.endsAt) > clock) ?? [];
  const all = overrides.find((item) => item.scope === "all");
  const paused = all?.values.paused;
  const lead = all?.values.leadMinutes ?? config?.minimumLeadMinutes;
  const capacity = all?.values.orderCapacity ?? config?.defaultOrderCapacity;
  const changes = preparedSettingsChanges(state);
  const topics = [
    {
      id: "acceptance",
      icon: "store",
      title: "Bestellannahme",
      summary: !state
        ? "Stand wird geladen …"
        : !config
          ? "Regeln ausstehend"
          : `${paused ? "Pausiert" : overrides.some((item) => item.values.paused) ? "Teilweise pausiert" : "Aktiv"} · ${lead ?? "–"} Min. Vorlauf`,
    },
    {
      id: "hours",
      icon: "clock",
      title: "Öffnungszeiten",
      summary: state ? todayOpening(config, state.timezone, clock) : "Stand wird geladen …",
    },
    {
      id: "capacity",
      icon: "layers",
      title: "Kapazitäten",
      summary: config
        ? `${capacity ?? "Unbegrenzt"}${capacity ? " Bestellungen" : ""} je ${config.slotIntervalMinutes} Min.`
        : "Regeln ausstehend",
    },
    {
      id: "delivery",
      icon: "delivery",
      title: "Lieferung",
      summary: config ? `${config.zones.length} Liefergebiete` : "Regeln ausstehend",
    },
    {
      id: "exceptions",
      icon: "calendar",
      title: "Sondertage",
      summary: config
        ? (() => {
            const date = new Intl.DateTimeFormat("sv-SE", {
              timeZone: state.timezone,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(clock);
            const count = config.exceptions.filter((item) => item.date >= date).length;
            return count ? `${count} Ausnahmen geplant` : "Keine Ausnahme geplant";
          })()
        : "Regeln ausstehend",
    },
  ] as const;
  return (
    <section className="settings-workbench">
      {!topic && (
        <>
          {canManage && operationsEnabled && (
            <>
              <label className="settings-location">
                <span className="sr-only">Standort</span>
                <select
                  aria-label="Standort"
                  value={locationId}
                  onChange={(event) => {
                    setState(null);
                    setLocation(event.target.value);
                  }}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      Standort: {location.displayName}
                    </option>
                  ))}
                </select>
              </label>
              {message && (
                <p role="alert" className="management-message">
                  {message}
                  <button type="button" onClick={() => void load()}>
                    Erneut laden
                  </button>
                </p>
              )}
            </>
          )}
          <div className="settings-topic-list">
            {canManage &&
              operationsEnabled &&
              topics.map((item) => (
                <button
                  type="button"
                  className="settings-topic"
                  key={item.id}
                  disabled={!state}
                  onClick={() => setTopic(item.id)}
                >
                  <OperatorIcon name={item.icon} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.summary}</small>
                  </span>
                  <span className="management-chevron"><OperatorIcon name="chevron" /></span>
                </button>
              ))}
            <button type="button" className="settings-topic" onClick={() => setTopic("account")}>
              <OperatorIcon name="user" />
              <span>
                <strong>Mein Zugang</strong>
                <small>{roleLabel}</small>
              </span>
              <span className="management-chevron"><OperatorIcon name="chevron" /></span>
            </button>
          </div>
          {changes > 0 && (
            <div className="settings-publication">
              <OperatorIcon name="document" />
              <strong>{changes} Änderungen vorbereitet</strong>
              <button type="button" onClick={() => setTopic("publication")}>
                Änderungen prüfen
              </button>
            </div>
          )}
        </>
      )}
      {topic === "account" && (
        <div className="management-editor">
          <button type="button" className="secondary" onClick={close}>
            ‹ Zur Übersicht
          </button>
          <h2>Mein Zugang</h2>
          <p>
            {roleLabel} · Sicherheitsniveau {aal.toUpperCase()}
          </p>
          <button type="button" className="secondary" onClick={onSignOut}>
            Abmelden
          </button>
          {personnelEnabled && (
            <p>
              <a href="/invitations">Meine Einladungen</a>
            </p>
          )}
          {personnelEnabled && canManage && <Personnel restaurantId={restaurantId} />}
        </div>
      )}
      {topic && topic !== "account" && canManage && operationsEnabled && (
        <LocationOperations
          key={restaurantId + locationId}
          restaurantId={restaurantId}
          locations={locations.filter((location) => location.id === locationId)}
          topic={topic}
          onClose={close}
          onDirtyChange={onDirtyChange}
        />
      )}
    </section>
  );
}
