"use client";

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
} from "@provide/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  formatMoney,
  formatOrderTime,
  orderStatusLabels,
  fulfillmentStatusLabel,
  fulfillmentTransitionLabel,
} from "@/lib/order-ui.js";

interface OrderBoardProps {
  readonly restaurantId: string;
  readonly role: RestaurantRole;
  readonly locations: readonly DashboardLocationAccess[];
}

function envelopeData(value: unknown): unknown {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).data
    : undefined;
}

export function OrderBoard({ restaurantId, role, locations }: OrderBoardProps) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [status, setStatus] = useState<DashboardOrderStatus | "">("");
  const [fulfillment, setFulfillment] = useState("");
  const [orders, setOrders] = useState<DashboardOrderList>();
  const [detail, setDetail] = useState<DashboardOrderDetail>();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);

  const loadOrders = useCallback(
    async (cursor?: string) => {
      if (!locationId || document.visibilityState === "hidden") return;
      listRequest.current?.abort();
      const controller = new AbortController();
      listRequest.current = controller;
      setLoading(true);
      try {
        const query = new URLSearchParams({ restaurantId, locationId, limit: "25" });
        if (fulfillment) query.set("fulfillmentType", fulfillment);
        if (status) query.set("status", status);
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(`/api/orders?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const parsed = parseDashboardOrderList(envelopeData(await response.json()));
        if (!parsed) throw new Error();
        if (controller.signal.aborted) return;
        setOrders((current) =>
          cursor && current ? { ...parsed, orders: [...current.orders, ...parsed.orders] } : parsed,
        );
        setMessage("");
      } catch {
        if (controller.signal.aborted) return;
        setMessage("Die Bestellungen konnten nicht sicher aktualisiert werden.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [locationId, restaurantId, status, fulfillment],
  );

  useEffect(() => {
    void loadOrders();
    const interval = window.setInterval(() => void loadOrders(), 15_000);
    return () => {
      window.clearInterval(interval);
      listRequest.current?.abort();
      detailRequest.current?.abort();
    };
  }, [loadOrders]);

  async function loadDetail(orderId: string) {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setDetail(undefined);
    setMessage("");
    try {
      const query = new URLSearchParams({ restaurantId, locationId });
      const response = await fetch(`/api/orders/${orderId}?${query}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error();
      const parsed = parseDashboardOrderDetail(envelopeData(await response.json()));
      if (!parsed) throw new Error();
      if (controller.signal.aborted) return;
      setDetail(parsed);
    } catch {
      if (controller.signal.aborted) return;
      setMessage("Die Bestelldetails konnten nicht sicher geladen werden.");
    }
  }

  async function transition(targetStatus: DashboardOrderStatus) {
    if (!detail || updating) return;
    setUpdating(true);
    setMessage("");
    try {
      const query = new URLSearchParams({ restaurantId, locationId });
      const response = await fetch(`/api/orders/${detail.orderId}/status?${query}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedStatus: detail.status, targetStatus }),
      });
      if (response.status === 409) {
        setMessage("Die Bestellung wurde zwischenzeitlich geändert und wird neu geladen.");
        setDetail(undefined);
        await loadOrders();
        return;
      }
      if (!response.ok) throw new Error();
      if (!parseDashboardOrderStatusResult(envelopeData(await response.json()))) throw new Error();
      setDetail(undefined);
      await loadOrders();
    } catch {
      setMessage("Der Status konnte nicht sicher geändert werden.");
    } finally {
      setUpdating(false);
    }
  }

  async function retryRefund() {
    if (!detail || updating) return;
    setUpdating(true);
    setMessage("");
    try {
      const r = await fetch(
        `/api/orders/${detail.orderId}/refund-retry?${new URLSearchParams({ restaurantId, locationId })}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      if (!r.ok) throw new Error("Refund retry failed");
      await loadDetail(detail.orderId);
    } catch {
      setMessage(
        "Die Erstattung konnte nicht erneut angefordert werden. Bitte aktualisiere den Zahlungsstatus.",
      );
    } finally {
      setUpdating(false);
    }
  }

  if (role === "driver")
    return <p className="notice">Für Fahrer ist die Bestellbearbeitung gesperrt.</p>;
  if (locations.length === 0)
    return <p className="notice">Ohne Standortzuweisung ist keine Bestellbearbeitung möglich.</p>;

  return (
    <div className="order-board">
      <div className="order-controls">
        <label>
          Bestellart
          <select
            disabled={updating}
            value={fulfillment}
            onChange={(e) => {
              setFulfillment(e.target.value);
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

      {message && (
        <p role="alert" className="warning">
          {message}
        </p>
      )}
      {orders?.orders.length === 0 && <p>Für diesen Filter liegen keine Bestellungen vor.</p>}
      {orders && orders.orders.length > 0 && (
        <ul className="order-list" aria-label="Bestellungen">
          {orders.orders.map((order) => (
            <li key={order.orderId}>
              <button
                className="order-card"
                type="button"
                onClick={() => void loadDetail(order.orderId)}
              >
                <span className="order-number">#{order.orderId.slice(-8).toUpperCase()}</span>
                <strong>{fulfillmentStatusLabel(order.status, order.fulfillmentType)}</strong>
                {order.paymentState && <span>{paymentStateLabels[order.paymentState]}</span>}
                <span>
                  {order.fulfillmentType === "delivery" ? "Lieferung" : "Abholung"}{" "}
                  {formatOrderTime(order.requestedFor)}
                </span>
                <span>
                  {order.itemCount} Artikel · {formatMoney(order.totalAmountMinor, order.currency)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {orders?.nextCursor && (
        <button
          className="secondary"
          type="button"
          disabled={loading}
          onClick={() => void loadOrders(orders.nextCursor ?? undefined)}
        >
          Weitere Bestellungen laden
        </button>
      )}

      {detail && (
        <section className="order-detail" aria-labelledby={`order-${detail.orderId}`}>
          <div className="detail-heading">
            <div>
              <p className="eyebrow">Bestelldetails</p>
              <h3 id={`order-${detail.orderId}`}>#{detail.orderId.slice(-8).toUpperCase()}</h3>
            </div>
            <button className="secondary" type="button" onClick={() => setDetail(undefined)}>
              Schließen
            </button>
          </div>
          <p>
            <strong>{fulfillmentStatusLabel(detail.status, detail.fulfillmentType)}</strong> ·{" "}
            {detail.fulfillmentType === "delivery" ? "Lieferung" : "Abholung"}{" "}
            {formatOrderTime(detail.requestedFor)}
          </p>
          {detail.contactName && (
            <p>
              Name: <strong>{detail.contactName}</strong>
            </p>
          )}
          {detail.paymentState && (
            <p>
              Zahlung: <strong>{paymentStateLabels[detail.paymentState]}</strong>
            </p>
          )}
          {detail.paymentState === "refund_failed" && (
            <button type="button" disabled={updating} onClick={() => void retryRefund()}>
              Vollerstattung nach Prüfung erneut anfordern
            </button>
          )}
          {detail.delivery && (
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
            <p>Liefergebühr: {formatMoney(detail.deliveryFeeAmountMinor ?? 0, detail.currency)}</p>
          )}
          <ul className="line-list">
            {detail.lines.map((line) => (
              <li key={line.lineNumber}>
                <span>
                  {line.quantity} × {line.displayName}
                </span>
                <span>{formatMoney(line.lineAmountMinor, detail.currency)}</span>
              </li>
            ))}
          </ul>
          <p className="order-total">
            Gesamt: {formatMoney(detail.totalAmountMinor, detail.currency)}
          </p>
          {detail.allowedTransitions.length > 0 && (
            <div className="status-actions" aria-label="Status ändern">
              {detail.allowedTransitions.map((target) => (
                <button
                  key={target}
                  type="button"
                  disabled={updating}
                  onClick={() => void transition(target)}
                >
                  {fulfillmentTransitionLabel(target, detail.fulfillmentType)}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
