import { parsePublicCatalog } from "./contracts/storefront-output.js";

class SelectionError extends Error {}

const cart = document.querySelector("[data-order-cart-7i]");
const bridge = window.ASIAN_KITCHEN_ORDERING_BRIDGE;
if (cart && bridge) {
  const dialog = document.createElement("dialog");
  dialog.className = "website-cart-drawer";
  dialog.setAttribute("aria-labelledby", "website-cart-title");
  dialog.innerHTML = `<div class="drawer-handle" aria-hidden="true"></div><header><h2 id="website-cart-title">Dein Warenkorb</h2><button type="button" data-drawer-close aria-label="Warenkorb schließen">×</button></header><div data-drawer-content></div><footer><div class="drawer-total"><span>Gesamt</span><strong data-drawer-total>0,00 €</strong></div><button type="button" class="drawer-checkout">Weiter zur Kasse <span aria-hidden="true">›</span></button><p data-drawer-message role="status"></p></footer>`;
  const bar = document.createElement("button");
  bar.className = "website-cart-bar";
  bar.type = "button";
  bar.setAttribute("aria-haspopup", "dialog");
  bar.textContent = "Warenkorb · 0 Artikel · 0,00 €";
  document.body.append(dialog, bar);
  document.body.classList.add("has-website-cart");
  dialog.querySelector("[data-drawer-content]").append(cart);
  let trigger;
  const close = () => dialog.close();
  const open = () => {
    trigger = document.activeElement;
    dialog.showModal();
    document.documentElement.classList.add("cart-drawer-open");
  };
  bar.addEventListener("click", open);
  document.addEventListener("click", (event) => {
    if (event.target.closest('a[href="#order"]')) {
      event.preventDefault();
      open();
    }
  });
  dialog.querySelector("[data-drawer-close]").addEventListener("click", close);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("cart-drawer-open");
    trigger?.focus();
  });
  const checkout = dialog.querySelector(".drawer-checkout");
  const message = dialog.querySelector("[data-drawer-message]");
  const money = (n) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n / 100);
  function refresh() {
    const draft = bridge.createOrderDraft();
    const quantity = draft.items.reduce((n, item) => n + item.quantity, 0);
    const total = money(draft.totals.subtotalCents);
    bar.textContent = `Warenkorb · ${quantity} Artikel · ${total}  ›`;
    dialog.querySelector("[data-drawer-total]").textContent = total;
    checkout.disabled = quantity === 0;
    for (const row of cart.querySelectorAll(".order-cart-item-7j")) {
      if (row.querySelector(".drawer-dish-photo")) continue;
      const card = document.querySelector(`.dish-card[data-dish-id="${row.dataset.dishId}"]`);
      const image = card?.dataset.image;
      if (image?.startsWith("data:image/")) {
        const photo = document.createElement("img");
        photo.className = "drawer-dish-photo";
        photo.src = image;
        photo.alt = "";
        row.prepend(photo);
      }
    }
  }
  new MutationObserver(refresh).observe(cart.querySelector("[data-cart-items-7i]"), {
    childList: true,
    subtree: true,
    characterData: true,
  });
  refresh();
  checkout.addEventListener("click", async () => {
    checkout.disabled = true;
    message.textContent = "Deine Auswahl wird für den Shop vorbereitet …";
    try {
      const draft = bridge.createOrderDraft();
      const manifest = await fetch(new URL("./manifest.json", import.meta.url), {
        signal: AbortSignal.timeout(10000),
      }).then((r) => {
        if (!r.ok)
          throw new SelectionError(
            "Die Shop-Verbindung ist gerade nicht erreichbar. Bitte erneut versuchen.",
          );
        return r.json();
      });
      const path = `/r/${manifest.restaurantSlug}/${manifest.locationSlug}`;
      const response = await fetch(
        `/api/storefront/${manifest.restaurantSlug}/${manifest.locationSlug}/catalog`,
        { cache: "no-store", signal: AbortSignal.timeout(10000) },
      );
      if (!response.ok)
        throw new SelectionError(
          "Die Speisekarte ist gerade nicht erreichbar. Bitte erneut versuchen.",
        );
      const catalog = parsePublicCatalog((await response.json()).data);
      const lines = draft.items.map((item) => {
        const mapping = manifest.items[item.id];
        if (!mapping || item.specialRequest?.trim())
          throw new SelectionError("Bitte die Auswahl und Sonderwünsche prüfen.");
        const variant = mapping.variants.find((v) => v.label === item.variant);
        if ((item.variant && !variant) || (!item.variant && mapping.variants.length))
          throw new SelectionError("Bitte eine Variante auswählen.");
        return {
          menuItemId: mapping.menuItemId,
          quantity: item.quantity,
          ...(variant ? { variantId: variant.id } : {}),
        };
      });
      const menu = catalog.menus.find((m) =>
        lines.every((line) =>
          m.sections.some((s) => s.items.some((i) => i.id === line.menuItemId)),
        ),
      );
      if (!menu || !lines.length)
        throw new SelectionError("Diese Auswahl ist im Shop gerade nicht verfügbar.");
      const token = Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      sessionStorage.setItem(
        `provide:website-cart:${token}`,
        JSON.stringify({
          restaurantSlug: manifest.restaurantSlug,
          locationSlug: manifest.locationSlug,
          expiresAt: Date.now() + 600000,
          selection: { schemaVersion: 1, menuId: menu.id, menuVersionId: menu.versionId, lines },
        }),
      );
      window.location.assign(`${path}#website-cart=${token}`);
    } catch (error) {
      message.textContent =
        error instanceof SelectionError
          ? error.message
          : "Die Übergabe ist gerade nicht möglich. Bitte erneut versuchen.";
      refresh();
    }
  });
}
