import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Storefront from "../../app/storefront/Storefront";
import { MenuEditor } from "../../../dashboard/app/components/MenuEditor";
import { OrderBoard } from "../../../dashboard/app/components/OrderBoard";
import "../../app/styles.css";
const dashboard = new URLSearchParams(location.search).has("dashboard");
const board = new URLSearchParams(location.search).has("board");
if (dashboard || board) void import("../../../dashboard/app/styles.css");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {board ? (
      <OrderBoard
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
