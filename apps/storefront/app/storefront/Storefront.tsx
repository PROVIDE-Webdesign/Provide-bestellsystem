"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isStorefrontScope,
  parseDeliveryQuote,
  parseGuestDeliveryOrderConfirmation,
  type DeliveryQuote,
  type GuestDeliveryOrderConfirmation,
  parseGuestPickupOrderConfirmation,
  parsePublicAvailability,
  parsePublicCatalog,
  parsePublicOrderStatus,
  type FulfillmentType,
  type GuestPickupOrderConfirmation,
  type PublicCatalog,
  type PublicOrderStatus,
  type StorefrontScope,
} from "@provide/contracts";
import {
  addCartItem,
  cartItemCount,
  cartTotalAmountMinor,
  setCartItemQuantity,
  type CartLine,
} from "./cart";
import { locationTimeToInstant } from "./time";
import {
  orderStatusStorageKey,
  parseStoredOrderStatusAccess,
  type StoredOrderStatusAccess,
} from "./status-storage";

interface StorefrontProps extends StorefrontScope {
  readonly privacyNoticeVersion: string;
}

const terminalStatuses: readonly PublicOrderStatus["status"][] = [
  "completed",
  "rejected",
  "cancelled",
];
const statusLabels: Record<PublicOrderStatus["status"], string> = {
  submitted: "Bestellung eingegangen",
  accepted: "Bestellung angenommen",
  preparing: "Wird zubereitet",
  ready: "Abholbereit",
  completed: "Bestellung abgeschlossen",
  rejected: "Bestellung abgelehnt",
  cancelled: "Bestellung storniert",
};

export default function Storefront(scope: StorefrontProps) {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [refresh, setRefresh] = useState(0);
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("pickup");
  const [localTime, setLocalTime] = useState("");
  const [itemCount, setItemCount] = useState("1");
  const [answer, setAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [cart, setCart] = useState<readonly CartLine[]>([]);
  const [cartMessage, setCartMessage] = useState("");
  const [contactName, setContactName] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [email, setEmail] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [checkoutState, setCheckoutState] = useState<"idle" | "submitting" | "error">("idle");
  const [confirmation, setConfirmation] = useState<
    GuestPickupOrderConfirmation | GuestDeliveryOrderConfirmation | null
  >(null);
  const [postalCode, setPostalCode] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [quoteAccepted, setQuoteAccepted] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const quoteRequest = useRef<AbortController | null>(null);
  const [orderStatus, setOrderStatus] = useState<PublicOrderStatus | null>(null);
  const [statusAccess, setStatusAccess] = useState<StoredOrderStatusAccess | null>(null);
  const [statusState, setStatusState] = useState<"idle" | "loading" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const submissionKey = useRef<string | null>(null);
  const availabilityRequest = useRef<AbortController | null>(null);
  const checkoutRequest = useRef<AbortController | null>(null);
  const statusRequest = useRef<AbortController | null>(null);
  const base = `/api/storefront/${encodeURIComponent(scope.restaurantSlug)}/${encodeURIComponent(scope.locationSlug)}`;
  const validScope = isStorefrontScope(scope);
  const totalQuantity = cartItemCount(cart);
  const displayTotal = cartTotalAmountMinor(cart);
  const currency = cart[0]?.currency ?? catalog?.menus[0]?.currency ?? "EUR";

  const money = (amountMinor: number, currencyCode = currency) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: currencyCode }).format(
      amountMinor / 100,
    );

  function invalidateSubmission(invalidateQuote = true) {
    if (invalidateQuote) {
      quoteRequest.current?.abort();
      quoteRequest.current = null;
      setQuoting(false);
      setDeliveryQuote(null);
      setQuoteAccepted(false);
    }
    submissionKey.current = null;
    setCheckoutState("idle");
    setConfirmation(null);
  }

  function clearAnswer() {
    availabilityRequest.current?.abort();
    availabilityRequest.current = null;
    setAnswer("");
    setChecking(false);
  }

  const clearStoredStatus = useCallback(() => {
    const key = orderStatusStorageKey(scope);
    if (key)
      try {
        sessionStorage.removeItem(key);
      } catch {
        // Storage is optional; the in-memory capability remains the primary source.
      }
  }, [scope.locationSlug, scope.restaurantSlug]);

  const refreshOrderStatus = useCallback(
    async (access: StoredOrderStatusAccess) => {
      const controller = new AbortController();
      statusRequest.current?.abort();
      statusRequest.current = controller;
      setStatusState("loading");
      setStatusMessage("");
      try {
        const response = await fetch(`${base}/order-status`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orderId: access.orderId,
            statusAccessToken: access.statusAccessToken,
          }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          clearStoredStatus();
          setStatusAccess(null);
          setOrderStatus(null);
          setConfirmation(null);
          setStatusMessage("Dieser Bestellstatus ist nicht mehr verfügbar.");
          setStatusState("idle");
          return;
        }
        if (!response.ok) throw new Error("Status read failed");
        const body = (await response.json()) as { data?: unknown };
        const result = parsePublicOrderStatus(body.data);
        if (!result || result.orderId !== access.orderId) throw new Error("Invalid status");
        setOrderStatus(result);
        setStatusState("idle");
      } catch {
        if (!controller.signal.aborted) {
          setStatusState("error");
          setStatusMessage("Der Bestellstatus konnte gerade nicht aktualisiert werden.");
        }
      } finally {
        if (statusRequest.current === controller) statusRequest.current = null;
      }
    },
    [base, clearStoredStatus],
  );

  useEffect(() => {
    const key = orderStatusStorageKey(scope);
    if (!key) return;
    statusRequest.current?.abort();
    setStatusAccess(null);
    setOrderStatus(null);
    setConfirmation(null);
    setStatusMessage("");
    try {
      const stored = parseStoredOrderStatusAccess(sessionStorage.getItem(key));
      if (stored) setStatusAccess(stored);
      else sessionStorage.removeItem(key);
    } catch {
      // Status remains available in memory when browser storage is unavailable.
    }
  }, [scope.locationSlug, scope.restaurantSlug]);

  useEffect(() => {
    if (!statusAccess) return;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refreshOrderStatus(statusAccess);
    };
    refreshVisible();
    if (orderStatus && terminalStatuses.includes(orderStatus.status)) return;
    const interval = window.setInterval(refreshVisible, 20_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisible);
      statusRequest.current?.abort();
    };
  }, [orderStatus?.status, refreshOrderStatus, statusAccess]);

  useEffect(() => {
    const controller = new AbortController();
    availabilityRequest.current?.abort();
    checkoutRequest.current?.abort();
    availabilityRequest.current = null;
    checkoutRequest.current = null;
    quoteRequest.current?.abort();
    setDeliveryQuote(null);
    setQuoteAccepted(false);
    setCatalog(null);
    setCart([]);
    setAnswer("");
    setChecking(false);
    setLoadState("loading");
    submissionKey.current = null;
    if (!validScope) {
      setLoadState("missing");
      return;
    }
    void (async () => {
      try {
        const response = await fetch(`${base}/catalog`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          setLoadState("missing");
          return;
        }
        if (!response.ok) throw new Error("Read failed");
        const body = (await response.json()) as { data?: unknown };
        const data = parsePublicCatalog(body.data);
        if (!controller.signal.aborted) {
          setCatalog(data);
          setLoadState("ready");
        }
      } catch {
        if (!controller.signal.aborted) setLoadState("error");
      }
    })();
    return () => {
      controller.abort();
      quoteRequest.current?.abort();
      availabilityRequest.current?.abort();
      checkoutRequest.current?.abort();
      statusRequest.current?.abort();
    };
  }, [base, refresh, validScope]);

  async function checkAvailability() {
    clearAnswer();
    if (!catalog) return;
    const requestedFor = locationTimeToInstant(localTime, catalog.location.timezone);
    if (!requestedFor) {
      setAnswer(
        "Bitte wähle einen eindeutigen, gültigen Zeitpunkt. Bei einer Zeitumstellung kann diese Uhrzeit fehlen oder doppelt vorkommen.",
      );
      return;
    }
    const count = totalQuantity > 0 ? totalQuantity : Number(itemCount);
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      setAnswer("Bitte gib eine Anzahl zwischen 1 und 1000 ein.");
      return;
    }
    const controller = new AbortController();
    availabilityRequest.current = controller;
    setChecking(true);
    try {
      const query = new URLSearchParams({
        fulfillmentType,
        requestedFor,
        itemCount: String(count),
      });
      const response = await fetch(`${base}/availability?${query}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 404) {
        setCatalog(null);
        setLoadState("missing");
        return;
      }
      if (!response.ok) throw new Error("Read failed");
      const body = (await response.json()) as { data?: unknown };
      const result = parsePublicAvailability(body.data);
      setAnswer(
        result.status === "available"
          ? "Für deine Auswahl ist derzeit Kapazität verfügbar. Die endgültige Prüfung erfolgt beim Absenden."
          : "Für deine Auswahl ist aktuell keine Bestellung möglich. Bitte versuche einen anderen Zeitpunkt oder eine andere Bestellart.",
      );
    } catch {
      if (!controller.signal.aborted)
        setAnswer("Die Verfügbarkeit konnte nicht geprüft werden. Bitte versuche es erneut.");
    } finally {
      if (availabilityRequest.current === controller) {
        setChecking(false);
        availabilityRequest.current = null;
      }
    }
  }

  async function requestDeliveryQuote() {
    if (!catalog || !cart.length || !/^[0-9]{5}$/.test(postalCode)) {
      setCartMessage("Bitte wähle Gerichte und gib eine fünfstellige deutsche Postleitzahl ein.");
      return;
    }
    const requestedFor = locationTimeToInstant(localTime, catalog.location.timezone);
    if (!requestedFor) {
      setCartMessage("Bitte wähle einen gültigen Lieferzeitpunkt.");
      return;
    }
    const controller = new AbortController();
    quoteRequest.current?.abort();
    quoteRequest.current = controller;
    setQuoting(true);
    setDeliveryQuote(null);
    setQuoteAccepted(false);
    setCartMessage("");
    try {
      const response = await fetch(`${base}/delivery-quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          menuId: cart[0]!.menuId,
          menuVersionId: cart[0]!.menuVersionId,
          requestedFor,
          lines: cart.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
          postalCode,
        }),
      });
      if (!response.ok) throw new Error("Delivery unavailable");
      const body = (await response.json()) as { data?: unknown };
      const quote = parseDeliveryQuote(body.data);
      if (!quote) throw new Error("Invalid quote");
      if (!controller.signal.aborted) {
        setDeliveryQuote(quote);
        submissionKey.current = null;
      }
    } catch {
      if (!controller.signal.aborted)
        setCartMessage(
          "Lieferung aktuell nicht möglich. Bitte prüfe PLZ, Mindestbestellwert und Lieferzeit oder wähle Abholung.",
        );
    } finally {
      if (quoteRequest.current === controller) {
        setQuoting(false);
        quoteRequest.current = null;
      }
    }
  }

  async function submitCheckout() {
    if (!catalog || cart.length === 0 || checkoutState === "submitting") return;
    setConfirmation(null);
    const requestedFor = locationTimeToInstant(localTime, catalog.location.timezone);
    if (!requestedFor) {
      setCartMessage("Bitte wähle zuerst einen eindeutigen, gültigen Bestellzeitpunkt.");
      return;
    }
    if (fulfillmentType === "delivery" && (!deliveryQuote || !quoteAccepted)) {
      setCartMessage("Bitte prüfe und bestätige zuerst die Lieferkosten.");
      return;
    }
    if (!contactName.trim() || !/^\+[1-9][0-9]{7,14}$/.test(phoneE164.trim())) {
      setCartMessage("Bitte gib einen Namen und eine Telefonnummer im internationalen Format an.");
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setCartMessage("Bitte prüfe die optionale E-Mail-Adresse.");
      return;
    }
    if (!privacyAccepted) {
      setCartMessage("Bitte bestätige, dass du den Datenschutzhinweis gesehen hast.");
      return;
    }
    const key = submissionKey.current ?? crypto.randomUUID();
    submissionKey.current = key;
    const controller = new AbortController();
    checkoutRequest.current?.abort();
    checkoutRequest.current = controller;
    setCheckoutState("submitting");
    setCartMessage("");
    try {
      const response = await fetch(
        `${base}/${fulfillmentType === "delivery" ? "delivery-orders" : "orders"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            menuId: cart[0]!.menuId,
            menuVersionId: cart[0]!.menuVersionId,
            requestedFor,
            lines: cart.map((line) => ({
              menuItemId: line.menuItemId,
              quantity: line.quantity,
            })),
            submissionKey: key,
            customer: {
              contactName: contactName.trim(),
              phoneE164: phoneE164.trim(),
              email: email.trim() ? email.trim().toLowerCase() : null,
            },
            privacyNoticeVersion: scope.privacyNoticeVersion,
            ...(fulfillmentType === "delivery"
              ? {
                  delivery: {
                    addressLine1,
                    addressLine2: null,
                    postalCode,
                    city,
                    countryCode: "DE",
                  },
                  expectedQuote: deliveryQuote,
                }
              : {}),
          }),
        },
      );
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setCheckoutState("error");
        if (response.status === 409 && fulfillmentType === "delivery") {
          setDeliveryQuote(null);
          setQuoteAccepted(false);
        }
        setCartMessage(
          response.status === 409
            ? "Die Bestellung konnte nicht angenommen werden. Bitte prüfe Speisekarte, Bestellzeit und gegebenenfalls die Lieferkosten erneut."
            : "Der Checkout ist derzeit nicht verfügbar. Es wurde keine bestätigte Bestellung angezeigt.",
        );
        return;
      }
      const payload = (await response.json()) as { data?: unknown };
      const result =
        fulfillmentType === "delivery"
          ? parseGuestDeliveryOrderConfirmation(payload.data)
          : parseGuestPickupOrderConfirmation(payload.data);
      if (!result) throw new Error("Invalid confirmation");
      setConfirmation(result);
      setOrderStatus(null);
      setStatusMessage("");
      const access = {
        orderId: result.orderId,
        statusAccessToken: result.statusAccessToken,
        statusAvailableUntil: result.statusAvailableUntil,
      };
      setStatusAccess(access);
      const storageKey = orderStatusStorageKey(scope);
      if (storageKey)
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(access));
        } catch {
          // A blocked session store must not invalidate an otherwise confirmed order.
        }
      setCheckoutState("idle");
      setCart([]);
      setContactName("");
      setPhoneE164("");
      setEmail("");
      setAddressLine1("");
      setPostalCode("");
      setCity("");
      setDeliveryQuote(null);
      setQuoteAccepted(false);
      setPrivacyAccepted(false);
      submissionKey.current = null;
    } catch {
      if (!controller.signal.aborted) {
        setCheckoutState("error");
        setCartMessage(
          "Die Verbindung ist fehlgeschlagen. Du kannst dieselbe Bestellung erneut senden.",
        );
      }
    } finally {
      if (checkoutRequest.current === controller) checkoutRequest.current = null;
    }
  }

  return (
    <main className="storefront">
      <a className="skip-link" href="#menu">
        Zur Speisekarte
      </a>
      <header className="brand">
        <a href="/">
          PROVIDE<span> BESTELLEN</span>
        </a>
        <span className="preview-label">Testansicht · Checkout standardmäßig gesperrt</span>
      </header>
      {(confirmation || orderStatus || statusMessage) && (
        <section className="order-status" aria-labelledby="order-status-title" aria-live="polite">
          <p className="eyebrow">DEINE BESTELLUNG</p>
          <h2 id="order-status-title">
            {orderStatus
              ? orderStatus.fulfillmentType === "delivery" && orderStatus.status === "ready"
                ? "Bereit zur Auslieferung"
                : orderStatus.fulfillmentType === "delivery" && orderStatus.status === "completed"
                  ? "Zugestellt"
                  : statusLabels[orderStatus.status]
              : confirmation
                ? statusLabels[confirmation.status]
                : "Bestellstatus"}
          </h2>
          {(orderStatus || confirmation) && (
            <p>
              {(orderStatus ?? confirmation)!.itemCount} Gerichte ·{" "}
              {money(
                (orderStatus ?? confirmation)!.totalAmountMinor,
                (orderStatus ?? confirmation)!.currency,
              )}{" "}
              · Zahlung bei{" "}
              {(orderStatus ?? confirmation)?.fulfillmentType === "delivery"
                ? "Lieferung"
                : "Abholung"}
            </p>
          )}
          {confirmation && !orderStatus && (
            <p>Das Restaurant muss die Bestellung im nächsten Prozessschritt noch annehmen.</p>
          )}
          {statusMessage && (
            <p role="alert" className="status-message">
              {statusMessage}
            </p>
          )}
          {statusAccess && (
            <button
              type="button"
              className="secondary"
              disabled={statusState === "loading"}
              onClick={() => void refreshOrderStatus(statusAccess)}
            >
              {statusState === "loading" ? "Status wird aktualisiert …" : "Status aktualisieren"}
            </button>
          )}
          {orderStatus && (
            <p className="status-updated">
              Zuletzt aktualisiert: {new Date(orderStatus.updatedAt).toLocaleString("de-DE")}
            </p>
          )}
        </section>
      )}
      {loadState === "loading" && (
        <section aria-live="polite">
          <h1>Speisekarte wird geladen …</h1>
        </section>
      )}
      {loadState === "missing" && (
        <section>
          <h1>Speisekarte derzeit nicht verfügbar</h1>
          <p>Für diesen Standort ist aktuell keine öffentliche Speisekarte verfügbar.</p>
          <button onClick={() => setRefresh((value) => value + 1)}>Erneut prüfen</button>
        </section>
      )}
      {loadState === "error" && (
        <section role="alert">
          <h1>Verbindung gerade nicht möglich</h1>
          <p>Bitte lade die Speisekarte erneut.</p>
          <button onClick={() => setRefresh((value) => value + 1)}>Erneut laden</button>
        </section>
      )}
      {catalog && (
        <>
          <section className="restaurant-heading">
            <p className="eyebrow">GUT ESSEN. EINFACH AUSWÄHLEN.</p>
            <h1>{catalog.restaurant.name}</h1>
            <p className="location-name">{catalog.location.name}</p>
            <address>
              {catalog.location.address.line1}
              {catalog.location.address.line2 && <>, {catalog.location.address.line2}</>}
              <br />
              {catalog.location.address.postalCode} {catalog.location.address.city} ·{" "}
              {catalog.location.address.countryCode}
            </address>
          </section>
          <fieldset
            disabled={checkoutState === "submitting"}
            style={{ border: 0, padding: 0, minWidth: 0 }}
          >
            <div className="storefront-grid">
              <div id="menu" tabIndex={-1}>
                {catalog.menus.length === 0 && (
                  <p>Hier sind derzeit keine Gerichte veröffentlicht.</p>
                )}
                {catalog.menus.map((menu) => (
                  <section className="menu" key={menu.id} aria-label={menu.name}>
                    <h2>{menu.name}</h2>
                    {menu.sections.map((section) => (
                      <div className="menu-section" key={section.key}>
                        <h3>{section.name}</h3>
                        <ul className="dishes">
                          {section.items.map((item) => (
                            <li key={item.id} className="dish">
                              <div>
                                <h4>{item.name}</h4>
                                {item.description && <p>{item.description}</p>}
                                {item.availability !== "available" && (
                                  <span className="availability-badge">
                                    {item.availability === "sold_out"
                                      ? "Ausverkauft"
                                      : "Nicht verfügbar"}
                                  </span>
                                )}
                              </div>
                              <div className="dish-action">
                                <span className="price">
                                  {new Intl.NumberFormat("de-DE", {
                                    style: "currency",
                                    currency: menu.currency,
                                  }).format(item.priceAmountMinor / 100)}
                                </span>
                                <button
                                  type="button"
                                  className="add-button"
                                  disabled={item.availability !== "available"}
                                  onClick={() => {
                                    const next = addCartItem(cart, menu, item);
                                    if (next === cart)
                                      setCartMessage(
                                        "Gerichte aus verschiedenen Speisekarten können noch nicht gemeinsam bestellt werden.",
                                      );
                                    else {
                                      setCart(next);
                                      setCartMessage("");
                                      invalidateSubmission();
                                    }
                                  }}
                                >
                                  Hinzufügen
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
              <div className="side-column">
                <aside className="availability-panel" aria-labelledby="availability-title">
                  <p className="eyebrow">DEIN WUNSCHTERMIN</p>
                  <h2 id="availability-title">Wann passt es dir?</h2>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void checkAvailability();
                    }}
                  >
                    <fieldset>
                      <legend>Bestellart</legend>
                      <div className="fulfillment-options">
                        {(["pickup", "delivery"] as const).map((type) => (
                          <label key={type}>
                            <input
                              type="radio"
                              name="fulfillment"
                              value={type}
                              checked={fulfillmentType === type}
                              onChange={() => {
                                clearAnswer();
                                invalidateSubmission();
                                setFulfillmentType(type);
                              }}
                            />
                            {type === "pickup" ? "Abholung" : "Lieferung"}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <label htmlFor="requested-time">Datum und Uhrzeit</label>
                    <input
                      id="requested-time"
                      type="datetime-local"
                      required
                      value={localTime}
                      onChange={(event) => {
                        clearAnswer();
                        invalidateSubmission();
                        setLocalTime(event.target.value);
                      }}
                      aria-describedby="timezone-note"
                    />
                    <p id="timezone-note" className="field-hint">
                      Ortszeit des Restaurants: {catalog.location.timezone}
                    </p>
                    {totalQuantity === 0 ? (
                      <>
                        <label htmlFor="item-count">Anzahl der Gerichte</label>
                        <input
                          id="item-count"
                          type="number"
                          min="1"
                          max="1000"
                          step="1"
                          required
                          value={itemCount}
                          onChange={(event) => {
                            clearAnswer();
                            setItemCount(event.target.value);
                          }}
                        />
                      </>
                    ) : (
                      <p>Geprüfte Warenkorbmenge: {totalQuantity}</p>
                    )}
                    <button type="submit" disabled={checking}>
                      {checking ? "Wird geprüft …" : "Verfügbarkeit prüfen"}
                    </button>
                    <p className="answer" role="status" aria-live="polite">
                      {answer}
                    </p>
                  </form>
                </aside>

                <aside className="cart-panel" aria-labelledby="cart-title">
                  <p className="eyebrow">DEIN WARENKORB</p>
                  <h2 id="cart-title">{totalQuantity} Gerichte</h2>
                  {cart.length === 0 ? (
                    <p>Wähle verfügbare Gerichte aus der Speisekarte.</p>
                  ) : (
                    <>
                      <ul className="cart-lines">
                        {cart.map((line) => (
                          <li key={line.menuItemId}>
                            <div>
                              <strong>{line.name}</strong>
                              <span>{money(line.unitPriceAmountMinor * line.quantity)}</span>
                            </div>
                            <div className="quantity-controls">
                              <button
                                type="button"
                                className="secondary compact"
                                aria-label={`${line.name} einmal weniger`}
                                onClick={() => {
                                  setCart(
                                    setCartItemQuantity(cart, line.menuItemId, line.quantity - 1),
                                  );
                                  invalidateSubmission();
                                }}
                              >
                                −
                              </button>
                              <span aria-label={`${line.quantity} Stück`}>{line.quantity}</span>
                              <button
                                type="button"
                                className="secondary compact"
                                aria-label={`${line.name} einmal mehr`}
                                onClick={() => {
                                  setCart(
                                    setCartItemQuantity(cart, line.menuItemId, line.quantity + 1),
                                  );
                                  invalidateSubmission();
                                }}
                              >
                                +
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <p className="cart-total">
                        <span>Zwischensumme</span>
                        <strong>{money(displayTotal)}</strong>
                      </p>
                      <p className="fine-print">
                        Verbindliche Preise und Verfügbarkeit werden beim Absenden erneut geprüft.
                      </p>
                    </>
                  )}

                  {fulfillmentType === "delivery" && (
                    <section aria-label="Liefergebiet und Lieferkosten">
                      <label htmlFor="delivery-postal">Postleitzahl (Deutschland)</label>
                      <input
                        id="delivery-postal"
                        inputMode="numeric"
                        autoComplete="postal-code"
                        maxLength={5}
                        value={postalCode}
                        onChange={(e) => {
                          invalidateSubmission();
                          setPostalCode(e.target.value);
                        }}
                      />
                      <p>
                        Wir prüfen vollständige Postleitzahlgebiete. Bitte kontrolliere Straße und
                        Hausnummer selbst.
                      </p>
                      <button
                        type="button"
                        disabled={quoting || !cart.length}
                        onClick={() => void requestDeliveryQuote()}
                      >
                        {quoting ? "Wird geprüft …" : "Liefergebiet und Kosten prüfen"}
                      </button>
                      {deliveryQuote && (
                        <div aria-live="polite">
                          <p>Mindestbestellwert: {money(deliveryQuote.minimumAmountMinor)}</p>
                          <p>Artikel: {money(deliveryQuote.subtotalAmountMinor)}</p>
                          <p>Liefergebühr: {money(deliveryQuote.deliveryFeeAmountMinor)}</p>
                          <p>
                            <strong>Gesamt: {money(deliveryQuote.totalAmountMinor)}</strong> ·
                            Zahlung bei Lieferung
                          </p>
                          <label>
                            <input
                              type="checkbox"
                              checked={quoteAccepted}
                              onChange={(e) => setQuoteAccepted(e.target.checked)}
                            />
                            Ich bestätige diese Preisübersicht.
                          </label>
                        </div>
                      )}
                    </section>
                  )}
                  <form
                    className="checkout-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitCheckout();
                    }}
                  >
                    {fulfillmentType === "delivery" && (
                      <>
                        <label htmlFor="delivery-address">Straße und Hausnummer</label>
                        <input
                          id="delivery-address"
                          autoComplete="address-line1"
                          maxLength={200}
                          required
                          value={addressLine1}
                          onChange={(e) => {
                            invalidateSubmission(false);
                            setAddressLine1(e.target.value);
                          }}
                        />
                        <label htmlFor="delivery-city">Ort</label>
                        <input
                          id="delivery-city"
                          autoComplete="address-level2"
                          maxLength={120}
                          required
                          value={city}
                          onChange={(e) => {
                            invalidateSubmission(false);
                            setCity(e.target.value);
                          }}
                        />
                      </>
                    )}
                    <label htmlFor="contact-name">Name</label>
                    <input
                      id="contact-name"
                      autoComplete="name"
                      maxLength={120}
                      required
                      value={contactName}
                      onChange={(event) => {
                        invalidateSubmission(false);
                        setContactName(event.target.value);
                      }}
                    />
                    <label htmlFor="contact-phone">Telefonnummer</label>
                    <input
                      id="contact-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+491701234567"
                      required
                      value={phoneE164}
                      onChange={(event) => {
                        invalidateSubmission(false);
                        setPhoneE164(event.target.value);
                      }}
                    />
                    <label htmlFor="contact-email">E-Mail-Adresse (optional)</label>
                    <input
                      id="contact-email"
                      type="email"
                      autoComplete="email"
                      maxLength={254}
                      value={email}
                      onChange={(event) => {
                        invalidateSubmission(false);
                        setEmail(event.target.value);
                      }}
                    />
                    <label className="privacy-confirmation">
                      <input
                        type="checkbox"
                        checked={privacyAccepted}
                        onChange={(event) => {
                          invalidateSubmission(false);
                          setPrivacyAccepted(event.target.checked);
                        }}
                      />
                      Ich habe den Datenschutzhinweis für den Test-Checkout gesehen.
                    </label>
                    <button
                      type="submit"
                      disabled={
                        cart.length === 0 ||
                        (fulfillmentType === "delivery" && (!deliveryQuote || !quoteAccepted)) ||
                        checkoutState === "submitting"
                      }
                    >
                      {checkoutState === "submitting"
                        ? "Wird übermittelt …"
                        : fulfillmentType === "delivery"
                          ? "Lieferbestellung absenden"
                          : "Abholbestellung absenden"}
                    </button>
                    <p className="answer" role="status" aria-live="polite">
                      {cartMessage}
                    </p>
                  </form>
                </aside>
              </div>
            </div>
          </fieldset>
          <footer>
            <span>Testsystem · keine Livezahlung und kein produktiver Bestellbetrieb.</span>
            <button
              className="secondary"
              onClick={() => {
                clearAnswer();
                setCatalog(null);
                setRefresh((value) => value + 1);
              }}
            >
              Speisekarte aktualisieren
            </button>
          </footer>
        </>
      )}
    </main>
  );
}
