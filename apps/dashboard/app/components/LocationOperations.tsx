"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseLocationOperationsCommand,
  parseLocationOperationsState,
  type LocationConfiguration,
  type LocationOperationsCommand,
  type LocationOperationsState,
  type OperationScope,
  type OperationValues,
} from "@provide/contracts";
const channelNames = { all: "Gesamter Standort", pickup: "Abholung", delivery: "Lieferung" };
const weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const defaults: LocationConfiguration = {
  minimumLeadMinutes: 15,
  maximumAdvanceDays: 14,
  slotIntervalMinutes: 15,
  defaultOrderCapacity: 10,
  defaultItemCapacity: 50,
  orderCutoffMinutes: 0,
  acceptanceMinutes: 5,
  maxOpenOrders: null,
  windows: [],
  exceptions: [],
  zones: [],
};
const emptyValues: OperationValues = {
  paused: false,
  leadMinutes: null,
  orderCapacity: null,
  itemCapacity: null,
  maxOpenOrders: null,
};
export function LocationOperations({
  restaurantId,
  locations,
}: {
  restaurantId: string;
  locations: readonly { id: string; displayName: string }[];
}) {
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  return (
    <section className="panel">
      <h3>Betriebssteuerung und Standortregeln</h3>
      <label>
        Standort für Betriebsregeln
        <select value={location} onChange={(e) => setLocation(e.target.value)}>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.displayName}
            </option>
          ))}
        </select>
      </label>
      {location && (
        <LocationOperationsEditor
          key={restaurantId + location}
          restaurantId={restaurantId}
          locationId={location}
        />
      )}
    </section>
  );
}
function LocationOperationsEditor({
  restaurantId,
  locationId,
}: {
  restaurantId: string;
  locationId: string;
}) {
  const [state, setState] = useState<LocationOperationsState | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [baseline, setBaseline] = useState<{
    publicationId: string | null;
    deliveryPolicyId: string | null;
  }>({ publicationId: null, deliveryPolicyId: null });
  const [selected, setSelected] = useState(""),
    [configuration, setConfiguration] = useState<LocationConfiguration>(defaults),
    [revision, setRevision] = useState(0),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [scope, setScope] = useState<OperationScope>("all"),
    [values, setValues] = useState<OperationValues>(emptyValues),
    [duration, setDuration] = useState(30),
    [operationReason, setOperationReason] = useState("");
  const [clock, setClock] = useState(Date.now());
  const requests = useRef(0),
    live = useRef(true),
    mutation = useRef(false),
    selectedRef = useRef("");
  const endpoint = `/api/operations?${new URLSearchParams({ restaurantId, locationId })}`;
  const applyVersion = useCallback((s: LocationOperationsState, id: string) => {
    const v = s.versions.find((v) => v.id === id);
    setBaseline({ publicationId: s.publicationId, deliveryPolicyId: s.deliveryPolicyId });
    selectedRef.current = id;
    setSelected(id);
    setConfiguration(v ? structuredClone(v.configuration) : defaults);
    setRevision(v?.revision ?? 0);
    setConfirmed(false);
  }, []);
  const refresh = useCallback(
    async (command: LocationOperationsCommand | null = null) => {
      if (mutation.current && !command) return;
      const request = ++requests.current;
      if (command) {
        mutation.current = true;
        setBusy(true);
        setMessage("");
      }
      try {
        const response = await fetch(endpoint, {
          method: command ? "POST" : "GET",
          headers: { "content-type": "application/json" },
          ...(command ? { body: JSON.stringify(command) } : {}),
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (!live.current || request !== requests.current) return;
        if (response.status === 401 || response.status === 403) {
          setState(null);
          setConfiguration(defaults);
          selectedRef.current = "";
          setSelected("");
          throw Error("Zugriff entzogen. Bitte Anmeldung und Berechtigung prüfen.");
        }
        if (!response.ok)
          throw Error(
            response.status === 409
              ? "Zwischenzeitliche Änderung: Stand neu laden und Änderungen erneut prüfen."
              : response.status === 400
                ? "Regeln konnten nicht übernommen werden. Zeiten, Werte und Überschneidungen prüfen."
                : "Betriebsregeln derzeit nicht erreichbar.",
          );
        const envelope = (await response.json()) as { data?: unknown };
        const data = parseLocationOperationsState(envelope.data);
        if (!data) throw Error("Ungültige Antwort. Bitte erneut laden.");
        if (!live.current || request !== requests.current) return;
        setState(data);
        if (command?.action === "create_draft") applyVersion(data, data.versions[0]?.id ?? "");
        else if (command?.action === "save_draft" || command?.action === "publish")
          applyVersion(data, command.versionId);
        else if (!selectedRef.current && data.versions.length)
          applyVersion(data, data.currentVersionId ?? data.versions[0]!.id);
        if (command)
          setMessage(
            command.action === "save_draft"
              ? "Entwurf gespeichert. Veröffentlichung steht noch aus."
              : command.action === "publish"
                ? "Standortregeln veröffentlicht."
                : command.action === "create_draft"
                  ? "Neuer Entwurf angelegt."
                  : "Betriebsänderung gespeichert.",
          );
      } catch (error) {
        if (live.current && request === requests.current)
          setMessage(
            error instanceof Error ? error.message : "Betriebsregeln derzeit nicht erreichbar.",
          );
      } finally {
        if (command) {
          mutation.current = false;
          if (live.current) setBusy(false);
        }
      }
    },
    [endpoint, applyVersion],
  );
  useEffect(() => {
    live.current = true;
    void refresh();
    const interval = setInterval(() => void refresh(), 15000),
      timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      live.current = false;
      requests.current++;
      clearInterval(interval);
      clearInterval(timer);
    };
  }, [refresh]);
  const version = state?.versions.find((v) => v.id === selected),
    editable = version?.status === "draft";
  const dirty = version && JSON.stringify(version.configuration) !== JSON.stringify(configuration);
  const serverClock = state
    ? Date.parse(state.serverNow) + (clock - Date.parse(state.serverNow))
    : clock;
  // Server offset is measured on every successful response, rather than trusting the device clock.
  const received = useRef({ now: Date.now(), server: Date.now() });
  useEffect(() => {
    if (state) received.current = { now: Date.now(), server: Date.parse(state.serverNow) };
  }, [state]);
  const actualServerClock = received.current.server + (serverClock - received.current.now);
  async function execute(value: unknown) {
    const command = parseLocationOperationsCommand(value);
    if (!command) {
      setMessage(
        "Bitte Grund, gültige Zeiten und ganze Werte eintragen; Liefergebiete dürfen sich nicht überschneiden.",
      );
      return;
    }
    await refresh(command);
  }
  function numberField(
    label: string,
    key: keyof Pick<
      LocationConfiguration,
      | "minimumLeadMinutes"
      | "maximumAdvanceDays"
      | "slotIntervalMinutes"
      | "defaultOrderCapacity"
      | "defaultItemCapacity"
      | "orderCutoffMinutes"
      | "acceptanceMinutes"
      | "maxOpenOrders"
    >,
    optional = false,
  ) {
    return (
      <label key={key}>
        {label}
        <input
          type="number"
          min={optional ? 1 : 0}
          step="1"
          disabled={!editable || busy}
          value={configuration[key] ?? ""}
          onChange={(e) => {
            setConfirmed(false);
            setConfiguration({
              ...configuration,
              [key]: optional && e.target.value === "" ? null : Number(e.target.value),
            });
          }}
        />
        {optional && <small>Leer = keine eigene Grenze</small>}
      </label>
    );
  }
  return (
    <div className="location-operations">
      <p role="status" aria-live="polite">
        {message}
      </p>
      <button type="button" className="secondary" disabled={busy} onClick={() => void refresh()}>
        Stand aktualisieren
      </button>
      {!state ? (
        <p>Standortregeln werden geladen oder sind gesperrt.</p>
      ) : (
        <>
          <p>
            Zeitzone: {state.timezone} · Offene Bestellungen: <strong>{state.openOrders}</strong>
          </p>
          <fieldset disabled={busy}>
            <legend>Temporärer Betriebsmodus</legend>
            <p>
              Eine vollständige Pause gilt für beide Kanäle. Bestehende Bestellungen werden
              weiterbearbeitet. Temporäre Werte enden automatisch, spätestens nach 24 Stunden.
            </p>
            <label>
              Geltungsbereich
              <select value={scope} onChange={(e) => setScope(e.target.value as OperationScope)}>
                {Object.entries(channelNames).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={values.paused}
                onChange={(e) => setValues({ ...values, paused: e.target.checked })}
              />{" "}
              Neue Bestellungen pausieren
            </label>
            {(
              [
                ["leadMinutes", "Vorlauf in Minuten"],
                ["orderCapacity", "Bestellungen pro Slot"],
                ["itemCapacity", "Artikel pro Slot"],
                ["maxOpenOrders", "Maximal offene Bestellungen"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={key === "leadMinutes" ? 0 : 1}
                  step="1"
                  value={values[key] ?? ""}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [key]: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <small>Leer = reguläre Regel übernehmen</small>
              </label>
            ))}
            <label>
              Dauer in Minuten
              <input
                type="number"
                min="1"
                max="1440"
                step="1"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
            <label>
              Grund der Betriebsänderung
              <input
                maxLength={300}
                value={operationReason}
                onChange={(e) => setOperationReason(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                !Number.isInteger(duration) ||
                duration < 1 ||
                duration > 1440 ||
                !operationReason.trim()
              }
              onClick={() =>
                void execute({
                  action: "override",
                  scope,
                  expectedSequence: state.operationSequence,
                  endsAt: new Date(actualServerClock + duration * 60000).toISOString(),
                  values,
                  reason: operationReason,
                })
              }
            >
              Betriebsmodus anwenden
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!operationReason.trim()}
              onClick={() =>
                void execute({
                  action: "clear_override",
                  scope,
                  expectedSequence: state.operationSequence,
                  reason: operationReason,
                })
              }
            >
              Temporäre Regel dieses Bereichs beenden
            </button>
          </fieldset>
          <ul>
            {state.overrides.map((o) => (
              <li key={o.scope}>
                <strong>{channelNames[o.scope]}</strong>:{" "}
                {o.values.paused ? "pausiert" : "temporäre Werte"} · {o.reason} ·{" "}
                {Math.max(0, Math.ceil((Date.parse(o.endsAt) - actualServerClock) / 60000))} Minuten
                verbleibend
                {o.values.leadMinutes !== null && ` · Vorlauf ${o.values.leadMinutes} Min.`}
                {o.values.orderCapacity !== null &&
                  ` · ${o.values.orderCapacity} Bestellungen/Slot`}
                {o.values.itemCapacity !== null && ` · ${o.values.itemCapacity} Artikel/Slot`}
                {o.values.maxOpenOrders !== null && ` · höchstens ${o.values.maxOpenOrders} offen`}
              </li>
            ))}
          </ul>
          <fieldset disabled={busy}>
            <legend>Versionierte Standortkonfiguration</legend>
            <label>
              Konfigurationsversion
              <select value={selected} onChange={(e) => applyVersion(state, e.target.value)}>
                {state.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    Version {v.number} · {v.status === "draft" ? "Entwurf" : "veröffentlicht"}
                    {v.id === state.currentVersionId ? " · aktuell wirksam" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Änderungsgrund
              <input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={!reason.trim()}
              onClick={() =>
                void execute({
                  action: "create_draft",
                  sourceVersionId: version?.status === "published" ? version.id : null,
                  reason,
                })
              }
            >
              Neuen Entwurf anlegen
            </button>
            {version && (
              <>
                <p>
                  {editable
                    ? "Änderungen bleiben bis zur bewussten Veröffentlichung im Entwurf."
                    : "Veröffentlichte Regeln sind unveränderlich. Für Änderungen einen neuen Entwurf anlegen."}
                </p>
                <div className="operations-fields">
                  {numberField("Vorlauf in Minuten", "minimumLeadMinutes")}
                  {numberField("Bestellhorizont in Tagen", "maximumAdvanceDays")}
                  {numberField("Slotlänge in Minuten", "slotIntervalMinutes")}
                  {numberField("Bestellungen pro Slot", "defaultOrderCapacity", true)}
                  {numberField("Artikel pro Slot", "defaultItemCapacity", true)}
                  {numberField("Bestellschluss: Minuten vor Fensterende", "orderCutoffMinutes")}
                  {numberField("Annahmefrist neuer Bestellungen in Minuten", "acceptanceMinutes")}
                  {numberField("Maximal offene Bestellungen am Standort", "maxOpenOrders", true)}
                </div>
                <h4>Reguläre Öffnungsfenster</h4>
                <p>
                  Fenster mit einer früheren Endzeit laufen über Mitternacht. 00:00–00:00 ist kein
                  gültiges Fenster.
                </p>
                {configuration.windows.map((w, i) => (
                  <fieldset key={i} disabled={!editable}>
                    <legend>Öffnungsfenster {i + 1}</legend>
                    <label>
                      Kanal
                      <select
                        value={w.fulfillment}
                        onChange={(e) =>
                          setConfiguration({
                            ...configuration,
                            windows: configuration.windows.map((x, j) =>
                              j === i
                                ? { ...x, fulfillment: e.target.value as "pickup" | "delivery" }
                                : x,
                            ),
                          })
                        }
                      >
                        <option value="pickup">Abholung</option>
                        <option value="delivery">Lieferung</option>
                      </select>
                    </label>
                    <label>
                      Wochentag
                      <select
                        value={w.weekday}
                        onChange={(e) =>
                          setConfiguration({
                            ...configuration,
                            windows: configuration.windows.map((x, j) =>
                              j === i ? { ...x, weekday: Number(e.target.value) } : x,
                            ),
                          })
                        }
                      >
                        {weekdays.map((d, n) => (
                          <option key={d} value={n}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(["opensAt", "closesAt"] as const).map((k) => (
                      <label key={k}>
                        {k === "opensAt" ? "Öffnet" : "Schließt"}
                        <input
                          type="time"
                          value={w[k]}
                          onChange={(e) =>
                            setConfiguration({
                              ...configuration,
                              windows: configuration.windows.map((x, j) =>
                                j === i ? { ...x, [k]: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                    {(["orderCapacity", "itemCapacity"] as const).map((k) => (
                      <label key={k}>
                        {k === "orderCapacity" ? "Bestellungen pro Slot" : "Artikel pro Slot"}
                        <input
                          type="number"
                          min="1"
                          value={w[k] ?? ""}
                          onChange={(e) =>
                            setConfiguration({
                              ...configuration,
                              windows: configuration.windows.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      [k]: e.target.value === "" ? null : Number(e.target.value),
                                    }
                                  : x,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        setConfiguration({
                          ...configuration,
                          windows: configuration.windows.filter((_, j) => j !== i),
                        })
                      }
                    >
                      Öffnungsfenster entfernen
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() =>
                    setConfiguration({
                      ...configuration,
                      windows: [
                        ...configuration.windows,
                        {
                          fulfillment: "pickup",
                          weekday: 1,
                          opensAt: "12:00",
                          closesAt: "22:00",
                          orderCapacity: null,
                          itemCapacity: null,
                        },
                      ],
                    })
                  }
                >
                  Öffnungsfenster hinzufügen
                </button>
                <h4>Sondertage</h4>
                {configuration.exceptions.map((e, i) => (
                  <fieldset key={i} disabled={!editable}>
                    <legend>Sondertag {i + 1}</legend>
                    <label>
                      Kanal
                      <select
                        value={e.fulfillment}
                        onChange={(v) =>
                          setConfiguration({
                            ...configuration,
                            exceptions: configuration.exceptions.map((x, j) =>
                              j === i
                                ? { ...x, fulfillment: v.target.value as "pickup" | "delivery" }
                                : x,
                            ),
                          })
                        }
                      >
                        <option value="pickup">Abholung</option>
                        <option value="delivery">Lieferung</option>
                      </select>
                    </label>
                    <label>
                      Datum
                      <input
                        type="date"
                        value={e.date}
                        onChange={(v) =>
                          setConfiguration({
                            ...configuration,
                            exceptions: configuration.exceptions.map((x, j) =>
                              j === i ? { ...x, date: v.target.value } : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={e.closed}
                        onChange={(v) =>
                          setConfiguration({
                            ...configuration,
                            exceptions: configuration.exceptions.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    closed: v.target.checked,
                                    opensAt: v.target.checked ? null : "12:00",
                                    closesAt: v.target.checked ? null : "22:00",
                                  }
                                : x,
                            ),
                          })
                        }
                      />{" "}
                      Geschlossen
                    </label>
                    {!e.closed &&
                      (["opensAt", "closesAt"] as const).map((k) => (
                        <label key={k}>
                          {k === "opensAt" ? "Öffnet" : "Schließt"}
                          <input
                            type="time"
                            value={e[k] ?? ""}
                            onChange={(v) =>
                              setConfiguration({
                                ...configuration,
                                exceptions: configuration.exceptions.map((x, j) =>
                                  j === i ? { ...x, [k]: v.target.value } : x,
                                ),
                              })
                            }
                          />
                        </label>
                      ))}
                    {(["orderCapacity", "itemCapacity"] as const).map((k) => (
                      <label key={k}>
                        {k === "orderCapacity" ? "Bestellungen pro Slot" : "Artikel pro Slot"}
                        <input
                          type="number"
                          min="1"
                          value={e[k] ?? ""}
                          onChange={(v) =>
                            setConfiguration({
                              ...configuration,
                              exceptions: configuration.exceptions.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      [k]: v.target.value === "" ? null : Number(v.target.value),
                                    }
                                  : x,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      Grund
                      <input
                        value={e.reason}
                        onChange={(v) =>
                          setConfiguration({
                            ...configuration,
                            exceptions: configuration.exceptions.map((x, j) =>
                              j === i ? { ...x, reason: v.target.value } : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        setConfiguration({
                          ...configuration,
                          exceptions: configuration.exceptions.filter((_, j) => j !== i),
                        })
                      }
                    >
                      Sondertag entfernen
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() =>
                    setConfiguration({
                      ...configuration,
                      exceptions: [
                        ...configuration.exceptions,
                        {
                          fulfillment: "pickup",
                          date: "",
                          closed: true,
                          opensAt: null,
                          closesAt: null,
                          reason: "",
                          orderCapacity: null,
                          itemCapacity: null,
                        },
                      ],
                    })
                  }
                >
                  Sondertag hinzufügen
                </button>
                <h4>Liefergebiete, Mindestwerte und Gebühren</h4>
                <p>
                  Beträge in Cent; 100 Cent entsprechen 1 Euro. Die Liefergebühr zählt nicht zum
                  Mindestwert.
                </p>
                {configuration.zones.map((z, i) => (
                  <fieldset key={i} disabled={!editable}>
                    <legend>Liefergebiet {i + 1}</legend>
                    <label>
                      Postleitzahlen, durch Komma getrennt
                      <input
                        value={z.postalCodes.join(", ")}
                        onChange={(e) =>
                          setConfiguration({
                            ...configuration,
                            zones: configuration.zones.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    postalCodes: e.target.value.split(",").map((p) => p.trim()),
                                  }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    {(["minimumAmountMinor", "feeAmountMinor"] as const).map((k) => (
                      <label key={k}>
                        {k === "minimumAmountMinor"
                          ? "Mindestartikelwert in Cent"
                          : "Liefergebühr in Cent"}
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={z[k]}
                          onChange={(e) =>
                            setConfiguration({
                              ...configuration,
                              zones: configuration.zones.map((x, j) =>
                                j === i ? { ...x, [k]: Number(e.target.value) } : x,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        setConfiguration({
                          ...configuration,
                          zones: configuration.zones.filter((_, j) => j !== i),
                        })
                      }
                    >
                      Liefergebiet entfernen
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() =>
                    setConfiguration({
                      ...configuration,
                      zones: [
                        ...configuration.zones,
                        { postalCodes: [], minimumAmountMinor: 0, feeAmountMinor: 0 },
                      ],
                    })
                  }
                >
                  Liefergebiet hinzufügen
                </button>
                <p>
                  Auswahl: Version {version.number} · {configuration.windows.length} Öffnungsfenster
                  · {configuration.exceptions.length} Sondertage · {configuration.zones.length}{" "}
                  Liefergebiete.
                </p>
                {dirty && (
                  <p className="warning">
                    Ungespeicherte Änderungen. Vor Veröffentlichung zuerst speichern.
                  </p>
                )}
                <button
                  type="button"
                  disabled={!editable || !reason.trim()}
                  onClick={() =>
                    void execute({
                      action: "save_draft",
                      versionId: version.id,
                      expectedRevision: revision,
                      configuration,
                      reason,
                    })
                  }
                >
                  Konfigurationsentwurf speichern
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={!!dirty}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{" "}
                  Ausgewählte Zeiten, Kapazitäten und Lieferpreise geprüft; diese Version soll
                  sofort wirksam werden.
                </label>
                <button
                  type="button"
                  disabled={!confirmed || !!dirty || !reason.trim()}
                  onClick={() =>
                    void execute({
                      action: "publish",
                      versionId: version.id,
                      expectedRevision: revision,
                      expectedPublicationId: baseline.publicationId,
                      expectedDeliveryPolicyId: baseline.deliveryPolicyId,
                      reason,
                    })
                  }
                >
                  {editable
                    ? "Standortregeln veröffentlichen"
                    : "Diese Version erneut veröffentlichen"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => applyVersion(state, selected)}
                >
                  Aktuellen Versionsstand übernehmen
                </button>
              </>
            )}
          </fieldset>
          <h4>Letzte Betriebsänderungen</h4>
          <ul>
            {state.audit.map((a) => (
              <li key={a.id}>
                {new Date(a.createdAt).toLocaleString("de-DE", { timeZone: state.timezone })} ·{" "}
                {(
                  {
                    create_draft: "Entwurf angelegt",
                    save_draft: "Entwurf gespeichert",
                    publish: "Veröffentlicht",
                    override: "Betriebsmodus geändert",
                    clear_override: "Temporäre Regel beendet",
                  } as Record<string, string>
                )[a.action] ?? a.action}{" "}
                · {a.reason} · Bearbeiter {a.actorId}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
