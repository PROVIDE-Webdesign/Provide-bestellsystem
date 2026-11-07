import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { OrderInbox } from "../../app/components/OrderInbox";
import { OrderSoundProvider } from "../../app/components/OrderSoundProvider";
import "../../app/styles.css";
import "../../app/components/order-inbox-control.css";
const scopes = {
  A: {
    restaurantId: "a2000000-0000-4000-8000-000000000001",
    locationId: "a3000000-0000-4000-8000-000000000001",
    locationName: "Marktgarten Mitte",
  },
  B: {
    restaurantId: "b2000000-0000-4000-8000-000000000001",
    locationId: "b3000000-0000-4000-8000-000000000001",
    locationName: "Testküche Mitte",
  },
};
function Fixture() {
  const [selected, setSelected] = useState<"A" | "B">("A");
  const scope = scopes[selected];
  return (
    <>
      <select
        aria-label="Restaurant wählen"
        value={selected}
        onChange={(event) => setSelected(event.target.value as "A" | "B")}
      >
        <option>A</option>
        <option>B</option>
      </select>
      <div id={`operator-inbox-${scope.restaurantId}`} />
      <OrderInbox
        key={selected}
        {...scope}
        compact
        liveEnabled={false}
        alertsEnabled
        pushEnabled
        onInvalidate={() => Promise.resolve()}
        onDenied={() => {}}
        onOpen={() => {}}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <OrderSoundProvider>
    <Fixture />
  </OrderSoundProvider>,
);
