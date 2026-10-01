import { describe, expect, it, vi } from "vitest";
import { createInvalidationReceiver, subscribeOrderLive } from "./order-live.js";
import {
  createClient,
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
} from "@supabase/supabase-js";
describe("private live subscription", () => {
  it("ignores malformed hints and bounded duplicate event IDs", () => {
    const changed = vi.fn(),
      receive = createInvalidationReceiver(changed);
    const first = { schemaVersion: 1, id: "fa000000-0000-0000-0000-000000000001" };
    receive(null);
    receive({ ...first, customer: "hidden" });
    receive(first);
    receive(first);
    expect(changed).toHaveBeenCalledTimes(1);
    for (let i = 2; i < 259; i++)
      receive({
        schemaVersion: 1,
        id: `fa000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      });
    receive(first); // Old IDs can evict safely: only a fresh authorized snapshot, never double mutation.
    expect(changed).toHaveBeenCalledTimes(259);
  });
  it("requests a private receive-only channel and tears it down on scope exit", async () => {
    let handler: Parameters<RealtimeChannel["subscribe"]>[0];
    const client = createClient("http://127.0.0.1:54321", "synthetic-test-publishable-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const channel = client.channel("synthetic-test");
    const channelSpy = vi.spyOn(client, "channel").mockReturnValue(channel);
    vi.spyOn(channel, "subscribe").mockImplementation((fn) => {
      handler = fn;
      return channel;
    });
    vi.spyOn(client.realtime, "setAuth").mockResolvedValue(undefined);
    const authSubscription = client.auth.onAuthStateChange(() => {}).data.subscription;
    const unsubscribe = vi.spyOn(authSubscription, "unsubscribe");
    vi.spyOn(client.auth, "onAuthStateChange").mockReturnValue({
      data: { subscription: authSubscription },
    });
    const removeChannel = vi.spyOn(client, "removeChannel").mockResolvedValue("ok");
    const change = vi.fn(),
      state = vi.fn();
    const stop = subscribeOrderLive(
      client,
      "f2000000-0000-0000-0000-000000000001",
      "f3000000-0000-0000-0000-000000000001",
      change,
      state,
    );
    await Promise.resolve();
    expect(channelSpy).toHaveBeenCalledWith(expect.stringMatching(/^orders:v1:/), {
      config: { private: true },
    });
    handler?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    expect(state).toHaveBeenLastCalledWith("live");
    expect(change).toHaveBeenCalledTimes(1);
    handler?.(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
    expect(state).toHaveBeenLastCalledWith("fallback");
    stop();
    handler?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    expect(state).toHaveBeenLastCalledWith("fallback");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
