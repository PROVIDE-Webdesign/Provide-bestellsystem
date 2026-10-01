import { LocationOperations } from "../../../dashboard/app/components/LocationOperations";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Storefront from "../../app/storefront/Storefront";
import { MenuEditor } from "../../../dashboard/app/components/MenuEditor";
import { OrderBoard } from "../../../dashboard/app/components/OrderBoard";
import {
  createInvalidationReceiver,
  type OrderLiveSubscriber,
} from "../../../dashboard/lib/order-live";
import "../../app/styles.css";
const operations = new URLSearchParams(location.search).has("operations");
const dashboard = new URLSearchParams(location.search).has("dashboard");
const board = new URLSearchParams(location.search).has("board");
const live = new URLSearchParams(location.search).has("live");
// Synthetic transport only for the native browser harness. Production uses the real SDK.
const syntheticLive: OrderLiveSubscriber = (_restaurant, _location, onChange, onState) => {
  const receive = createInvalidationReceiver(onChange);
  const changed = (event: Event) => {
    if (event instanceof CustomEvent) receive(event.detail);
  };
  const state = (event: Event) => {
    if (event instanceof CustomEvent) {
      onState(event.detail === "live" ? "live" : "fallback");
      onChange();
    }
  };
  window.addEventListener("synthetic-order-event", changed);
  window.addEventListener("synthetic-order-state", state);
  onState("live");
  onChange();
  return () => {
    window.removeEventListener("synthetic-order-event", changed);
    window.removeEventListener("synthetic-order-state", state);
  };
};
if (dashboard || board || operations) void import("../../../dashboard/app/styles.css");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {operations ? (
      <LocationOperations
        restaurantId="f2000000-0000-0000-0000-000000000001"
        locations={[{ id: "f3000000-0000-0000-0000-000000000001", displayName: "Synthetic Mitte" }]}
      />
    ) : board ? (
      <OrderBoard
        liveEnabled={live}
        alertsEnabled={live}
        {...(live ? { subscribeLive: syntheticLive } : {})}
        restaurantId="f2000000-0000-0000-0000-000000000001"
        role="owner"
        locations={[
          {
            id: "f3000000-0000-0000-0000-000000000001",
            slug: "synthetic-mitte",
            displayName: "Synthetic Mitte",
          },
        ]}
      />
    ) : dashboard ? (
      <MenuEditor
        restaurantId="f2000000-0000-0000-0000-000000000001"
        locations={[{ id: "f3000000-0000-0000-0000-000000000001", displayName: "Synthetic Mitte" }]}
      />
    ) : (
      <Storefront
        restaurantSlug="storefront-restaurant-a"
        locationSlug="storefront-a-mitte"
        privacyNoticeVersion="preview-v1"
      />
    )}
  </StrictMode>,
);
