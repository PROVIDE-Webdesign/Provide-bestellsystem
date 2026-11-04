"use client";

import { useEffect, useState } from "react";

type Scope = { restaurantId: string; locationId: string };
type PushState = { active: boolean; publicKey: string };
type DeviceState = PushState & {
  registration: ServiceWorkerRegistration;
  key: Uint8Array<ArrayBuffer>;
  subscription: PushSubscription | undefined;
};
const workerPath = "/dashboard-push-sw.js";

function onIphoneOrIpad() {
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

function isHomeScreenApp() {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function pushRequest(scope: Scope, body: unknown): Promise<PushState> {
  const response = await fetch("/api/order-push?" + new URLSearchParams(scope).toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Push unavailable");
  const { data } = (await response.json()) as { data?: PushState };
  if (!data || typeof data.active !== "boolean" || !/^B[A-Za-z0-9_-]{86}$/.test(data.publicKey))
    throw new Error("Invalid push status");
  return data;
}

function applicationKey(value: string) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
    char.charCodeAt(0),
  );
}

async function dashboardRegistration() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration?.active && new URL(registration.active.scriptURL).pathname === workerPath
    ? registration
    : undefined;
}

async function prepareDashboardRegistration() {
  const active = await dashboardRegistration();
  if (active) return active;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing?.active || existing?.installing || existing?.waiting) {
    const current = existing.active ?? existing.installing ?? existing.waiting;
    if (new URL(current!.scriptURL).pathname !== workerPath)
      throw new Error("Unexpected service worker");
  }
  await navigator.serviceWorker.register(workerPath, { scope: "/", updateViaCache: "none" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Service worker timeout")), 8000);
      }),
    ]);
    const registration = await dashboardRegistration();
    if (!registration) throw new Error("Unexpected service worker");
    return registration;
  } finally {
    clearTimeout(timer);
  }
}

export async function unsubscribeOrderPushDevice() {
  if (!supported()) return;
  const registration = await dashboardRegistration();
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
}

export function OrderPush({ restaurantId, locationId }: Scope) {
  const [status, setStatus] = useState<DeviceState>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    if (onIphoneOrIpad() && !isHomeScreenApp()) {
      setNote(
        "Auf iPhone oder iPad das Dashboard in Safari über „Teilen“ zum Home-Bildschirm hinzufügen und von dort öffnen.",
      );
    } else if (!supported()) {
      setNote("Dieser Browser unterstützt Hintergrundalarme hier nicht.");
    } else if (Notification.permission === "denied") {
      setNote(
        "Mitteilungen sind blockiert. Erlaube sie in den Einstellungen des Geräts oder Browsers.",
      );
    } else {
      void (async () => {
        const existing = await dashboardRegistration();
        let subscription = await existing?.pushManager.getSubscription();
        const data = await pushRequest(
          { restaurantId, locationId },
          {
            action: "status",
            ...(subscription ? { endpoint: subscription.endpoint } : {}),
          },
        );
        if (disposed) return;
        const registration = existing ?? (await prepareDashboardRegistration());
        const key = applicationKey(data.publicKey);
        const previousKey = subscription?.options.applicationServerKey;
        if (
          previousKey &&
          (previousKey.byteLength !== key.byteLength ||
            new Uint8Array(previousKey).some((byte, index) => byte !== key[index]))
        ) {
          await subscription?.unsubscribe();
          subscription = null;
        }
        if (!disposed)
          setStatus({
            ...data,
            registration,
            key,
            active: data.active && Boolean(subscription),
            subscription: subscription ?? undefined,
          });
      })().catch(() => {
        if (!disposed) setNote("Hintergrundalarm derzeit nicht verfügbar.");
      });
    }
    return () => {
      disposed = true;
    };
  }, [restaurantId, locationId]);

  async function toggle() {
    if (busy || !status) return;
    setBusy(true);
    setNote("");
    const scope = { restaurantId, locationId };
    try {
      if (status.active && status.subscription) {
        await pushRequest(scope, { action: "remove", endpoint: status.subscription.endpoint });
        const unsubscribed = await status.subscription.unsubscribe().catch(() => false);
        setStatus({
          ...status,
          active: false,
          subscription: unsubscribed ? undefined : status.subscription,
        });
        return;
      }
      // Call subscribe directly from the tap so iOS can show its permission prompt.
      const subscription =
        status.subscription ??
        (await status.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: status.key,
        }));
      const keys = subscription.toJSON().keys;
      const data = await pushRequest(scope, {
        action: "subscribe",
        endpoint: subscription.endpoint,
        p256dh: keys?.p256dh,
        auth: keys?.auth,
      });
      if (!data.active) throw new Error("Subscription unavailable");
      setStatus({ ...status, ...data, subscription });
    } catch {
      setNote(
        Notification.permission === "denied"
          ? "Mitteilungen sind blockiert. Erlaube sie in den Einstellungen des Geräts oder Browsers."
          : "Der Hintergrundalarm konnte nicht geändert werden. Bitte versuche es erneut.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p role="status">
        {note ||
          (status?.active
            ? "Hintergrundalarm auf diesem Gerät für diesen Standort aktiv. Der Ton folgt den Mitteilungseinstellungen."
            : "Hintergrundalarm auf diesem Gerät für diesen Standort aus. Pro Gerät ist ein Standort möglich.")}
      </p>
      {status && (
        <button
          type="button"
          className="secondary"
          aria-pressed={status.active}
          disabled={busy}
          onClick={() => void toggle()}
        >
          {status.active ? "Hintergrundalarm ausschalten" : "Hintergrundalarm aktivieren"}
        </button>
      )}
    </div>
  );
}
