"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  parseHistoryQuery,
  parseOrderHistory,
  publicOrderStatuses,
  type HistoryQuery,
  type OrderHistory as HistoryState,
  type HistoryMetric,
} from "@provide/contracts";
const labels: Record<string, string> = {
  submitted: "Eingegangen",
  accepted: "Angenommen",
  preparing: "In Vorbereitung",
  ready: "Bereit",
  completed: "Erfüllt",
  rejected: "Abgelehnt",
  cancelled: "Storniert",
};
const money = (n: number, c: string) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: c }).format(n / 100);
const rate = (n: number | null) =>
  n === null
    ? "–"
    : new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(n / 100) + " %";
function MetricCard({ m }: { m: HistoryMetric }) {
  return (
    <article className="history-card">
      <h4>
        {m.period === "total" ? "Gesamt" : m.period === "week" ? "Woche ab " + m.date : m.date} ·{" "}
        {m.currency}
      </h4>
      <dl>
        <dt>Bestellungen</dt>
        <dd>{m.orderCount}</dd>
        <dt>Erfüllt</dt>
        <dd>{m.completedCount}</dd>
        <dt>Bruttobestellwert (erfüllt)</dt>
        <dd>{money(m.completedGrossMinor, m.currency)}</dd>
        <dt>Durchschnittsbon (erfüllt)</dt>
        <dd>
          {m.averageCompletedMinor === null ? "–" : money(m.averageCompletedMinor, m.currency)}
        </dd>
        <dt>Ablehnungsquote</dt>
        <dd>
          {rate(m.rejectionBasisPoints)} ({m.rejectedCount}/{m.orderCount})
        </dd>
        <dt>Storniert</dt>
        <dd>{m.cancelledCount}</dd>
        <dt>Abholung / Lieferung</dt>
        <dd>
          {m.pickupCount} / {m.deliveryCount}
        </dd>
        <dt>Online erfasst / erstattet</dt>
        <dd>
          {money(m.capturedMinor, m.currency)} / {money(m.refundedMinor, m.currency)}
        </dd>
      </dl>
    </article>
  );
}
export function OrderHistory({
  restaurantId,
  locations,
}: {
  readonly restaurantId: string;
  readonly locations: readonly { id: string; displayName: string }[];
}) {
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  const [data, setData] = useState<HistoryState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [filters, setFilters] = useState<HistoryQuery>({});
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [status, setStatus] = useState(""),
    [fulfillment, setFulfillment] = useState(""),
    [number, setNumber] = useState(""),
    [name, setName] = useState("");
  const serial = useRef(0),
    controller = useRef<AbortController | null>(null);
  const load = useCallback(
    async (query: HistoryQuery, selectedLocation = location) => {
      const request = ++serial.current;
      controller.current?.abort();
      const c = new AbortController();
      controller.current = c;
      setBusy(true);
      setError("");
      setData(null);
      try {
        const response = await fetch(
          "/api/history?" +
            new URLSearchParams({ restaurantId, locationId: selectedLocation }).toString(),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(query),
            cache: "no-store",
            signal: AbortSignal.any([c.signal, AbortSignal.timeout(8000)]),
          },
        );
        if (request !== serial.current) return;
        if (response.status === 401 || response.status === 403) {
          setName("");
          setFilters({});
        }
        if (!response.ok)
          throw Error(
            response.status === 403
              ? "Zugriff entzogen. Historie wurde ausgeblendet."
              : response.status === 401
                ? "Bitte erneut sicher anmelden."
                : response.status === 400
                  ? "Zeitraum oder Suchangaben sind ungültig."
                  : "Historie ist derzeit nicht verfügbar.",
          );
        const envelope = (await response.json()) as { data?: unknown },
          state = parseOrderHistory(envelope.data);
        if (request !== serial.current) return;
        if (
          !state ||
          state.restaurantId !== restaurantId ||
          state.locationId !== selectedLocation ||
          (query.orderId !== undefined && state.detail?.order.orderId !== query.orderId)
        )
          throw Error("Historie ist derzeit nicht verfügbar.");
        setData(state);
        setFrom(state.fromDate);
        setTo(state.toDate);
        setFilters({ ...query, fromDate: state.fromDate, toDate: state.toDate });
      } catch (e) {
        if (request === serial.current && !c.signal.aborted)
          setError(e instanceof Error ? e.message : "Historie ist derzeit nicht verfügbar.");
      } finally {
        if (request === serial.current) setBusy(false);
      }
    },
    [restaurantId, location],
  );
  useEffect(() => {
    setName("");
    setNumber("");
    setStatus("");
    setFulfillment("");
    setFrom("");
    setTo("");
    setFilters({});
    if (location) void load({}, location);
    return () => {
      serial.current++;
      controller.current?.abort();
    };
    // A scope change must erase every prior result and search, including pending responses.
  }, [restaurantId, location, load]);
  function search(event: FormEvent) {
    event.preventDefault();
    const q = parseHistoryQuery({
      ...(from || to ? { fromDate: from, toDate: to } : {}),
      ...(status ? { status } : {}),
      ...(fulfillment ? { fulfillmentType: fulfillment } : {}),
      ...(number.trim() ? { orderNumber: number.trim() } : {}),
      ...(name.trim() ? { customerName: name.trim() } : {}),
    });
    if (!q) {
      serial.current++;
      controller.current?.abort();
      setData(null);
      setBusy(false);
      setError("Zeitraum höchstens 93 Tage; Suchname 2–80 Zeichen; vollständige BS-Bestellnummer.");
      return;
    }
    void load(q);
  }
  return (
    <section className="panel" aria-label="Historie und Kennzahlen">
      <h3>Historie und Kennzahlen</h3>
      <label>
        Historienstandort
        <select
          aria-label="Historienstandort"
          value={location}
          onChange={(e) => {
            serial.current++;
            controller.current?.abort();
            setData(null);
            setName("");
            setLocation(e.target.value);
          }}
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.displayName}
            </option>
          ))}
        </select>
      </label>
      <form onSubmit={search} className="history-filters">
        <label>
          Von (Bestelleingang)
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Bis einschließlich
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Historienstatus
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Alle Status</option>
            {publicOrderStatuses.map((s) => (
              <option key={s} value={s}>
                {labels[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Historien-Erfüllungsart
          <select value={fulfillment} onChange={(e) => setFulfillment(e.target.value)}>
            <option value="">Beide Arten</option>
            <option value="pickup">Abholung</option>
            <option value="delivery">Lieferung</option>
          </select>
        </label>
        <label>
          Historien-Bestellnummer
          <input
            maxLength={22}
            placeholder="BS-00000421"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>
        <label>
          Kundenname suchen
          <input
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button disabled={busy || !location}>Historie suchen</button>
        <button
          type="button"
          disabled={busy || !location}
          onClick={() => {
            setName("");
            setNumber("");
            setStatus("");
            setFulfillment("");
            void load({});
          }}
        >
          Aktuelle Woche
        </button>
      </form>
      <p>
        Zeiträume beziehen sich auf den Bestelleingang in der Standortzeitzone. Wochen beginnen
        montags. Namen werden nur innerhalb ihrer Aufbewahrungsfrist durchsucht und nicht
        gespeichert.
      </p>
      {busy && <p role="status">Historie wird geprüft …</p>}
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p role="status">
            {data.fromDate} bis {data.toDate} · {data.timezone} · Stand{" "}
            {new Date(data.serverNow).toLocaleString("de-DE", { timeZone: data.timezone })}
          </p>
          <p>
            Bruttobestellwert einschließlich deklarierter Steuer und Liefergebühr, nur erfüllte
            Bestellungen. Kein Zahlungs- oder Fiskalnachweis. Onlinebeträge zeigen den heutigen
            Zahlungsstand derselben Bestellgruppe; Vor-Ort-Zahlungen sind nicht bestätigt.
            Ablehnungsquote: abgelehnt / alle Bestellungen. Alle Kennzahlen folgen den Suchfiltern,
            nicht nur der sichtbaren Seite.
          </p>
          {data.metrics.length === 0 ? (
            <p>Keine Bestellungen im gewählten Zeitraum.</p>
          ) : (
            <div>
              {data.metrics
                .filter((m) => m.period === "total")
                .map((m) => (
                  <MetricCard key={m.currency} m={m} />
                ))}
            </div>
          )}
          <details>
            <summary>Tages- und Wochenkennzahlen</summary>
            {data.metrics
              .filter((m) => m.period !== "total")
              .map((m) => (
                <MetricCard key={m.period + m.date + m.currency} m={m} />
              ))}
          </details>
          <ul className="order-list">
            {data.orders.map((o) => (
              <li key={o.orderId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void load({ ...filters, orderId: o.orderId })}
                >
                  {o.orderNumber} · {labels[o.status]} ·{" "}
                  {o.fulfillmentType === "pickup" ? "Abholung" : "Lieferung"} ·{" "}
                  {money(o.totalAmountMinor, o.currency)}
                </button>
              </li>
            ))}
          </ul>
          {data.nextCursor && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const q = { ...filters };
                delete q.orderId;
                void load({ ...q, cursor: data.nextCursor! });
              }}
            >
              Ältere Bestellungen
            </button>
          )}
          {data.detail && (
            <article className="history-card">
              <h4>Verlauf {data.detail.order.orderNumber}</h4>
              <p>{data.detail.order.contactName ?? "Kontakt nicht vorhanden oder abgelaufen"}</p>
              <ul>
                {data.detail.order.lines.map((l) => (
                  <li key={l.lineNumber}>
                    {l.quantity} × {l.displayName} ·{" "}
                    {money(l.lineAmountMinor, data.detail!.order.currency)}
                  </li>
                ))}
              </ul>
              <ol>
                {data.detail.events.map((e) => (
                  <li key={e.sequence}>
                    {new Date(e.at).toLocaleString("de-DE", { timeZone: data.timezone })} ·{" "}
                    {labels[e.toStatus]} ·{" "}
                    {e.actorKind === "system" ? "System" : "Restaurantpersonal"}
                  </li>
                ))}
              </ol>
            </article>
          )}
          <p>
            Letzter regelmäßiger Datenschutzlauf:{" "}
            {data.purge
              ? new Date(data.purge.lastRunAt).toLocaleString("de-DE", { timeZone: data.timezone })
              : "noch kein Nachweis"}
            . Keine Wiederherstellung abgelaufener Kontaktdaten.
          </p>
        </>
      )}
    </section>
  );
}
