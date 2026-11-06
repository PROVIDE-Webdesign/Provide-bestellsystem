import React from "react";
import { createRoot } from "react-dom/client";
import Storefront from "../app/storefront/Storefront";
import "../app/styles.css";
import "../app/shop-design.css";
import designCatalog from "./catalog.json";
import actualCatalog from "./actual-catalog.json";
const catalog = new URLSearchParams(window.location.search).has("actual")
  ? actualCatalog
  : designCatalog;
const scope = { restaurantSlug: catalog.restaurant.slug, locationSlug: catalog.location.slug };
const menu = catalog.menus[0];
if (!localStorage.getItem("design-b-initialized")) {
  localStorage.setItem(
    `provide:favorites:v1:${scope.restaurantSlug}:${scope.locationSlug}`,
    JSON.stringify(menu.sections[0].items.slice(0, 2).map((i) => i.id)),
  );
  localStorage.setItem("design-b-initialized", "true");
}
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
  if (url.endsWith("/catalog")) return Response.json({ data: catalog });
  if (url.includes("/api/"))
    return Response.json(
      {
        error: {
          message: "Isolierte Gestaltungsprüfung: keine Bestellung oder Zahlung ausgelöst.",
        },
      },
      { status: 503 },
    );
  return originalFetch(input, init);
};
createRoot(document.getElementById("root")!).render(
  <Storefront {...scope} privacyNoticeVersion="design-only" />,
);
