"use client";

import { parseDashboardAcceptance, type DashboardAcceptance } from "@provide/contracts";
import { useEffect, useRef, useState } from "react";
import {
  subscribeDashboardOrderLive,
  type OrderLiveState,
  type OrderLiveSubscriber,
} from "../../lib/order-live.js";
import { acceptanceRemaining, createAlarmTracker, createOrderTone } from "../../lib/order-alarm.js";

interface Props {
  readonly restaurantId: string;
  readonly locationId: string;
  readonly liveEnabled: boolean;
  readonly alertsEnabled: boolean;
  readonly onInvalidate: () => Promise<void>;
  readonly onDenied: () => void;
  readonly onOpen: (orderId: string) => void;
  readonly subscribeLive?: OrderLiveSubscriber;
}
export function OrderInbox({
  restaurantId,
  locationId,
  liveEnabled,
  alertsEnabled,
  onInvalidate,
  onDenied,
  onOpen,
  subscribeLive = subscribeDashboardOrderLive,
}: Props) {
  const [live, setLive] = useState<OrderLiveState>("fallback");
  const [snapshot, setSnapshot] = useState<DashboardAcceptance>();
  const [stale, setStale] = useState(true);
  const [sound, setSound] = useState(false);
  const [soundError, setSoundError] = useState("");
  const [soundBusy, setSoundBusy] = useState(false);
  const soundOperation = useRef(0);
  const [serverNow, setServerNow] = useState(0);
  const tone = useRef<ReturnType<typeof createOrderTone> | undefined>(undefined);
  const enabled = useRef(false);
  const callbacks = useRef({ onInvalidate, onDenied });
  callbacks.current = { onInvalidate, onDenied };
  useEffect(() => {
    let disposed = false,
      blocked = false,
      running = false,
      dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let stopLive = () => {};
    let latest: DashboardAcceptance | undefined;
    let receivedAt = 0;
    const alarm = createAlarmTracker();
    const clock = () => {
      if (!latest) return;
      const now = Date.parse(latest.serverNow) + performance.now() - receivedAt;
      const expired = performance.now() - receivedAt > 30_000;
      setServerNow(now);
      setStale(expired);
      if (
        alarm(
          latest,
          now,
          enabled.current && !expired && !blocked && document.visibilityState !== "hidden",
        ) &&
        tone.current
      )
        void tone.current.play().catch(() => {
          enabled.current = false;
          setSound(false);
          setSoundError("Ton blockiert. Bitte erneut bewusst aktivieren.");
        });
    };
    const refresh = async () => {
      if (disposed || blocked || document.visibilityState === "hidden") return;
      if (running) {
        dirty = true;
        return;
      }
      running = true;
      controller = new AbortController();
      try {
        if (alertsEnabled) {
          const response = await fetch(
            `/api/order-alerts?${new URLSearchParams({ restaurantId, locationId })}`,
            {
              cache: "no-store",
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
            },
          );
          if (disposed || controller.signal.aborted) return;
          if (response.status === 401 || response.status === 403) {
            blocked = true;
            stopLive();
            setLive("fallback");
            latest = undefined;
            setSnapshot(undefined);
            setStale(true);
            enabled.current = false;
            setSound(false);
            callbacks.current.onDenied();
            return;
          }
          if (!response.ok) throw Error("Alert snapshot unavailable");
          const envelope: unknown = await response.json();
          const data =
            envelope !== null && typeof envelope === "object" && "data" in envelope
              ? parseDashboardAcceptance(envelope.data)
              : undefined;
          if (!data || data.restaurantId !== restaurantId || data.locationId !== locationId)
            throw Error("Invalid alert scope");
          if (disposed) return;
          latest = data;
          receivedAt = performance.now();
          setSnapshot(data);
          clock();
        }
      } catch {
        if (!disposed) {
          latest = undefined;
          setSnapshot(undefined);
          setStale(true);
        }
      } finally {
        if (!disposed && !blocked) await callbacks.current.onInvalidate();
        running = false;
        if (dirty && !disposed && !blocked) {
          dirty = false;
          invalidate();
        }
      }
    };
    const invalidate = () => {
      if (disposed || blocked || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, 250);
    };
    if (liveEnabled)
      stopLive = subscribeLive(restaurantId, locationId, invalidate, (state) => {
        if (!disposed) setLive(state);
      });
    void refresh();
    const poll = setInterval(() => void refresh(), 15_000);
    const ticker = setInterval(clock, 1000);
    const resume = () => {
      if (document.visibilityState !== "hidden") invalidate();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      disposed = true;
      soundOperation.current++;
      enabled.current = false;
      controller?.abort();
      stopLive();
      clearInterval(poll);
      clearInterval(ticker);
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      if (tone.current) void tone.current.close().catch(() => {});
      tone.current = undefined;
    };
  }, [restaurantId, locationId, liveEnabled, alertsEnabled, subscribeLive]);

  async function toggleSound() {
    if (soundBusy) return;
    if (sound) {
      enabled.current = false;
      setSound(false);
      return;
    }
    const operation = ++soundOperation.current;
    setSoundBusy(true);
    try {
      tone.current ??= createOrderTone();
      const current = tone.current;
      await current.enable();
      if (operation !== soundOperation.current) return;
      await current.play();
      enabled.current = true;
      setSound(true);
      setSoundError("");
    } catch {
      if (operation === soundOperation.current) {
        enabled.current = false;
        setSound(false);
        setSoundError("Ton konnte nicht aktiviert werden. Sichtbare Hinweise bleiben aktiv.");
      }
    } finally {
      if (operation === soundOperation.current) setSoundBusy(false);
    }
  }
  return (
    <section className="order-inbox" aria-label="Bestelleingang und Alarm">
      <p role="status">
        {live === "live"
          ? "Live verbunden"
          : live === "connecting"
            ? "Live-Verbindung wird aufgebaut"
            : "Live nicht verbunden – sichere Nachladung alle 15 Sekunden"}
      </p>
      {alertsEnabled && (
        <>
          <h2>Offener Bestelleingang{snapshot ? ` (${snapshot.totalPending})` : ""}</h2>
          <p>
            Unabhängig von Listenfiltern. Annahmefrist: 5 Minuten ab Bearbeitbarkeit, getrennt von
            der Zahlungsfrist.
          </p>
          <button
            type="button"
            className="secondary"
            disabled={soundBusy}
            aria-pressed={sound}
            onClick={() => void toggleSound()}
          >
            {sound ? "Ton stummschalten" : "Ton aktivieren und testen"}
          </button>
          <p>
            {sound ? "Ton aktiviert" : "Ton stumm"}. {soundError}
          </p>
          {stale ? (
            <p role="alert" className="warning">
              Eingang nicht aktuell. Bitte Verbindung prüfen; Alarm ist bis zur sicheren Nachladung
              ausgesetzt.
            </p>
          ) : snapshot?.totalPending === 0 ? (
            <p>Keine Bestellung wartet auf Annahme.</p>
          ) : null}
          {!stale && snapshot && (
            <ul className="order-list" aria-label="Zur Annahme priorisiert">
              {snapshot.orders.map((o) => (
                <li key={o.orderId}>
                  <button type="button" className="order-card" onClick={() => onOpen(o.orderId)}>
                    <strong>{o.orderNumber}</strong>
                    <span>
                      {o.fulfillmentType === "delivery" ? "Lieferung" : "Abholung"} ·{" "}
                      {acceptanceRemaining(o.deadline, serverNow)}
                    </span>
                    {o.escalatedAt && <span>Eskalation protokolliert – jetzt prüfen</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!stale && snapshot && snapshot.totalPending > snapshot.orders.length && (
            <p className="warning">
              Angezeigt werden die 100 dringendsten Bestellungen von {snapshot.totalPending}. Nach
              Bearbeitung folgen die übrigen.
            </p>
          )}
          <p>
            Bei Fristüberschreitung: wiederholter Alarm alle 30 Sekunden, sofern Ton aktiviert und
            Eingang aktuell. Manuell prüfen und annehmen oder begründet ablehnen; keine automatische
            Stornierung oder Erstattung.
          </p>
        </>
      )}
    </section>
  );
}
