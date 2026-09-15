"use client";

import {
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
import { useCallback, useEffect, useState } from "react";

import {
  formatMoney,
  formatOrderTime,
  orderStatusLabels,
  transitionLabels,
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
  const [orders, setOrders] = useState<DashboardOrderList>();
  const [detail, setDetail] = useState<DashboardOrderDetail>();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const loadOrders = useCallback(
    async (cursor?: string) => {
      if (!locationId || document.visibilityState === "hidden") return;
      setLoading(true);
      try {
        const query = new URLSearchParams({ restaurantId, locationId, limit: "25" });
        if (status) query.set("status", status);
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(`/api/orders?${query}`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const parsed = parseDashboardOrderList(envelopeData(await response.json()));
        if (!parsed) throw new Error();
        setOrders((current) =>
          cursor && current ? { ...parsed, orders: [...current.orders, ...parsed.orders] } : parsed,
        );
        setMessage("");
      } catch {
        setMessage("Die Bestellungen konnten nicht sicher aktualisiert werden.");
      } finally {
        setLoading(false);
      }
    },
    [locationId, restaurantId, status],
  );

  useEffect(() => {
    void loadOrders();
    const interval = window.setInterval(() => void loadOrders(), 15_000);
    return () => window.clearInterval(interval);
  }, [loadOrders]);

  async function loadDetail(orderId: string) {
    setMessage("");
    try {
      const query = new URLSearchParams({ restaurantId, locationId });
      const response = await fetch(`/api/orders/${orderId}?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const parsed = parseDashboardOrderDetail(envelopeData(await response.json()));
      if (!parsed) throw new Error();
      setDetail(parsed);
    } catch {
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

  if (role === "driver")
    return <p className="notice">Für Fahrer ist die Bestellbearbeitung gesperrt.</p>;
  if (locations.length === 0)
    return <p className="notice">Ohne Standortzuweisung ist keine Bestellbearbeitung möglich.</p>;

  return (
    <div className="order-board">
      <div className="order-controls">
        <label>
          Standort
          <select
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setDetail(undefined);
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
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as DashboardOrderStatus | "");
              setDetail(undefined);
            }}
          >
            <option value="">Alle Bestellungen</option>
            {publicOrderStatuses.map((value) => (
              <option key={value} value={value}>
                {orderStatusLabels[value]}
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
                <strong>{orderStatusLabels[order.status]}</strong>
                <span>Abholung {formatOrderTime(order.requestedFor)}</span>
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
            <strong>{orderStatusLabels[detail.status]}</strong> · Abholung{" "}
            {formatOrderTime(detail.requestedFor)}
          </p>
          {detail.contactName && (
            <p>
              Abholname: <strong>{detail.contactName}</strong>
            </p>
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
                  {transitionLabels[target]}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
