"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  parseProvideAdminCommand,
  parseProvideAdminState,
  type ProvideAdminCommand,
  type ProvideAdminState,
} from "@provide/contracts";
const checkLabels: Record<string, string> = {
  "restaurant.profile": "Mandantenprofil",
  "restaurant.owner": "Verantwortlicher Owner",
  "restaurant.legal": "Betreiber und Rechtstexte",
  "restaurant.operations": "Betriebsfreigabe",
  "restaurant.payment": "Händlerrolle, Zahlungen und Auszahlung",
  "restaurant.privacy": "Datenschutz und Aufbewahrung",
  "restaurant.domain": "Produktive Domain",
  "restaurant.region": "Datenregion Frankfurt",
  "restaurant.responsible": "Verantwortung und Eskalation",
  "location.profile": "Standortprofil",
  "location.address": "Vollständige Standortadresse",
  "location.fulfillment": "Abholung und Lieferung",
  "location.operations": "Standortbetrieb",
  "location.menu": "Menü, Preise, Steuern und Allergene",
  "location.schedule": "Zeiten, Bestellschluss und Kapazität",
  "location.delivery": "Liefergebiet, Mindestwert und Gebühren",
  "location.payment": "Zahlungsarten und Anbieter",
  "location.email": "Absender und Bestellnachrichten",
  "location.test_order": "Testbestellungen",
  "location.refund_test": "Erstattungsfall oder Nichtanwendbarkeit",
  "location.training": "Personal, Geräte und Schulung",
};
const featureLabels: Record<string, string> = {
  "ordering.accept_orders": "Neue Bestellungen",
  "fulfillment.pickup": "Abholung",
  "fulfillment.delivery": "Lieferung",
  "payment.online": "Onlinezahlung",
  "catalog.public_menu": "Öffentliche Speisekarte",
};
const labels: Record<string, string> = {
  not_started: "Noch nicht begonnen",
  in_progress: "In Prüfung",
  ready_for_review: "Bereit zur Freigabe",
  approved: "Freigegeben",
  blocked: "Gesperrt",
  ready: "Startbereit",
  live: "Live",
  paused: "Pausiert",
  setup: "Erfassung",
  active: "Aktiv",
  suspended: "Suspendiert",
  pending: "Offen",
  passed: "Bestanden",
  failed: "Nicht bestanden",
};
type Read = Extract<ProvideAdminCommand, { action: "read" }>;
type Action = Exclude<ProvideAdminCommand["action"], "read" | "createRestaurant">;
const date = (value: string) => new Date(value).toLocaleString("de-DE");
function localTime(value: string) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}
export function ProvideAdmin() {
  const [data, setData] = useState<ProvideAdminState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [query, setQuery] = useState<Read>({ action: "read" }),
    [action, setAction] = useState<Action>("check"),
    [checkKey, setCheckKey] = useState(""),
    [featureKey, setFeatureKey] = useState("ordering.accept_orders"),
    [mode, setMode] = useState("disabled");
  const [pending, setPending] = useState<ProvideAdminCommand | null>(null),
    [canRetry, setCanRetry] = useState(false);
  const serial = useRef(0),
    controller = useRef<AbortController | null>(null);
  const send = useCallback(async (command: ProvideAdminCommand) => {
    const id = ++serial.current;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setData(null);
    setBusy(true);
    setError("");
    setMessage("");
    setCanRetry(false);
    if (command.action !== "read") setPending(command);
    let retryAllowed = true;
    try {
      const response = await fetch("/api/provide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
        cache: "no-store",
        signal: AbortSignal.any([c.signal, AbortSignal.timeout(8000)]),
      });
      if (id !== serial.current) return;
      if (!response.ok) {
        retryAllowed = response.status >= 500;
        if (response.status === 401 || response.status === 403) {
          setPending(null);
          setQuery({ action: "read" });
          setCheckKey("");
          setFeatureKey("ordering.accept_orders");
        }
        if (response.status >= 500 && command.action !== "read") setCanRetry(true);
        throw Error(
          response.status === 403
            ? "Zugriff verweigert oder entzogen. Alle Verwaltungsdaten wurden ausgeblendet."
            : response.status === 401
              ? "Bitte erneut sicher anmelden."
              : response.status === 409
                ? "Der Stand wurde geändert oder Voraussetzungen sind unvollständig. Neu laden und vor einer weiteren Änderung prüfen."
                : response.status === 400
                  ? "Angaben sind ungültig. Bitte prüfen."
                  : "Antwort derzeit unklar. Neu laden und Audit prüfen; eine Wiederholung verwendet dieselbe Anfrage.",
        );
      }
      const envelope = (await response.json()) as { data?: unknown },
        next = parseProvideAdminState(envelope.data);
      if (id !== serial.current) return;
      if (
        !next ||
        (command.restaurantId !== undefined &&
          next.selected?.restaurantId !== command.restaurantId) ||
        (command.action !== "read" && next.selected?.locationId !== command.locationId) ||
        (command.action === "read" &&
          command.locationId !== undefined &&
          next.selected?.locationId !== command.locationId)
      )
        throw Error("Verwaltungsdaten sind derzeit nicht verfügbar.");
      setData(next);
      setPending(null);
      setCheckKey(next.selected?.checks[0]?.key ?? "");
      if (command.action !== "read") {
        setQuery({
          action: "read",
          restaurantId: command.restaurantId,
          ...(command.locationId ? { locationId: command.locationId } : {}),
        });
        setMessage("Änderung auditiert. Aktueller Stand wurde geladen.");
      }
    } catch (e) {
      if (id === serial.current && !c.signal.aborted) {
        setError(e instanceof Error ? e.message : "Verwaltung ist nicht verfügbar.");
        if (command.action !== "read") setCanRetry(retryAllowed);
      }
    } finally {
      if (id === serial.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void send({ action: "read" });
    return () => {
      serial.current++;
      controller.current?.abort();
    };
  }, [send]);
  const selected = data?.selected;
  function changeScope(next: Read) {
    serial.current++;
    controller.current?.abort();
    setData(null);
    setPending(null);
    setCanRetry(false);
    setQuery(next);
    setAction("check");
    setFeatureKey("ordering.accept_orders");
    setCheckKey("");
    void send(next);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    const f = new FormData(event.currentTarget),
      get = (k: string) => formText(f, k);
    const base = {
      restaurantId: selected.restaurantId,
      locationId: selected.locationId,
      expectedRevision: selected.revision,
      requestId: crypto.randomUUID(),
      reason: get("reason"),
    };
    let extra: Record<string, unknown> = {};
    if (action === "feature") {
      let expiresAt: string | null = null;
      if (mode !== "inherit" && get("expiresAt")) {
        try {
          expiresAt = new Date(get("expiresAt")).toISOString();
        } catch {
          setError("Bitte einen gültigen Ablauf wählen.");
          return;
        }
      }
      extra = { featureKey, mode, expiresAt };
    } else if (action === "check")
      extra = {
        checkKey,
        status: get("status"),
        evidenceKind: get("evidenceKind") || null,
        evidenceReference: get("evidenceReference") || null,
      };
    else if (action === "reopen") extra = { checkKeys: f.getAll("checkKeys").map(String) };
    else if (action === "onboarding" || action === "profileStatus")
      extra = { status: get("status") };
    else if (action === "goLive")
      extra = { status: get("status"), confirmation: get("confirmation") };
    else if (action === "critical")
      extra = {
        configuration: {
          merchantRole: get("merchantRole") || null,
          payoutAccountReference: get("payoutAccountReference") || null,
          productionDomain: get("productionDomain") || null,
          dataRegion: get("dataRegion") || null,
          responsibleUserId: get("responsibleUserId") || null,
        },
      };
    else if (action === "createLocation") {
      base.locationId = crypto.randomUUID();
      extra = { displayName: get("displayName"), slug: get("slug"), timezone: get("timezone") };
    }
    const command = parseProvideAdminCommand({ ...base, action, ...extra });
    if (!command) {
      setError(
        "Änderungsgrund mindestens 8 Zeichen; Nachweisreferenzen und Ablauf prüfen. Freigaben benötigen einen Ablauf.",
      );
      return;
    }
    void send(command);
  }
  function createRestaurant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.canCreateRestaurant || busy) return;
    const f = new FormData(event.currentTarget);
    const command = parseProvideAdminCommand({
      action: "createRestaurant",
      restaurantId: crypto.randomUUID(),
      locationId: null,
      expectedRevision: 0,
      requestId: crypto.randomUUID(),
      reason: formText(f, "reason"),
      displayName: formText(f, "displayName"),
      slug: formText(f, "slug"),
      timezone: formText(f, "timezone"),
    });
    if (!command) {
      setError("Bitte Namen, Kurzname, Zeitzone und Grund prüfen.");
      return;
    }
    void send(command);
  }
  const canWrite = !!selected && (selected.canManageRestaurant || selected.locationId !== null);
  const onboardingNext = selected
    ? (
        {
          not_started: "in_progress",
          in_progress: "ready_for_review",
          ready_for_review: "approved",
          approved: "",
        } as const
      )[selected.onboardingStatus]
    : "";
  const launchNext = selected
    ? ({ blocked: "ready", ready: "live", live: "paused", paused: "ready" } as const)[
        selected.goLiveStatus
      ]
    : "";
  const selectedFeature = selected?.features.find((f) => f.key === featureKey);
  return (
    <section className="panel provide-admin" aria-label="Plattformverwaltung">
      <h2>Mandanten und Freigaben</h2>
      <p>
        Nur ausdrücklich zugewiesene PROVIDE-Rechte erlauben Änderungen. Restaurantrollen erteilen
        keine Plattformrechte.
      </p>
      {busy && <p role="status">Verwaltung wird geladen …</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="admin-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setPending(null);
            void send(query);
          }}
        >
          Verwaltung neu laden
        </button>
        {canRetry && pending && (
          <button type="button" disabled={busy} onClick={() => void send(pending)}>
            Dieselbe Anfrage wiederholen
          </button>
        )}
      </div>
      {data && (
        <>
          <label>
            Mandant
            <select
              aria-label="Mandant"
              value={selected?.restaurantId ?? ""}
              onChange={(e) =>
                changeScope({
                  action: "read",
                  ...(e.target.value ? { restaurantId: e.target.value } : {}),
                })
              }
            >
              <option value="">Mandant auswählen</option>
              {selected && !data.restaurants.some((r) => r.id === selected.restaurantId) && (
                <option value={selected.restaurantId}>{selected.displayName}</option>
              )}
              {data.restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.displayName}
                </option>
              ))}
            </select>
          </label>
          {data.nextRestaurantCursor && (
            <button
              type="button"
              onClick={() => changeScope({ action: "read", cursor: data.nextRestaurantCursor! })}
            >
              Weitere Mandanten
            </button>
          )}
          {selected && (
            <>
              <label>
                Verwaltungsbereich
                <select
                  aria-label="Verwaltungsbereich"
                  value={selected.locationId ?? ""}
                  onChange={(e) =>
                    changeScope({
                      action: "read",
                      restaurantId: selected.restaurantId,
                      ...(e.target.value ? { locationId: e.target.value } : {}),
                    })
                  }
                >
                  <option value="">
                    Gesamter Mandant{selected.canManageRestaurant ? "" : " · nur Überblick"}
                  </option>
                  {selected.locationId &&
                    !selected.locations.some((l) => l.id === selected.locationId) && (
                      <option value={selected.locationId}>{selected.scopeDisplayName}</option>
                    )}
                  {selected.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.displayName}
                    </option>
                  ))}
                </select>
              </label>
              {selected.nextLocationCursor && (
                <button
                  type="button"
                  onClick={() =>
                    changeScope({
                      action: "read",
                      restaurantId: selected.restaurantId,
                      locationCursor: selected.nextLocationCursor!,
                    })
                  }
                >
                  Weitere Standorte
                </button>
              )}
              <article className="history-card">
                <h3>{selected.scopeDisplayName}</h3>
                <dl>
                  <dt>Betriebsstatus</dt>
                  <dd>{labels[selected.profileStatus]}</dd>
                  <dt>Prüfung</dt>
                  <dd>{labels[selected.onboardingStatus]}</dd>
                  <dt>Bestellfreigabe</dt>
                  <dd>{labels[selected.goLiveStatus]}</dd>
                  <dt>Verwaltungsstand</dt>
                  <dd>{selected.revision}</dd>
                </dl>
                <p>
                  Serverstand: {date(data.serverNow)}. Eine Feature-Regel ersetzt keine
                  Go-live-Prüfung.
                </p>
              </article>
              <h3>Pflichtprüfungen</h3>
              <div className="admin-checks">
                {selected.checks.map((c) => (
                  <article className="history-card" key={c.key}>
                    <h4>{checkLabels[c.key] ?? c.description}</h4>
                    <p>
                      {labels[c.status]}
                      {c.required ? " · Pflichtpunkt" : ""}
                    </p>
                    <p>
                      {c.evidenceReference
                        ? `Nachweis (${c.evidenceKind}): ${c.evidenceReference}`
                        : "Noch kein strukturierter Nachweis"}
                    </p>
                    {c.checkedAt && (
                      <p>
                        {date(c.checkedAt)} · Prüfer {c.checkedByUserId}
                      </p>
                    )}
                  </article>
                ))}
              </div>
              <h3>Feature-Regeln</h3>
              <p>
                Standortregeln können eine Mandantenfreigabe einschränken. Eine Mandantenabschaltung
                sperrt alle Standorte. Ablauf wird serverseitig geprüft; befristete Freigaben dauern
                höchstens 30 Tage.
              </p>
              <div className="admin-checks">
                {selected.features.map((f) => (
                  <article className="history-card" key={f.key}>
                    <h4>{featureLabels[f.key] ?? f.description}</h4>
                    <p>
                      Wirksam: {f.effectiveEnabled ? "freigegeben" : "gesperrt"} · Regel:{" "}
                      {f.mode === "inherit"
                        ? "Vererbt"
                        : f.mode === "enabled"
                          ? "Freigegeben"
                          : "Gesperrt"}
                    </p>
                    {f.expiresAt && <p>Ablauf: {date(f.expiresAt)}</p>}
                    {f.reason && <p>Grund: {f.reason}</p>}
                  </article>
                ))}
              </div>
              {canWrite && (
                <>
                  <h3>Bewusste Verwaltungsänderung</h3>
                  <label>
                    Aktion
                    <select
                      aria-label="Verwaltungsaktion"
                      value={action}
                      onChange={(e) => setAction(e.target.value as Action)}
                    >
                      <option value="check">Prüfpunkt dokumentieren</option>
                      <option value="feature">Feature-Regel ändern</option>
                      <option value="onboarding">Prüfung weiterführen</option>
                      <option value="goLive">Bestellfreigabe weiterführen</option>
                      <option value="reopen">Prüfpunkte erneut öffnen</option>
                      <option value="profileStatus">Betriebsstatus ändern</option>
                      {selected.canManageRestaurant && selected.locationId === null && (
                        <>
                          <option value="critical">Kritische Nachweisgrundlage ändern</option>
                          <option value="createLocation">Standort anlegen</option>
                        </>
                      )}
                    </select>
                  </label>
                  <form
                    onSubmit={submit}
                    className="auth-form"
                    key={`${selected.restaurantId}:${selected.locationId}:${selected.revision}:${action}`}
                  >
                    {action === "check" && (
                      <>
                        <label>
                          Prüfpunkt
                          <select
                            aria-label="Prüfpunkt"
                            value={checkKey}
                            onChange={(e) => setCheckKey(e.target.value)}
                          >
                            {selected.checks.map((c) => (
                              <option key={c.key} value={c.key}>
                                {checkLabels[c.key] ?? c.key}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Prüfergebnis
                          <select name="status" defaultValue="passed">
                            <option value="passed">Bestanden</option>
                            <option value="failed">Nicht bestanden</option>
                            <option value="pending">Offen</option>
                          </select>
                        </label>
                        <label>
                          Nachweisart
                          <select name="evidenceKind" defaultValue="document">
                            <option value="document">Dokumentprüfung</option>
                            <option value="test">Prüflauf</option>
                            <option value="provider">Anbieternachweis</option>
                          </select>
                        </label>
                        <label>
                          Nachweisreferenz
                          <input
                            name="evidenceReference"
                            maxLength={200}
                            placeholder="Dokument-ID, Prüflauf oder Artefaktreferenz"
                          />
                        </label>
                        <p>
                          Bestanden benötigt einen konkreten Nachweis. Freigegebene Prüfungen zuerst
                          erneut öffnen.
                        </p>
                      </>
                    )}
                    {action === "feature" && (
                      <>
                        <label>
                          Feature
                          <select
                            aria-label="Feature"
                            value={featureKey}
                            onChange={(e) => {
                              setFeatureKey(e.target.value);
                              setMode("disabled");
                            }}
                          >
                            {selected.features.map((f) => (
                              <option key={f.key} value={f.key}>
                                {featureLabels[f.key] ?? f.key}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Neue Feature-Regel
                          <select
                            aria-label="Neue Feature-Regel"
                            value={mode}
                            onChange={(e) => setMode(e.target.value)}
                          >
                            <option value="disabled">Sperren</option>
                            <option value="enabled">Befristet freigeben</option>
                            <option value="inherit">Überschreibung entfernen</option>
                          </select>
                        </label>
                        {mode !== "inherit" && (
                          <label>
                            Ablauf in Gerätezeitzone
                            <input
                              name="expiresAt"
                              type="datetime-local"
                              required={mode === "enabled"}
                              defaultValue={
                                mode === "enabled"
                                  ? localTime(
                                      new Date(Date.parse(data.serverNow) + 86400000).toISOString(),
                                    )
                                  : ""
                              }
                              key={mode}
                            />
                          </label>
                        )}
                        {selectedFeature && (
                          <p>
                            Aktuell wirksam:{" "}
                            {selectedFeature.effectiveEnabled ? "freigegeben" : "gesperrt"}.
                            Mandantenfreigabe:{" "}
                            {selectedFeature.restaurantEnabled ? "aktiv" : "geschlossen"}.
                          </p>
                        )}
                      </>
                    )}
                    {action === "onboarding" && (
                      <>
                        {onboardingNext ? (
                          <label>
                            Nächster Prüfstatus
                            <select name="status">
                              <option value={onboardingNext}>{labels[onboardingNext]}</option>
                            </select>
                          </label>
                        ) : (
                          <p>
                            Freigegebene Prüfungen müssen vor Änderungen erneut geöffnet werden.
                          </p>
                        )}
                      </>
                    )}
                    {action === "goLive" && (
                      <>
                        <label>
                          Nächste Bestellfreigabe
                          <select name="status">
                            <option
                              value={launchNext}
                              disabled={launchNext === "live" && !data.liveActionsEnabled}
                            >
                              {labels[launchNext]}
                            </option>
                          </select>
                        </label>
                        <label>
                          Bestätige den Bereichs-Kurznamen „{selected.scopeSlug}“
                          <input name="confirmation" required maxLength={63} autoComplete="off" />
                        </label>
                        {!data.liveActionsEnabled && (
                          <p>
                            Live-Aktivierung ist separat geschlossen. Eine technische Bereitschaft
                            ersetzt keine Betriebsfreigabe.
                          </p>
                        )}
                      </>
                    )}
                    {action === "reopen" && (
                      <>
                        <label>
                          Erneut zu prüfende Punkte
                          <select
                            name="checkKeys"
                            multiple
                            required
                            size={Math.min(selected.checks.length, 6)}
                          >
                            {selected.checks.map((c) => (
                              <option key={c.key} value={c.key}>
                                {checkLabels[c.key] ?? c.key}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p>
                          Die Bestellfreigabe dieses Bereichs wird sofort gesperrt. Historische
                          Bestellungen bleiben erhalten.
                        </p>
                      </>
                    )}
                    {action === "profileStatus" && (
                      <label>
                        Neuer Betriebsstatus
                        <select name="status" defaultValue={selected.profileStatus}>
                          <option value="setup">Erfassung</option>
                          <option value="active">Aktiv</option>
                          <option value="suspended">Suspendiert</option>
                        </select>
                      </label>
                    )}
                    {action === "critical" && (
                      <>
                        <p>
                          Diese Änderung öffnet die Pflichtprüfungen des Mandanten und aller
                          Standorte erneut. Referenzen dokumentieren Nachweise; sie konfigurieren
                          keine Anbieterkonten oder Infrastruktur.
                        </p>
                        <label>
                          Händlerrolle
                          <select
                            name="merchantRole"
                            defaultValue={selected.configuration?.merchantRole ?? ""}
                          >
                            <option value="">Unbekannt</option>
                            <option value="restaurant">Restaurant ist Händler</option>
                          </select>
                        </label>
                        <label>
                          Auszahlung oder Nichtanwendbarkeit: Nachweisreferenz
                          <input
                            name="payoutAccountReference"
                            defaultValue={selected.configuration?.payoutAccountReference ?? ""}
                            maxLength={200}
                          />
                        </label>
                        <label>
                          Produktive Domain
                          <input
                            name="productionDomain"
                            defaultValue={selected.configuration?.productionDomain ?? ""}
                            maxLength={253}
                          />
                        </label>
                        <label>
                          Datenregion
                          <select
                            name="dataRegion"
                            defaultValue={selected.configuration?.dataRegion ?? ""}
                          >
                            <option value="">Unbekannt</option>
                            <option value="eu-central-1">Frankfurt</option>
                          </select>
                        </label>
                        <label>
                          Verantwortlicher: bestätigte Benutzer-ID
                          <input
                            name="responsibleUserId"
                            defaultValue={selected.configuration?.responsibleUserId ?? ""}
                            maxLength={36}
                          />
                        </label>
                      </>
                    )}
                    {action === "createLocation" && (
                      <>
                        <label>
                          Standortname
                          <input name="displayName" required minLength={2} maxLength={100} />
                        </label>
                        <label>
                          Standort-Kurzname
                          <input
                            name="slug"
                            required
                            minLength={3}
                            maxLength={63}
                            pattern="[a-z0-9]+(-[a-z0-9]+)*"
                          />
                        </label>
                        <label>
                          Standortzeitzone
                          <input
                            name="timezone"
                            required
                            defaultValue="Europe/Berlin"
                            maxLength={80}
                          />
                        </label>
                        <p>Neue Standorte beginnen gesperrt und ohne Freigabe.</p>
                      </>
                    )}
                    <label>
                      Änderungsgrund
                      <input name="reason" required minLength={8} maxLength={300} />
                    </label>
                    <p>Keine Secrets oder Gastdaten in Gründe und Referenzen eintragen.</p>
                    <label className="checkbox-label">
                      <input type="checkbox" required />
                      Ich habe Bereich und Änderung geprüft.
                    </label>
                    <button
                      type="submit"
                      disabled={
                        busy ||
                        (action === "onboarding" && !onboardingNext) ||
                        (action === "goLive" && launchNext === "live" && !data.liveActionsEnabled)
                      }
                    >
                      Änderung bewusst anwenden
                    </button>
                  </form>
                </>
              )}
              <h3>Auditverlauf</h3>
              {selected.audit.length === 0 && (
                <p>Noch keine Verwaltungsereignisse in diesem Bereich.</p>
              )}
              {selected.audit.map((a) => (
                <details className="history-card" key={a.id}>
                  <summary>
                    {date(a.at)} · {a.action}
                  </summary>
                  <p>Grund: {a.reason}</p>
                  <p>Akteur: {a.actorUserId ?? "Privilegierte Datenbankpflege"}</p>
                  <div className="admin-audit">
                    <section>
                      <h4>Vorher</h4>
                      <pre>{JSON.stringify(a.before, null, 2)}</pre>
                    </section>
                    <section>
                      <h4>Nachher</h4>
                      <pre>{JSON.stringify(a.after, null, 2)}</pre>
                    </section>
                  </div>
                </details>
              ))}
            </>
          )}
          {data.canCreateRestaurant && (
            <details className="history-card">
              <summary>Neuen Mandanten anlegen</summary>
              <form className="auth-form" onSubmit={createRestaurant}>
                <label>
                  Mandantenname
                  <input name="displayName" required minLength={2} maxLength={100} />
                </label>
                <label>
                  Mandanten-Kurzname
                  <input
                    name="slug"
                    required
                    minLength={3}
                    maxLength={63}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  />
                </label>
                <label>
                  Mandantenzeitzone
                  <input name="timezone" defaultValue="Europe/Berlin" required maxLength={80} />
                </label>
                <label>
                  Anlagegrund
                  <input name="reason" required minLength={8} maxLength={300} />
                </label>
                <p>
                  Der Mandant beginnt gesperrt. Eine Restaurant-Owner-Rolle wird nicht automatisch
                  vergeben.
                </p>
                <label className="checkbox-label">
                  <input type="checkbox" required />
                  Neue Anlage bewusst bestätigen.
                </label>
                <button type="submit" disabled={busy}>
                  Mandant gesperrt anlegen
                </button>
              </form>
            </details>
          )}
        </>
      )}
    </section>
  );
}
