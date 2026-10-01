import type { DashboardAcceptance } from "@provide/contracts";

export function acceptanceRemaining(deadline: string, serverNow: number): string {
  const seconds = Math.ceil((Date.parse(deadline) - serverNow) / 1000);
  return seconds <= 0
    ? "Annahmefrist überschritten"
    : `Annehmen in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
// A sound marks a snapshot, not a websocket event. Reconnects and duplicate hints cannot replay it.
export function createAlarmTracker() {
  let ids = new Set<string>();
  let lastOverdue = -Infinity;
  return (snapshot: DashboardAcceptance, now: number, enabled: boolean) => {
    const fresh = snapshot.orders.some((o) => !ids.has(o.orderId));
    ids = new Set(snapshot.orders.map((o) => o.orderId));
    const overdue = snapshot.orders.some((o) => Date.parse(o.deadline) <= now);
    if (!enabled) return false;
    if (fresh || (overdue && now - lastOverdue >= 30_000)) {
      lastOverdue = now;
      return true;
    }
    return false;
  };
}
export interface OrderTone {
  enable(): Promise<void>;
  play(): Promise<void>;
  close(): Promise<void>;
}
async function boundedAudioOperation(operation: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("Audio output unavailable")), 2000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
export function createOrderTone(): OrderTone {
  let context: AudioContext | undefined;
  return {
    async enable() {
      context ??= new AudioContext();
      await boundedAudioOperation(context.resume());
      if (context.state !== "running") throw Error("Sound unavailable");
    },
    async play() {
      if (!context || context.state !== "running") throw Error("Sound unavailable");
      const oscillator = context.createOscillator(),
        gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, context.currentTime + 0.02);
      gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.25);
      oscillator.connect(gain);
      gain.connect(context.destination);
      const ended = new Promise<void>((resolve) => {
        oscillator.onended = () => {
          resolve();
        };
      });
      oscillator.start();
      oscillator.stop(context.currentTime + 0.26);
      try {
        await boundedAudioOperation(ended);
      } finally {
        oscillator.onended = null;
        oscillator.disconnect();
        gain.disconnect();
      }
    },
    async close() {
      if (context) await context.close();
      context = undefined;
    },
  };
}
