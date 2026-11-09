"use client";
import { useEffect, useRef, useState } from "react";
import type { PublicCatalog, OrderSelectionLine, FulfillmentType } from "@provide/contracts";
import { favoritesKey, parseFavorites } from "./favorites";
import type { CartLine } from "./cart";
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
function fallbackPhoto(name: string) {
  if (/chicken teriyaki/i.test(name)) return "chicken";
  if (/veggie bowl/i.test(name)) return "veggie";
  if (/salmon bowl/i.test(name)) return "salmon";
}

function asianPhoto(name: string, asian: boolean) {
  return asian ? asianPhotos[name.replace(/^TEST\s+/i, "")] : undefined;
}

export function FoodPhoto({
  name,
  small = false,
  asian = false,
}: {
  name: string;
  small?: boolean;
  asian?: boolean;
}) {
  const photo = asianPhoto(name, asian);
  if (photo)
    return (
      <span className={`food-photo ${small ? "food-small" : ""}`} aria-hidden="true">
        <img className="catalog-photo" src={`/shop-design/${photo}.webp`} alt="" loading="lazy" />
      </span>
    );
  const match = fallbackPhoto(name);
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
  pickupOnly = false,
  timeLabel,
  disabled = false,
}: {
  catalog: PublicCatalog;
  fulfillment: FulfillmentType;
  onFulfillment: (type: FulfillmentType) => void;
  onTimes: () => void;
  pickupOnly?: boolean;
  timeLabel?: string;
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
      <div className={pickupOnly ? "shop-service shop-service--pickup" : "shop-service"}>
        {pickupOnly ? (
          <span className="shop-pickup-mode">
            <ShopIcon name="bag" />
            Abholung
          </span>
        ) : (
          <button disabled={disabled} className="service-state" onClick={onTimes}>
            <span className="service-dot" />
            Bestellzeiten
          </button>
        )}
        <button disabled={disabled} onClick={onTimes}>
          <ShopIcon name="clock" />
          <span>{timeLabel || "Zeit wählen"}</span>
        </button>
        {!pickupOnly && (
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
        )}
      </div>
    </>
  );
}

export function ShopMenu({
  catalog,
  onAdd,
  cart,
  shortPickupLabel = false,
  disabled = false,
}: {
  catalog: PublicCatalog;
  onAdd: (
    menu: Menu,
    item: Item,
    selection: Pick<OrderSelectionLine, "variantId" | "optionIds">,
  ) => void;
  cart: readonly CartLine[];
  shortPickupLabel?: boolean;
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
  const [selectedCategory, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const categoryKey = key ? key + ":category" : undefined;
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
    try {
      setCategory(categoryKey ? (sessionStorage.getItem(categoryKey) ?? "") : "");
    } catch {
      setCategory("");
    }
    setSearch("");
    setPicked(null);
  }, [key, categoryKey]);
  useEffect(() => {
    if (picked) modal.current?.showModal();
  }, [picked]);
  const entries: Entry[] = catalog.menus.flatMap((menu) =>
    menu.sections.flatMap((section) =>
      section.items.map((item) => ({ menu, item, category: section.name })),
    ),
  );
  const isPopular = (name: string) => /^(beliebt|beliebte gerichte)$/i.test(name);
  const configuredPopular = entries.filter((entry) => isPopular(entry.category));
  const popular = configuredPopular.length
    ? configuredPopular
    : asian
      ? entries.filter((entry) => asianPopular.includes(entry.item.name.replace(/^TEST\s+/i, "")))
      : [];
  const categories = [
    ...(popular.length ? ["Beliebt"] : []),
    ...new Set(entries.map((entry) => entry.category).filter((name) => !isPopular(name))),
  ];
  const category = categories.includes(selectedCategory) ? selectedCategory : categories[0];
  const searchText = search.trim().toLocaleLowerCase("de-DE");
  const showSearch = entries.length >= 12;
  const searching = showSearch && !!searchText;
  const visible = searching
    ? entries.filter((entry) => entry.item.name.toLocaleLowerCase("de-DE").includes(searchText))
    : category === "Beliebt"
      ? popular
      : entries.filter((entry) => entry.category === category);

  function selectCategory(name: string) {
    setCategory(name);
    setSearch("");
    try {
      if (categoryKey) sessionStorage.setItem(categoryKey, name);
    } catch {
      /* the current view retains the selection */
    }
  }
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
  function plus(entry: Entry) {
    const quantity = cart.reduce(
      (count, line) =>
        count +
        (line.menuId === entry.menu.id && line.menuItemId === entry.item.id ? line.quantity : 0),
      0,
    );
    return (
      <button
        type="button"
        className="shop-plus"
        disabled={disabled || entry.item.availability !== "available"}
        aria-label={`${entry.item.name} hinzufügen`}
        aria-description={quantity > 0 ? `${quantity} im Warenkorb` : undefined}
        onClick={() => add(entry)}
      >
        <ShopIcon name="plus" />
        {quantity > 0 && (
          <span className="shop-plus-count" aria-hidden="true">
            {quantity}
          </span>
        )}
      </button>
    );
  }
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
      {showSearch && (
        <label className="shop-search">
          <span className="sr-only">Gericht suchen</span>
          <input
            type="search"
            placeholder="Gericht suchen"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      )}
      {categories.length > 0 && (
        <nav className="shop-categories" aria-label="Speisekategorien">
          {categories.map((name) => (
            <button
              type="button"
              key={name}
              aria-pressed={!searching && category === name}
              onClick={() => selectCategory(name)}
            >
              {shortPickupLabel && /^TEST Abholkarte\b/i.test(name) ? "Abholkarte" : name}
            </button>
          ))}
        </nav>
      )}
      <section
        className="shop-menu"
        aria-label={searching ? "Suchergebnisse" : (category ?? "Speisekarte")}
      >
        {visible.length === 0 && (
          <div className="shop-empty">
            <h2>{searching ? "Kein Gericht gefunden" : "Noch keine Gerichte"}</h2>
            {searching && (
              <button type="button" onClick={() => setSearch("")}>
                Suche zurücksetzen
              </button>
            )}
          </div>
        )}
        <ul>
          {visible.map((entry) => {
            const hasPhoto = !!(
              asianPhoto(entry.item.name, asian) || fallbackPhoto(entry.item.name)
            );
            return (
              <li
                className={hasPhoto ? "shop-dish" : "shop-dish shop-dish--compact"}
                key={entry.menu.id + entry.item.id}
              >
                {hasPhoto && (
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
                )}
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
            );
          })}
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
  onPickupTime,
}: {
  tab: ShopTab;
  onTab: (tab: ShopTab) => void;
  quantity: number;
  total: string;
  hasOrder: boolean;
  onPickupTime?: () => void;
}) {
  return (
    <div className="shop-dock">
      {(tab !== "cart" || onPickupTime) && (
        <div className="basket-wrap">
          <button
            className="basket-button"
            onClick={tab === "cart" ? onPickupTime : () => onTab("cart")}
          >
            <ShopIcon name={tab === "cart" ? "clock" : "cart"} />
            <span>
              {tab === "cart"
                ? "Weiter zur Abholzeit"
                : `Warenkorb · ${quantity} Artikel · ${total}`}
            </span>
            <ShopIcon name="arrow" />
          </button>
        </div>
      )}
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
