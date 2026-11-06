"use client";
import { useEffect, useRef, useState } from "react";
import type { PublicCatalog, OrderSelectionLine, FulfillmentType } from "@provide/contracts";
import { favoritesKey, parseFavorites } from "./favorites";
import { ItemPicker } from "./ItemPicker";

type Menu = PublicCatalog["menus"][number];
type Item = Menu["sections"][number]["items"][number];
type Entry = { menu: Menu; item: Item; category: string };
export type ShopTab = "menu" | "cart" | "orders";
export function ShopIcon({ name, filled = false }: { name: string; filled?: boolean }) {
  const paths: Record<string, string> = {
    heart:
      "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
    plus: "M12 5v14M5 12h14",
    arrow: "m9 5 7 7-7 7",
    clock: "M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    bag: "M5 6h14l2 15H3L5 6ZM8 8V5a4 4 0 0 1 8 0v3",
    cart: "M2 3h3l3 13h11l3-10H6M10 21h.01M18 21h.01",
    menu: "M4 2v6m4-6v6M2 2v5a4 4 0 0 0 8 0V2M6 11v11M18 2v20m0-20c-4 4-5 10 0 10",
    orders:
      "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM8 7h8M8 11h8M8 15h5",
    close: "m5 5 14 14M5 19 19 5",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.plus} />
    </svg>
  );
}

// The approved artwork is reused only as a photographic sprite. All controls,
// text, prices and navigation are real HTML; no screenshot overlay is used.
const asianPhotos: Record<string, string> = {
  Frühlingsrollen: "dish-1",
  Gyoza: "dish-2",
  "Edamame Meersalz": "dish-3",
  "Tempura Garnelen": "dish-4",
  "Crispy Duck": "dish-5",
  "Beef Teriyaki": "dish-6",
  "Miso Lachs": "dish-7",
  "Thai Green Curry": "dish-8",
  "Mochi Trio": "dish-17",
  "Matcha Cheesecake": "dish-18",
  "Mango Sticky Rice": "dish-19",
  "Yuzu Crème Brûlée": "dish-20",
};
// Editorial selection for the existing Asian Kitchen demo, not sales statistics.
const asianPopular = ["Gyoza", "Crispy Duck", "Beef Teriyaki", "Miso Lachs"];
export function FoodPhoto({
  name,
  small = false,
  asian = false,
}: {
  name: string;
  small?: boolean;
  asian?: boolean;
}) {
  const photo = asian ? asianPhotos[name.replace(/^TEST\s+/i, "")] : undefined;
  if (photo)
    return (
      <span className={`food-photo ${small ? "food-small" : ""}`} aria-hidden="true">
        <img className="catalog-photo" src={`/shop-design/${photo}.webp`} alt="" loading="lazy" />
      </span>
    );
  const match = /chicken teriyaki/i.test(name)
    ? "chicken"
    : /veggie bowl/i.test(name)
      ? "veggie"
      : /salmon bowl/i.test(name)
        ? "salmon"
        : undefined;
  return (
    <span
      className={`food-photo ${small ? "food-small" : ""} ${match ?? "food-empty"}`}
      aria-hidden="true"
    >
      {match ? <img src="/shop-design/reference-b.png" alt="" /> : <ShopIcon name="menu" />}
    </span>
  );
}

export function ShopHeader({
  catalog,
  fulfillment,
  onFulfillment,
  onTimes,
  disabled = false,
}: {
  catalog: PublicCatalog;
  fulfillment: FulfillmentType;
  onFulfillment: (type: FulfillmentType) => void;
  onTimes: () => void;
  disabled?: boolean;
}) {
  const asian =
    catalog.restaurant.slug === "storefront-restaurant-a" ||
    /asian kitchen/i.test(catalog.restaurant.name);
  return (
    <>
      <header className={`shop-hero ${asian ? "asian-hero" : ""}`}>
        {asian && <img className="hero-art" src="/shop-design/reference-b.png" alt="" />}
        <h1 className={asian ? "sr-only" : ""}>{catalog.restaurant.name}</h1>
      </header>
      <div className="shop-service">
        <button disabled={disabled} className="service-state" onClick={onTimes}>
          <span className="service-dot" />
          Bestellzeiten
        </button>
        <button disabled={disabled} onClick={onTimes}>
          <ShopIcon name="clock" />
          <span>Zeit wählen</span>
        </button>
        <label>
          <ShopIcon name="bag" />
          <select
            disabled={disabled}
            aria-label="Bestellart wählen"
            value={fulfillment}
            onChange={(e) => onFulfillment(e.target.value as FulfillmentType)}
          >
            <option value="pickup">Abholung</option>
            <option value="delivery">Lieferung</option>
          </select>
        </label>
      </div>
    </>
  );
}

export function ShopMenu({
  catalog,
  onAdd,
  disabled = false,
}: {
  catalog: PublicCatalog;
  onAdd: (
    menu: Menu,
    item: Item,
    selection: Pick<OrderSelectionLine, "variantId" | "optionIds">,
  ) => void;
  disabled?: boolean;
}) {
  const asian = catalog.restaurant.slug === "storefront-restaurant-a";
  const key = favoritesKey({
    restaurantSlug: catalog.restaurant.slug,
    locationSlug: catalog.location.slug,
  });
  const [favoriteState, setFavorites] = useState<{ key: string | undefined; ids: string[] }>({
    key: undefined,
    ids: [],
  });
  const favorites = favoriteState.key === key ? favoriteState.ids : [];
  const [category, setCategory] = useState("Beliebt");
  const [picked, setPicked] = useState<Entry | null>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let ids: string[] = [];
    try {
      ids = parseFavorites(key ? localStorage.getItem(key) : null);
    } catch {
      /* optional */
    }
    setFavorites({ key, ids });
    setCategory("Beliebt");
    setPicked(null);
  }, [key]);
  useEffect(() => {
    if (picked) modal.current?.showModal();
  }, [picked]);
  const entries: Entry[] = catalog.menus.flatMap((menu) =>
    menu.sections.flatMap((section) =>
      section.items.map((item) => ({ menu, item, category: section.name })),
    ),
  );
  const categories = [
    "Beliebt",
    ...new Set(
      catalog.menus
        .flatMap((menu) => menu.sections.map((section) => section.name))
        .filter((name) => name !== "Beliebt"),
    ),
  ];
  const configuredPopular = entries.filter((e) =>
    /^(beliebt|beliebte gerichte)$/i.test(e.category),
  );
  const popular = configuredPopular.length
    ? configuredPopular
    : asian
      ? entries.filter((e) => asianPopular.includes(e.item.name.replace(/^TEST\s+/i, "")))
      : [];
  const visible = category === "Beliebt" ? popular : entries.filter((e) => e.category === category);
  const saved = entries.filter(
    (e, index) =>
      favorites.includes(e.item.id) &&
      entries.findIndex((other) => other.item.id === e.item.id) === index,
  );
  const money = (entry: Entry) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: entry.menu.currency }).format(
      entry.item.priceAmountMinor / 100,
    );
  function toggle(id: string) {
    const ids = favorites.includes(id)
      ? favorites.filter((value) => value !== id)
      : [...favorites, id].slice(-100);
    setFavorites({ key, ids });
    try {
      if (key) localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      /* remains usable in memory */
    }
  }
  function close() {
    modal.current?.close();
    setPicked(null);
    trigger.current?.focus();
  }
  function add(entry: Entry) {
    if (disabled || entry.item.availability !== "available") return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (entry.item.configuration) setPicked(entry);
    else onAdd(entry.menu, entry.item, {});
  }
  const heart = (entry: Entry) => (
    <button
      type="button"
      className="heart-button"
      aria-label={`${entry.item.name}: ${favorites.includes(entry.item.id) ? "aus Favoriten entfernen" : "als Favorit speichern"}`}
      aria-pressed={favorites.includes(entry.item.id)}
      onClick={() => toggle(entry.item.id)}
    >
      <ShopIcon name="heart" filled={favorites.includes(entry.item.id)} />
    </button>
  );
  const plus = (entry: Entry) => (
    <button
      type="button"
      className="shop-plus"
      disabled={disabled || entry.item.availability !== "available"}
      aria-label={`${entry.item.name} hinzufügen`}
      onClick={() => add(entry)}
    >
      <ShopIcon name="plus" />
    </button>
  );
  return (
    <>
      {saved.length > 0 && (
        <section className="shop-favorites" aria-labelledby="favorites-title">
          <h2 id="favorites-title">Deine Favoriten</h2>
          <ul>
            {saved.map((entry) => (
              <li key={entry.menu.id + entry.item.id}>
                <FoodPhoto name={entry.item.name} small asian={asian} />
                <span className="favorite-name">{entry.item.name}</span>
                <span className="favorite-price">{money(entry)}</span>
                {heart(entry)}
                {plus(entry)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <nav className="shop-categories" aria-label="Speisekategorien">
        {categories.map((name) => (
          <button
            type="button"
            key={name}
            aria-pressed={category === name}
            onClick={() => setCategory(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      <section className="shop-menu" aria-label={category}>
        {visible.length === 0 && (
          <div className="shop-empty">
            <h2>
              {category === "Beliebt"
                ? "Hier findest du bald die beliebtesten Gerichte"
                : "Noch keine Gerichte"}
            </h2>
            <p>Entdecke die Speisekarte über die Kategorien.</p>
            {categories[1] && (
              <button onClick={() => setCategory(categories[1]!)}>Speisekarte entdecken</button>
            )}
          </div>
        )}
        <ul>
          {visible.map((entry) => (
            <li className="shop-dish" key={entry.menu.id + entry.item.id}>
              <button
                className="dish-photo-button"
                type="button"
                aria-label={`Details zu ${entry.item.name}`}
                onClick={() => {
                  trigger.current = document.activeElement as HTMLElement;
                  setPicked(entry);
                }}
              >
                <FoodPhoto name={entry.item.name} asian={asian} />
              </button>
              <div className="dish-copy">
                <h2>
                  <button
                    type="button"
                    onClick={() => {
                      trigger.current = document.activeElement as HTMLElement;
                      setPicked(entry);
                    }}
                  >
                    {entry.item.name}
                  </button>
                </h2>
                <p>{entry.item.description}</p>
                <div className="dish-bottom">
                  <span className="dish-price">{money(entry)}</span>
                  {heart(entry)}
                  {plus(entry)}
                </div>
                {entry.item.availability !== "available" && (
                  <span className="stock-state">
                    {entry.item.availability === "sold_out" ? "Ausverkauft" : "Nicht verfügbar"}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      {picked && (
        <dialog
          ref={modal}
          className="shop-dialog"
          aria-labelledby="dish-dialog-title"
          onCancel={() => {
            setPicked(null);
            trigger.current?.focus();
          }}
        >
          <button type="button" className="dialog-close" aria-label="Schließen" onClick={close}>
            <ShopIcon name="close" />
          </button>
          <h2 id="dish-dialog-title">{picked.item.name}</h2>
          <p>{picked.item.description}</p>
          <ItemPicker
            key={picked.menu.versionId + picked.item.id}
            item={picked.item}
            currency={picked.menu.currency}
            onAdd={(selection) => {
              if (!disabled) {
                onAdd(picked.menu, picked.item, selection);
                close();
              }
            }}
          />
        </dialog>
      )}
    </>
  );
}

export function ShopNavigation({
  tab,
  onTab,
  quantity,
  total,
  hasOrder,
}: {
  tab: ShopTab;
  onTab: (tab: ShopTab) => void;
  quantity: number;
  total: string;
  hasOrder: boolean;
}) {
  return (
    <div className="shop-dock">
      <div className="basket-wrap">
        <button className="basket-button" onClick={() => onTab("cart")}>
          <ShopIcon name="cart" />
          <span>
            Warenkorb · {quantity} Artikel · {total}
          </span>
          <ShopIcon name="arrow" />
        </button>
      </div>
      <nav className="shop-bottom-nav" aria-label="Shopnavigation">
        <button aria-current={tab === "menu" ? "page" : undefined} onClick={() => onTab("menu")}>
          <ShopIcon name="menu" />
          Speisekarte
        </button>
        <button
          aria-current={tab === "orders" ? "page" : undefined}
          onClick={() => onTab("orders")}
        >
          <span className="orders-icon">
            <ShopIcon name="orders" />
            {hasOrder && <i />}
          </span>
          Meine Bestellungen
        </button>
      </nav>
    </div>
  );
}
