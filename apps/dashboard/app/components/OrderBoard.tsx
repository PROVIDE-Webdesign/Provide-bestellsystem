"use client";

import { OperatorIcon } from "./OperatorVisuals.js";
import { OrderTax } from "./OrderTax";
import { OrderInbox } from "./OrderInbox";
import type { OrderLiveSubscriber } from "../../lib/order-live.js";

import {
  paymentStateLabels,
  parseDashboardOrderDetail,
  parseDashboardOrderList,
  parseDashboardOrderStatusResult,
  publicOrderStatuses,
  type DashboardLocationAccess,
  type DashboardOrderDetail,
  type DashboardOrderList,
  type DashboardOrderStatus,
  type RestaurantRole,
  parseOrderCommunication,
  type OrderReasonCode,
  orderReasonLabels,
  locationTimeToInstant,
  orderReference,
  isOrderNumber,
} from "@provide/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  shortOrderNumber,
  operatorStage,
  operatorPayment,
  shortOrderTime,
  formatMoney,
  formatOrderTime,
  orderStatusLabels,
  fulfillmentTransitionLabel,
} from "../../lib/order-ui.js";

interface OrderBoardProps {
  readonly initialLocationId?: string;
  readonly onLocationChange?: (id: string) => void;
  readonly restaurantId: string;
  readonly role: RestaurantRole;
  readonly locations: readonly DashboardLocationAccess[];
  readonly liveEnabled?: boolean;
  readonly alertsEnabled?: boolean;
  readonly pushEnabled?: boolean;
  readonly subscribeLive?: OrderLiveSubscriber;
}

const cancellationReasonLabels = {
  unavailable: "Restaurant nicht verfügbar",
  sold_out: "Artikel ausverkauft",
  customer_request: "Kundenwunsch",
  operational: "Betriebliche Gründe",
} as const;

function envelopeData(value: unknown): unknown {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).data
    : undefined;
}

export function OrderBoard({
  restaurantId,
  role,
  initialLocationId,
  onLocationChange,
  locations,
  liveEnabled = false,
  alertsEnabled = false,
  pushEnabled = false,
  subscribeLive,
}: OrderBoardProps) {
  const [stageFilter, setStageFilter] = useState("all");
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [previews, setPreviews] = useState<Record<string, DashboardOrderDetail>>({});
  const previewsRequest = useRef<AbortController | null>(null);
  const [pendingStatus, setPendingStatus] = useState<DashboardOrderStatus | null>(null);
  const reasonDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (pendingStatus) reasonDialog.current?.showModal();
  }, [pendingStatus]);
  const [locationId, setLocationId] = useState(initialLocationId ?? locations[0]?.id ?? "");
  const [status, setStatus] = useState<DashboardOrderStatus | "">("");
  const [fulfillment, setFulfillment] = useState("");
  const [numberQuery, setNumberQuery] = useState("");
  const [numberFilter, setNumberFilter] = useState("");
  const [orders, setOrders] = useState<DashboardOrderList>();
  const [detail, setDetail] = useState<DashboardOrderDetail>();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [reasonCode, setReasonCode] = useState<OrderReasonCode>("unavailable");
  const [confirmedTime, setConfirmedTime] = useState("");
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const scopeBlocked = useRef(false);
  const currentDetail = useRef(detail);
  currentDetail.current = detail;
  const currentUpdating = useRef(updating);
  currentUpdating.current = updating;

  function clearDenied() {
    scopeBlocked.current = true;
    previewsRequest.current?.abort();
    setPreviews({});
    setSelectedOrderId("");
    setDetailLoading(false);
    listRequest.current?.abort();
    detailRequest.current?.abort();
    setAccessDenied(true);
    setOrders(undefined);
    setDetail(undefined);
    setMessage("Zugriff nicht mehr bestätigt. Bitte neu anmelden und Standortrechte prüfen.");
  }

  const loadOrders = useCallback(
    async (cursor?: string) => {
      if (
        !locationId ||
        role === "driver" ||
        scopeBlocked.current ||
        document.visibilityState === "hidden"
      )
        return;
      listRequest.current?.abort();
      const controller = new AbortController();
      listRequest.current = controller;
      setLoading(true);
      try {
        const query = new URLSearchParams({ restaurantId, locationId, limit: "25" });
        if (fulfillment) query.set("fulfillmentType", fulfillment);
        if (numberFilter) query.set("orderNumber", numberFilter);
        if (status) query.set("status", status);
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(`/api/orders?${query}`, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          clearDenied();
          return;
        }
        if (!response.ok) throw new Error();
        const parsed = parseDashboardOrderList(envelopeData(await response.json()));
        if (!parsed || parsed.restaurantId !== restaurantId || parsed.locationId !== locationId)
          throw new Error();
        if (controller.signal.aborted) return;
        setOrders((current) =>
          cursor && current
            ? {
                ...parsed,
                orders: [
                  ...new Map(
                    [...current.orders, ...parsed.orders].map((o) => [o.orderId, o]),
                  ).values(),
                ],
              }
            : parsed,
        );
        setMessage("");
      } catch {
        if (controller.signal.aborted) return;
        setMessage("Die Bestellungen konnten nicht sicher aktualisiert werden.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [locationId, restaurantId, role, status, fulfillment, numberFilter],
  );

  useEffect(() => {
    scopeBlocked.current = false;
    setAccessDenied(false);
  }, [restaurantId, locationId]);
  useEffect(() => {
    void loadOrders();
    return () => {
      listRequest.current?.abort();
      detailRequest.current?.abort();
    };
  }, [loadOrders]);

  async function loadDetail(orderId: string, refresh = false) {
    if (scopeBlocked.current) return;
    if (!refresh) setDetailLoading(true);
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    if (!refresh) {
      setSelectedOrderId(orderId);
      setDetail(undefined);
      setMessage("");
    }
    try {
      const query = new URLSearchParams({ restaurantId, locationId });
      const response = await fetch(`/api/orders/${orderId}?${query}`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        clearDenied();
        return;
      }
      if (!response.ok) throw new Error();
      const parsed = parseDashboardOrderDetail(envelopeData(await response.json()));
      if (
        !parsed ||
        parsed.restaurantId !== restaurantId ||
        parsed.locationId !== locationId ||
        parsed.orderId !== orderId
      )
        throw new Error();
      if (controller.signal.aborted) return;
      if (refresh && (currentUpdating.current || currentDetail.current?.orderId !== orderId))
        return;
      if (refresh && JSON.stringify(currentDetail.current) === JSON.stringify(parsed)) return;
      setDetail(parsed);
      setPreviews((current) => ({ ...current, [parsed.orderId]: parsed }));
      if (refresh)
        setMessage(
          "Die Bestellung wurde aktualisiert. Bitte prüfe den neuen Stand vor der nächsten Aktion.",
        );
      setConfirmedTime(
        new Intl.DateTimeFormat("sv-SE", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          timeZone: parsed.communication?.timezone ?? "Europe/Berlin",
        })
          .format(new Date(parsed.communication?.confirmedFor ?? parsed.requestedFor))
          .replace(" ", "T"),
      );
    } catch {
      if (controller.signal.aborted) return;
      setMessage("Die Bestelldetails konnten nicht sicher geladen werden.");
    } finally {
      if (detailRequest.current === controller) setDetailLoading(false);
    }
  }

  async function transition(targetStatus: DashboardOrderStatus) {
    if (role === "viewer" || !detail || updating) return;
    setUpdating(true);
    setMessage("");
    try {
      const query = new URLSearchParams({ restaurantId, locationId });
      const response = await fetch(`/api/orders/${detail.orderId}/status?${query}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedStatus: detail.status,
          targetStatus,
          ...(["cancelled", "rejected"].includes(targetStatus) ? { reasonCode } : {}),
        }),
      });
      if (response.status === 409) {
        setMessage("Die Bestellung wurde zwischenzeitlich geändert und wird neu geladen.");
        detailRequest.current?.abort();
        detailRequest.current = null;
        setDetail(undefined);
        await loadOrders();
        return;
      }
      if (response.status === 401 || response.status === 403) {
        clearDenied();
        return;
      }
      if (!response.ok) throw new Error();
      if (!parseDashboardOrderStatusResult(envelopeData(await response.json()))) throw new Error();
      setDetail(undefined);
      detailRequest.current = null;
      await loadOrders();
    } catch {
      setMessage("Der Status konnte nicht sicher geändert werden.");
    } finally {
      setUpdating(false);
    }
  }

  async function communicate(action: "confirm_time" | "dispatch") {
    if (role === "viewer" || !detail || updating || !detail.communication) return;
    const instant = locationTimeToInstant(confirmedTime, detail.communication.timezone);
    const command =
      action === "dispatch"
        ? {
            action,
            expectedStatus: "ready" as const,
            expectedRevision: detail.communication.revision,
          }
        : {
            action,
            expectedStatus: detail.status,
            expectedRevision: detail.communication.revision,
            confirmedFor: instant,
          };
    if (action === "confirm_time" && !instant) {
      setMessage("Bitte wähle eine gültige, eindeutige Uhrzeit.");
      return;
    }
    setUpdating(true);
    try {
      const r = await fetch(
        `/api/orders/${detail.orderId}/communication?${new URLSearchParams({ restaurantId, locationId })}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        },
      );
      if (r.status === 409) {
        await loadDetail(detail.orderId);
        setMessage("Die Bestellung wurde geändert. Prüfe den neu geladenen Stand.");
        return;
      }
      if (r.status === 401 || r.status === 403) {
        clearDenied();
        return;
      }
      if (!r.ok || !parseOrderCommunication(envelopeData(await r.json()))) throw new Error();
      await loadDetail(detail.orderId);
    } catch {
      setMessage("Die Bestellinformation konnte nicht sicher geändert werden.");
    } finally {
      setUpdating(false);
    }
  }

  const previewSignature = JSON.stringify(
    orders?.orders.map((order) => [order.orderId, order.updatedAt]),
  );
  useEffect(() => {
    const controller = new AbortController();
    previewsRequest.current = controller;
    const pending = (orders?.orders ?? []).filter(
      (order) => previews[order.orderId]?.updatedAt !== order.updatedAt,
    );
    let cursor = 0;
    async function worker() {
      while (cursor < pending.length && !controller.signal.aborted && !scopeBlocked.current) {
        const order = pending[cursor++];
        if (!order) return;
        try {
          const response = await fetch(
            `/api/orders/${order.orderId}?${new URLSearchParams({ restaurantId, locationId })}`,
            {
              cache: "no-store",
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
            },
          );
          if (controller.signal.aborted || scopeBlocked.current) return;
          if (response.status === 401 || response.status === 403) {
            clearDenied();
            return;
          }
          if (!response.ok) continue;
          const parsed = parseDashboardOrderDetail(envelopeData(await response.json()));
          if (
            !controller.signal.aborted &&
            !scopeBlocked.current &&
            parsed?.restaurantId === restaurantId &&
            parsed.locationId === locationId &&
            parsed.orderId === order.orderId
          ) {
            setPreviews((current) => ({ ...current, [order.orderId]: parsed }));
          }
        } catch {
          /* The summary remains available when an optional preview fails. */
        }
      }
    }
    if (role !== "viewer" && role !== "driver")
      for (let index = 0; index < 4; index++) void worker();
    return () => controller.abort();
  }, [previewSignature, restaurantId, locationId, role]);

  const rank = (value: DashboardOrderStatus) =>
    value === "submitted"
      ? 0
      : ["accepted", "preparing"].includes(value)
        ? 1
        : value === "ready"
          ? 2
          : 3;
  const sortedOrders = [...(orders?.orders ?? [])].sort(
    (a, b) =>
      rank(a.status) - rank(b.status) || Date.parse(a.requestedFor) - Date.parse(b.requestedFor),
  );
  const matchesStage = (order: { status: DashboardOrderStatus }, value: string) =>
    value === "all" ||
    (value === "preparing"
      ? ["accepted", "preparing"].includes(order.status)
      : order.status === value);
  const visibleOrders = sortedOrders.filter((order) => matchesStage(order, stageFilter));
  useEffect(() => {
    if (
      visibleOrders[0] &&
      !currentDetail.current &&
      !currentUpdating.current &&
      !scopeBlocked.current &&
      (!detailRequest.current || detailRequest.current.signal.aborted)
    )
      void loadDetail(visibleOrders[0].orderId);
  }, [orders, stageFilter, updating]);
  const waiting = (order: { updatedAt: string }) =>
    `seit ${Math.max(0, Math.floor((Date.now() - Date.parse(order.updatedAt)) / 60000))} Min.`;
  const chooseStage = (value: string) => {
    if (value === stageFilter) return;
    detailRequest.current?.abort();
    detailRequest.current = null;
    setDetail(undefined);
    setStageFilter(value);
  };
  const act = (target: DashboardOrderStatus) => {
    if (target === "rejected" || target === "cancelled") setPendingStatus(target);
    else void transition(target);
  };

  if (role === "driver")
    return <p className="notice">Für Fahrer ist die Bestellbearbeitung gesperrt.</p>;
  if (locations.length === 0)
    return <p className="notice">Ohne Standortzuweisung ist keine Bestellbearbeitung möglich.</p>;

  return (
    <div className="order-board operator-board">
      {role === "viewer" && (
        <p className="warning">Nur Lesezugriff: keine Änderungen und keine Kundendaten.</p>
      )}
      {!accessDenied && (
        <OrderInbox
          compact
          key={`${restaurantId}:${locationId}`}
          restaurantId={restaurantId}
          locationId={locationId}
          locationName={locations.find((item) => item.id === locationId)?.displayName ?? "Standort"}
          liveEnabled={liveEnabled}
          alertsEnabled={alertsEnabled}
          pushEnabled={pushEnabled}
          readOnly={role === "viewer"}
          {...(subscribeLive ? { subscribeLive } : {})}
          onDenied={clearDenied}
          onOpen={(orderId) => void loadDetail(orderId)}
          onInvalidate={async () => {
            await loadOrders();
            const open = currentDetail.current;
            if (open && !currentUpdating.current) await loadDetail(open.orderId, true);
          }}
        />
      )}
      <details className="operator-filter-menu">
        <summary>
          <OperatorIcon name="filter" />
          Filter und Suche
        </summary>
        <div className="operator-filter-content">
          <div className="order-controls">
            <label>
              Bestellart
              <select
                disabled={updating}
                value={fulfillment}
                onChange={(e) => {
                  setFulfillment(e.target.value);
                  detailRequest.current?.abort();
                  detailRequest.current = null;
                  setDetail(undefined);
                  setOrders(undefined);
                }}
              >
                <option value="">Alle Bestellarten</option>
                <option value="pickup">Abholung</option>
                <option value="delivery">Lieferung</option>
              </select>
            </label>
            <label>
              Standort
              <select
                disabled={updating}
                value={locationId}
                onChange={(event) => {
                  setLocationId(event.target.value);
                  onLocationChange?.(event.target.value);
                  detailRequest.current?.abort();
                  detailRequest.current = null;
                  setDetail(undefined);
                  setOrders(undefined);
                }}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                disabled={updating}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as DashboardOrderStatus | "");
                  detailRequest.current?.abort();
                  detailRequest.current = null;
                  setDetail(undefined);
                  setOrders(undefined);
                }}
              >
                <option value="">Alle Bestellungen</option>
                {publicOrderStatuses.map((value) => (
                  <option key={value} value={value}>
                    {value === "ready" ? "Bereit" : orderStatusLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              type="button"
              disabled={loading}
              onClick={() => void loadOrders()}
            >
              {loading ? "Aktualisiert …" : "Aktualisieren"}
            </button>
          </div>

          <form
            className="toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              const value = numberQuery.trim();
              if (value && !isOrderNumber(value)) {
                setMessage("Bitte gib eine vollständige Bestellnummer im Format BS-00000421 ein.");
                return;
              }
              if (value === numberFilter) {
                void loadOrders();
                return;
              }
              setNumberFilter(value);
              setDetail(undefined);
              setOrders(undefined);
            }}
          >
            <label>
              Bestellnummer suchen
              <input
                type="search"
                maxLength={22}
                value={numberQuery}
                onChange={(event) => setNumberQuery(event.target.value)}
                placeholder="BS-00000421"
                disabled={updating}
              />
            </label>
            <button type="submit" disabled={loading || updating}>
              Suchen
            </button>
            {numberFilter && (
              <button
                type="button"
                className="secondary"
                disabled={updating}
                onClick={() => {
                  setNumberQuery("");
                  setNumberFilter("");
                  detailRequest.current?.abort();
                  detailRequest.current = null;
                  setDetail(undefined);
                  setOrders(undefined);
                }}
              >
                Suche zurücksetzen
              </button>
            )}
          </form>
        </div>
      </details>
      {message && (
        <p role="alert" className="operator-message">
          {message}
        </p>
      )}
      <div className="operator-workspace">
        <section className="operator-queue" aria-label="Bestellliste">
          <div className="operator-tabs" role="group" aria-label="Bestellstatus">
            {[
              ["all", "Alle"],
              ["submitted", "Neu"],
              ["preparing", "In Zubereitung"],
              ["ready", "Abholbereit"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={stageFilter === value}
                disabled={updating}
                onClick={() => chooseStage(value!)}
              >
                {label} ({sortedOrders.filter((order) => matchesStage(order, value!)).length}
                {orders?.nextCursor ? "+" : ""})
              </button>
            ))}
          </div>
          <ul className="operator-orders" aria-label="Bestellungen">
            {visibleOrders.map((order) => {
              const preview = previews[order.orderId];
              return (
                <li key={order.orderId}>
                  <button
                    type="button"
                    className={`operator-order-card ${selectedOrderId === order.orderId ? "is-selected" : ""}`}
                    aria-pressed={selectedOrderId === order.orderId}
                    title={orderReference(order)}
                    disabled={updating}
                    onClick={() => void loadDetail(order.orderId)}
                  >
                    <span className={`operator-stage is-${order.status}`}>
                      {operatorStage(order)}
                    </span>
                    {order.status === "submitted" && selectedOrderId === order.orderId && (
                      <span className="operator-wait">{waiting(order)}</span>
                    )}
                    <span className="operator-card-heading">
                      <strong data-long-number={shortOrderNumber(order).length > 8}>
                        #{shortOrderNumber(order)}
                      </strong>
                      <span>
                        <OperatorIcon name="bag" />
                        {order.fulfillmentType === "delivery" ? "Lieferung" : "Abholung"}{" "}
                        <b>
                          {shortOrderTime(order.requestedFor, preview?.communication?.timezone)}
                        </b>
                      </span>
                    </span>
                    <span className="operator-card-meta">
                      <strong>{role !== "viewer" ? preview?.contactName : null}</strong>
                      <b>{formatMoney(order.totalAmountMinor, order.currency)}</b>
                    </span>
                    <span className="operator-card-bottom">
                      <span className="operator-card-items">
                        {preview
                          ? preview.lines
                              .map(
                                (line) =>
                                  `${line.quantity}× ${line.displayName}${line.selectionSnapshot?.variant ? " · " + line.selectionSnapshot.variant.name : ""}`,
                              )
                              .join(", ")
                          : `${order.itemCount} Artikel`}
                      </span>
                      {role !== "viewer" && (
                        <span
                          className={`operator-payment ${order.paymentState === "paid" ? "is-paid" : ""}`}
                        >
                          {operatorPayment(order)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!loading && orders && visibleOrders.length === 0 && (
            <p className="operator-empty">Für diesen Filter liegen keine Bestellungen vor.</p>
          )}
          {loading && !orders && (
            <p className="operator-empty" role="status">
              Bestellungen werden geladen …
            </p>
          )}
          {orders?.nextCursor && (
            <button
              className="secondary operator-load-more"
              disabled={loading || updating}
              onClick={() => void loadOrders(orders.nextCursor ?? undefined)}
            >
              Weitere Bestellungen laden
            </button>
          )}
        </section>
        {detail ? (
          <section className="operator-detail" aria-labelledby={`order-${detail.orderId}`}>
            <div className="operator-detail-flags">
              <span className={`operator-stage is-${detail.status}`}>{operatorStage(detail)}</span>
              {detail.status === "submitted" && (
                <span className="operator-wait">{waiting(detail)}</span>
              )}
            </div>
            <div className="operator-detail-heading">
              <div>
                <h2
                  id={`order-${detail.orderId}`}
                  data-long-number={shortOrderNumber(detail).length > 8}
                  title={orderReference(detail)}
                >
                  #{shortOrderNumber(detail)}
                </h2>
                {role !== "viewer" && detail.contactName && <h3>{detail.contactName}</h3>}
              </div>
              <div className="operator-pickup">
                <span>
                  <OperatorIcon name="bag" />
                  {detail.fulfillmentType === "delivery" ? "Lieferung" : "Abholung"}
                </span>
                <strong>
                  {shortOrderTime(
                    detail.communication?.confirmedFor ?? detail.requestedFor,
                    detail.communication?.timezone,
                  )}
                </strong>
              </div>
            </div>
            <div className="operator-detail-items">
              <h4>Bestellung ({detail.itemCount} Artikel)</h4>
              <ul>
                {detail.lines.map((line) => (
                  <li key={line.lineNumber}>
                    <span>
                      <span className="operator-line-quantity">{line.quantity}×</span>
                      {line.displayName}
                      {line.selectionSnapshot &&
                        [
                          line.selectionSnapshot.variant?.name,
                          ...line.selectionSnapshot.options.map((option) => option.name),
                        ].filter(Boolean).length > 0 && (
                          <span>
                            {" "}
                            ·{" "}
                            {[
                              line.selectionSnapshot.variant?.name,
                              ...line.selectionSnapshot.options.map((option) => option.name),
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        )}
                    </span>
                    <span>{formatMoney(line.lineAmountMinor, detail.currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="operator-detail-total">
              <strong>Gesamt</strong>
              <strong>{formatMoney(detail.totalAmountMinor, detail.currency)}</strong>
            </div>
            {role !== "viewer" && (
              <div className="operator-detail-payment">
                <span
                  className={`operator-payment ${detail.paymentState === "paid" ? "is-paid" : ""}`}
                >
                  <OperatorIcon name="coins" />
                  {operatorPayment(detail)}
                </span>
              </div>
            )}
            {(detail.communication ||
              detail.delivery ||
              detail.taxSummary ||
              detail.paymentState === "refund_failed") && (
              <details className="operator-extra">
                <summary>Weitere Bestelldetails</summary>
                <p>Bestellnummer: {orderReference(detail)}</p>
                {role !== "viewer" && detail.communication?.confirmedFor && (
                  <p>
                    Bestätigte Zeit:{" "}
                    {formatOrderTime(
                      detail.communication.confirmedFor,
                      detail.communication.timezone,
                    )}
                  </p>
                )}
                {role !== "viewer" && detail.communication?.dispatchedAt && (
                  <p>
                    Lieferung unterwegs seit{" "}
                    {formatOrderTime(
                      detail.communication.dispatchedAt,
                      detail.communication.timezone,
                    )}
                  </p>
                )}
                {role !== "viewer" &&
                  detail.communication &&
                  ["accepted", "preparing", "ready"].includes(detail.status) &&
                  (detail.paymentCollectionMode !== "online" || detail.paymentState === "paid") &&
                  !detail.communication.dispatchedAt && (
                    <div className="order-controls">
                      <label>
                        Bestätigte Abhol- oder Lieferzeit
                        <input
                          type="datetime-local"
                          value={confirmedTime}
                          disabled={updating}
                          onChange={(e) => setConfirmedTime(e.target.value)}
                          aria-describedby="confirmed-time-help"
                        />
                      </label>
                      <p id="confirmed-time-help">Die Uhrzeit gilt am Restaurantstandort.</p>
                      <button
                        type="button"
                        disabled={updating}
                        onClick={() => void communicate("confirm_time")}
                      >
                        Neue Zeit bestätigen
                      </button>
                      {detail.fulfillmentType === "delivery" &&
                        detail.status === "ready" &&
                        ["owner", "manager"].includes(role) && (
                          <button
                            type="button"
                            disabled={updating}
                            onClick={() => void communicate("dispatch")}
                          >
                            Lieferung als unterwegs bestätigen
                          </button>
                        )}
                    </div>
                  )}
                {role !== "viewer" && detail.paymentState && (
                  <p>
                    Zahlung: <strong>{paymentStateLabels[detail.paymentState]}</strong>
                  </p>
                )}
                {role !== "viewer" &&
                  (detail.paymentState === "refund_failed" ||
                    (detail.status === "cancelled" && detail.paymentState === "paid")) && (
                    <p>Bitte kläre die Erstattung an der Kasse.</p>
                  )}
                {role !== "viewer" && detail.delivery && (
                  <address>
                    {detail.delivery.recipientName}
                    <br />
                    {detail.delivery.addressLine1}
                    <br />
                    {detail.delivery.addressLine2 && (
                      <>
                        {detail.delivery.addressLine2}
                        <br />
                      </>
                    )}
                    {detail.delivery.postalCode} {detail.delivery.city}
                    <br />
                    {detail.delivery.phoneE164}
                  </address>
                )}
                {detail.fulfillmentType === "delivery" && (
                  <p>
                    Liefergebühr: {formatMoney(detail.deliveryFeeAmountMinor ?? 0, detail.currency)}
                  </p>
                )}

                {detail.taxSummary && (
                  <OrderTax summary={detail.taxSummary} currency={detail.currency} />
                )}
              </details>
            )}
            {role !== "viewer" && (
              <div className="operator-detail-actions" aria-label="Status ändern">
                {detail.allowedTransitions
                  .filter((target) => !(detail.status === "submitted" && target === "cancelled"))
                  .sort(
                    (a, b) =>
                      Number(["rejected", "cancelled"].includes(b)) -
                      Number(["rejected", "cancelled"].includes(a)),
                  )
                  .map((target) => (
                    <button
                      key={target}
                      type="button"
                      disabled={updating}
                      className={
                        ["rejected", "cancelled"].includes(target)
                          ? "operator-decline"
                          : "operator-accept"
                      }
                      onClick={() => act(target)}
                    >
                      {target === "ready" && detail.fulfillmentType === "pickup"
                        ? "Abholbereit"
                        : target === "completed" && detail.fulfillmentType === "pickup"
                          ? "Abgeschlossen"
                          : fulfillmentTransitionLabel(target, detail.fulfillmentType)}
                    </button>
                  ))}
              </div>
            )}
            {role !== "viewer" &&
              detail.status === "submitted" &&
              detail.allowedTransitions.includes("cancelled") && (
                <details className="operator-more-actions">
                  <summary aria-label="Weitere Aktionen">⋯</summary>
                  <button type="button" disabled={updating} onClick={() => act("cancelled")}>
                    Stornieren
                  </button>
                </details>
              )}
          </section>
        ) : (
          <section className="operator-detail operator-empty" aria-label="Bestelldetails">
            <p>
              {detailLoading
                ? "Bestelldetails werden geladen …"
                : "Wähle eine Bestellung aus der Liste."}
            </p>
          </section>
        )}
      </div>
      {pendingStatus && (
        <dialog
          ref={reasonDialog}
          className="operator-dialog"
          onCancel={() => setPendingStatus(null)}
        >
          <h2>{pendingStatus === "rejected" ? "Bestellung ablehnen" : "Bestellung stornieren"}</h2>
          <label>
            Grund
            <select
              value={reasonCode}
              disabled={updating}
              onChange={(event) => setReasonCode(event.target.value as OrderReasonCode)}
            >
              {Object.entries(cancellationReasonLabels).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p>{orderReasonLabels[reasonCode]}</p>
          <button
            className="secondary"
            disabled={updating}
            onClick={() => {
              reasonDialog.current?.close();
              setPendingStatus(null);
            }}
          >
            Zurück
          </button>
          <button
            disabled={updating}
            onClick={() => {
              void (async () => {
                await transition(pendingStatus);
                reasonDialog.current?.close();
                setPendingStatus(null);
              })();
            }}
          >
            Bestätigen
          </button>
        </dialog>
      )}
    </div>
  );
}
