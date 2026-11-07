"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createOrderTone, type OrderTone } from "../../lib/order-alarm.js";

const soundPreferenceKey = "provide-dashboard-order-tone-v1";

interface OrderSound {
  readonly preferred: boolean;
  readonly ready: boolean;
  readonly busy: boolean;
  readonly error: string;
  readonly toggle: () => void;
  readonly canPlay: () => boolean;
  readonly play: () => void;
}

const OrderSoundContext = createContext<OrderSound | undefined>(undefined);

export function useOrderSound() {
  const sound = useContext(OrderSoundContext);
  if (!sound) throw new Error("Missing order sound provider");
  return sound;
}

export function OrderSoundProvider({ children }: { readonly children: ReactNode }) {
  const [preferred, setPreferred] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preference = useRef(false);
  const readyRef = useRef(false);
  const busyRef = useRef(false);
  const operation = useRef(0);
  const tone = useRef<OrderTone | undefined>(undefined);

  const updateReady = useCallback((value: boolean) => {
    readyRef.current = value;
    setReady(value);
  }, []);

  const activate = useCallback(
    async (test: boolean) => {
      if (!preference.current || busyRef.current) return;
      const id = ++operation.current;
      busyRef.current = true;
      setBusy(true);
      setError("");
      try {
        const current = (tone.current ??= createOrderTone());
        await current.enable();
        if (id !== operation.current) return;
        if (test) await current.play();
        if (id === operation.current) updateReady(true);
      } catch {
        if (id === operation.current) {
          updateReady(false);
          setError("Ton konnte nicht freigegeben werden. Tippe erneut ins Dashboard.");
        }
      } finally {
        if (id === operation.current) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [updateReady],
  );

  useEffect(() => {
    try {
      preference.current = window.localStorage.getItem(soundPreferenceKey) === "on";
      setPreferred(preference.current);
    } catch {
      // The setting can still be changed for this open dashboard.
    }
    const resume = (event: MouseEvent) => {
      if (
        event.isTrusted &&
        preference.current &&
        (!readyRef.current || !tone.current?.isRunning()) &&
        !(event.target instanceof Element && event.target.closest("[data-order-sound-toggle]"))
      )
        void activate(false);
    };
    const checkOutput = () => {
      if (document.visibilityState === "visible" && !tone.current?.isRunning()) updateReady(false);
    };
    window.addEventListener("click", resume, true);
    document.addEventListener("visibilitychange", checkOutput);
    return () => {
      operation.current++;
      busyRef.current = false;
      readyRef.current = false;
      window.removeEventListener("click", resume, true);
      document.removeEventListener("visibilitychange", checkOutput);
      void tone.current?.close().catch(() => {});
      tone.current = undefined;
    };
  }, [activate, updateReady]);

  function toggle() {
    if (busyRef.current) return;
    const value = !preference.current;
    preference.current = value;
    setPreferred(value);
    setError("");
    try {
      window.localStorage.setItem(soundPreferenceKey, value ? "on" : "off");
    } catch {
      // Keep the explicit choice in memory if browser storage is unavailable.
    }
    if (value) void activate(true);
    else updateReady(false);
  }

  const canPlay = useCallback(() => preference.current && readyRef.current, []);
  const play = useCallback(() => {
    if (!canPlay()) return;
    const id = operation.current;
    void tone.current?.play().catch(() => {
      if (id !== operation.current || !preference.current) return;
      updateReady(false);
      setError("Ton konnte nicht abgespielt werden. Tippe erneut ins Dashboard.");
    });
  }, [canPlay, updateReady]);

  return (
    <OrderSoundContext.Provider value={{ preferred, ready, busy, error, toggle, canPlay, play }}>
      {children}
    </OrderSoundContext.Provider>
  );
}
