import { orderLiveTopic, parseOrderInvalidation } from "@provide/contracts";
import { REALTIME_SUBSCRIBE_STATES, type SupabaseClient } from "@supabase/supabase-js";
import { createDashboardBrowserClient } from "./supabase-browser.js";

export type OrderLiveState = "connecting" | "live" | "fallback";
export type OrderLiveSubscriber = (
  restaurantId: string,
  locationId: string,
  onChange: () => void,
  onState: (state: OrderLiveState) => void,
) => () => void;

// Per-subscription bounded deduplication. Events only invalidate; ordering is never trusted.
export function createInvalidationReceiver(onChange: () => void) {
  const seen = new Set<string>();
  return (value: unknown) => {
    const event = parseOrderInvalidation(value);
    if (!event || seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 256) seen.delete(seen.values().next().value!);
    onChange();
  };
}

export function subscribeOrderLive(
  client: SupabaseClient,
  restaurantId: string,
  locationId: string,
  onChange: () => void,
  onState: (state: OrderLiveState) => void,
): () => void {
  let stopped = false;
  const channel = client.channel(orderLiveTopic(restaurantId, locationId), {
    config: { private: true },
  });
  const receive = createInvalidationReceiver(onChange);
  onState("connecting");
  channel.on("broadcast", { event: "orders.invalidated.v1" }, (message) => {
    if (!stopped) receive(message.payload);
  });
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event) => {
    if (stopped) return;
    if (event === "SIGNED_OUT") {
      onState("fallback");
      onChange();
      stopped = true;
      void client.removeChannel(channel).catch(() => {});
    }
    // Supabase client propagates refreshed JWTs itself. Revalidate data on every auth change.
    else onChange();
  });
  void client.realtime
    .setAuth()
    .then(() => {
      if (stopped) return;
      channel.subscribe((state) => {
        if (stopped) return;
        onState(state === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED ? "live" : "fallback");
        // Snapshot on every join/rejoin closes gaps; fallback polling does not depend on the socket.
        onChange();
      });
    })
    .catch(() => {
      if (!stopped) onState("fallback");
    });
  return () => {
    stopped = true;
    subscription.unsubscribe();
    void client.removeChannel(channel).catch(() => {});
  };
}
export const subscribeDashboardOrderLive: OrderLiveSubscriber = (
  restaurantId,
  locationId,
  onChange,
  onState,
) => {
  const client = createDashboardBrowserClient();
  if (!client) {
    onState("fallback");
    return () => {};
  }
  return subscribeOrderLive(client, restaurantId, locationId, onChange, onState);
};
