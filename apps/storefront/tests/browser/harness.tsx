import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Storefront from "../../app/storefront/Storefront";
import { MenuEditor } from "../../../dashboard/app/components/MenuEditor";
import "../../app/styles.css";
const dashboard = new URLSearchParams(location.search).has("dashboard");
if (dashboard) void import("../../../dashboard/app/styles.css");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {dashboard ? (
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
