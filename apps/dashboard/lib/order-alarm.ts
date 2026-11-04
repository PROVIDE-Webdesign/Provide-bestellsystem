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
async function boundedAudioOperation(operation: Promise<void>, timeoutMs = 2000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("Audio output unavailable")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
type BrowserAudioSession = { type: string };
let playback: { session: BrowserAudioSession; previousType: string; users: number } | undefined;

function acquireAlarmPlayback() {
  const session = (
    globalThis.navigator as (Navigator & { audioSession?: BrowserAudioSession }) | undefined
  )?.audioSession;
  if (!session) return;
  if (playback?.session !== session) {
    if (session.type !== "auto" && session.type !== "ambient") return;
    const previousType = session.type;
    // On iOS the default Web Audio session is silenced by the ring/silent switch.
    try {
      session.type = "playback";
    } catch {
      return;
    }
    playback = { session, previousType, users: 0 };
  }
  const active = playback;
  active.users++;
  return () => {
    if (--active.users !== 0) return;
    if (playback === active) playback = undefined;
    if (session.type === "playback") session.type = active.previousType;
  };
}

export function createOrderTone(): OrderTone {
  let context: AudioContext | undefined;
  let outputReady = false;
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
      const start = context.currentTime;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.32, start + 0.02);
      gain.gain.setValueAtTime(0.32, start + 0.32);
      gain.gain.linearRampToValueAtTime(0, start + 0.46);
      oscillator.connect(gain);
      gain.connect(context.destination);
      const ended = new Promise<void>((resolve) => {
        oscillator.onended = () => {
          resolve();
        };
      });
      let releasePlayback: (() => void) | undefined;
      try {
        releasePlayback = acquireAlarmPlayback();
        oscillator.start(start);
        oscillator.stop(start + 0.48);
        // The first native output can include device startup before its short tone.
        // Keep later alarms on the shorter failure deadline once output is confirmed.
        await boundedAudioOperation(ended, outputReady ? 2000 : 5000);
        outputReady = true;
      } finally {
        oscillator.onended = null;
        oscillator.disconnect();
        gain.disconnect();
        releasePlayback?.();
      }
    },
    async close() {
      if (context) await context.close();
      context = undefined;
      outputReady = false;
    },
  };
}
