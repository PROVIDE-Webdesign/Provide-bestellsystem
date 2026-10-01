"use client";
import { TaxBreakdown } from "./TaxBreakdown";
import { ItemPicker } from "./ItemPicker";
import { cartStorageKey, serializeCart, restoreCart } from "./cart-storage";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  orderReference,
  parseCartQuote,
  type CartQuote,
  parseOnlineOrderConfirmation,
  parsePaymentAction,
  parsePaymentSession,
  paymentStateLabels,
  type PaymentAction,
  isStorefrontScope,
  isValidGuestEmail,
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
  cartLineKey,
  cartSelectionLines,
  applyCartQuote,
  cartQuoteMatchesSelection,
  cartItemCount,
  cartTotalAmountMinor,
  setCartItemQuantity,
  type CartLine,
} from "./cart";
import { locationTimeToInstant } from "./time";
import {
  orderStatusStorageKey,
  parseStoredOrderStatusAccess,
  parseEmailStatusFragment,
  type StoredOrderStatusAccess,
} from "./status-storage";

interface StorefrontProps extends StorefrontScope {
  readonly onlinePaymentEnabled?: boolean;
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
  const [review, setReview] = useState<{
    quote: Extract<CartQuote, { status: "current" | "changed" }>;
    signature: string;
    accepted: boolean;
  } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const reviewRequest = useRef<AbortController | null>(null);
  const cartCreatedAt = useRef(Date.now());
  const [cartRestored, setCartRestored] = useState<string | null>(null);
  const [cartMessage, setCartMessage] = useState("");
  const [contactName, setContactName] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [email, setEmail] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [checkoutState, setCheckoutState] = useState<"idle" | "submitting" | "error">("idle");
  const [confirmation, setConfirmation] = useState<
    | GuestPickupOrderConfirmation
    | GuestDeliveryOrderConfirmation
    | ReturnType<typeof parseOnlineOrderConfirmation>
    | null
  >(null);
  const [onlinePayment, setOnlinePayment] = useState(false);
  const [paymentAction, setPaymentAction] = useState<PaymentAction | null>(null);
  const [openingPayment, setOpeningPayment] = useState(false);
  const [postalCode, setPostalCode] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [quoteAccepted, setQuoteAccepted] = useState(false);
  const [orderStatus, setOrderStatus] = useState<PublicOrderStatus | null>(null);
  const [statusAccess, setStatusAccess] = useState<StoredOrderStatusAccess | null>(null);
  const [statusState, setStatusState] = useState<"idle" | "loading" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const submissionKey = useRef<string | null>(null);
  const availabilityRequest = useRef<AbortController | null>(null);
  const checkoutRequest = useRef<AbortController | null>(null);
  const statusRequest = useRef<AbortController | null>(null);
  const restoredStatusScope = useRef<string | null>(null);
  const base = `/api/storefront/${encodeURIComponent(scope.restaurantSlug)}/${encodeURIComponent(scope.locationSlug)}`;
  const validScope = isStorefrontScope(scope);
  const totalQuantity = cartItemCount(cart);
  const paymentStorageKey = `provide-payment-action:${base}`;
  useEffect(() => {
    try {
      const parsed = parsePaymentAction(
        JSON.parse(sessionStorage.getItem(paymentStorageKey) ?? "null"),
      );
      setPaymentAction(parsed && Date.parse(parsed.paymentDeadline) > Date.now() ? parsed : null);
    } catch {
      setPaymentAction(null);
    }
  }, [paymentStorageKey]);

  const storageKey = cartStorageKey(scope);
  useEffect(() => {
    setReview(null);
    setCart([]);
    cartCreatedAt.current = Date.now();
    try {
      const restored = restoreCart(storageKey ? localStorage.getItem(storageKey) : null);
      if (restored) {
        setCart(restored.lines);
        cartCreatedAt.current = restored.createdAt;
        setCartMessage(
          "Dein gespeicherter Warenkorb ist wieder da. Bitte prüfe die aktuellen Preise und Verfügbarkeit.",
        );
      }
    } catch {
      /* In-memory checkout remains available. */
    }
    setCartRestored(storageKey ?? null);
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey || cartRestored !== storageKey) return;
    try {
      if (!cart.length) {
        localStorage.removeItem(storageKey);
        cartCreatedAt.current = Date.now();
      } else {
        const stored = serializeCart(cart, cartCreatedAt.current);
        if (stored) localStorage.setItem(storageKey, stored);
        else localStorage.removeItem(storageKey);
      }
    } catch {
      /* Persistence is optional. */
    }
  }, [cart, storageKey, cartRestored]);
  const reviewSignature = JSON.stringify([cart, fulfillmentType, localTime, postalCode]);
  const reviewIsAccepted = !!review?.accepted && review.signature === reviewSignature;
  async function reviewCart() {
    if (!catalog || !cart.length || reviewing) return;
    if (fulfillmentType === "delivery" && !/^[0-9]{5}$/.test(postalCode)) {
      setCartMessage("Bitte gib zuerst die fünfstellige Lieferpostleitzahl ein.");
      return;
    }
    const requestedFor = locationTimeToInstant(localTime, catalog.location.timezone);
    if (!requestedFor) {
      setCartMessage("Bitte wähle zuerst einen gültigen Bestellzeitpunkt.");
      return;
    }
    const controller = new AbortController();
    reviewRequest.current?.abort();
    reviewRequest.current = controller;
    setReviewing(true);
    setReview(null);
    try {
      const response = await fetch(base + "/cart-quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          menuId: cart[0]!.menuId,
          menuVersionId: cart[0]!.menuVersionId,
          fulfillmentType,
          requestedFor,
          lines: cartSelectionLines(cart),
          ...(fulfillmentType === "delivery" ? { postalCode } : {}),
        }),
      });
      const body = (await response.json()) as { data?: unknown };
      if (controller.signal.aborted) return;
      const quote = parseCartQuote(body.data);
      if (!response.ok || !quote) throw Error("Quote unavailable");
      if (quote.status === "unavailable") {
        setCartMessage(
          "Deine Auswahl, Wunschzeit oder Lieferung ist nicht mehr verfügbar. Bitte entferne betroffene Gerichte oder ändere deine Auswahl und prüfe erneut.",
        );
        setRefresh((n) => n + 1);
        return;
      }
      if (!cartQuoteMatchesSelection(cart, quote))
        throw Error("Quote does not match requested selection");
      const next = applyCartQuote(cart, quote);
      setCart(next);
      setDeliveryQuote(quote.deliveryQuote);
      setQuoteAccepted(false);
      submissionKey.current = null;
      setReview({
        quote,
        signature: JSON.stringify([next, fulfillmentType, localTime, postalCode]),
        accepted: false,
      });
      setCartMessage(
        quote.status === "changed"
          ? "Die Speisekarte hat sich geändert. Prüfe die neuen Positionen und Preise und bestätige sie bewusst."
          : "Preise und Auswahl sind serverseitig geprüft. Bitte bestätige die Übersicht.",
      );
    } catch {
      if (!controller.signal.aborted)
        setCartMessage("Die Warenkorbprüfung ist gerade nicht verfügbar. Bitte erneut versuchen.");
    } finally {
      if (reviewRequest.current === controller) {
        setReviewing(false);
        reviewRequest.current = null;
      }
    }
  }

  async function openPayment() {
    if (!paymentAction || openingPayment) return;
    setOpeningPayment(true);
    setStatusMessage("");
    try {
      const r = await fetch(`${base}/payment-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(paymentAction),
        cache: "no-store",
      });
      const body = (await r.json()) as { data?: unknown };
      const session = parsePaymentSession(body.data);
      if (!r.ok || !session) throw new Error("Payment unavailable");
      if (session.checkoutUrl) {
        window.location.assign(session.checkoutUrl);
        return;
      }
      setStatusMessage(paymentStateLabels[session.paymentState]);
    } catch {
      setStatusMessage(
        "Die Zahlung konnte nicht geöffnet werden. Bitte prüfe den Bestellstatus und versuche es erneut.",
      );
    } finally {
      setOpeningPayment(false);
    }
  }
  const displayTotal = cartTotalAmountMinor(cart);
  const currency = cart[0]?.currency ?? catalog?.menus[0]?.currency ?? "EUR";

  const money = (amountMinor: number, currencyCode = currency) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: currencyCode }).format(
      amountMinor / 100,
    );

  function invalidateSubmission(invalidateQuote = true) {
    if (invalidateQuote) {
      reviewRequest.current?.abort();
      reviewRequest.current = null;
      setReviewing(false);
      setReview(null);
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
    // Repeated effect setup must preserve a consumed email link when storage is blocked.
    if (restoredStatusScope.current === key) return;
    restoredStatusScope.current = key;
    statusRequest.current?.abort();
    setStatusAccess(null);
    setOrderStatus(null);
    setConfirmation(null);
    setStatusMessage("");
    const fromEmail = parseEmailStatusFragment(window.location.hash);
    if (window.location.hash)
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (fromEmail) {
      setStatusAccess(fromEmail);
      try {
        sessionStorage.setItem(key, JSON.stringify(fromEmail));
      } catch {
        /* Memory access still works. */
      }
      return;
    }
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
    if (
      orderStatus &&
      terminalStatuses.includes(orderStatus.status) &&
      !["refund_pending", "checking", "cancelling"].includes(orderStatus.paymentState ?? "")
    )
      return;
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
    setDeliveryQuote(null);
    setQuoteAccepted(false);
    setCatalog(null);
    setReview(null);
    reviewRequest.current?.abort();
    reviewRequest.current = null;
    setReviewing(false);
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
      reviewRequest.current?.abort();
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

  async function submitCheckout() {
    if (!catalog || cart.length === 0 || checkoutState === "submitting") return;
    setConfirmation(null);
    if (!reviewIsAccepted) {
      setCartMessage("Bitte prüfe und bestätige zuerst den Warenkorb.");
      return;
    }
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
    if (!isValidGuestEmail(email.trim())) {
      setCartMessage("Bitte gib eine gültige E-Mail-Adresse für deine Bestellnachrichten ein.");
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
        `${base}/${onlinePayment ? "online-orders" : fulfillmentType === "delivery" ? "delivery-orders" : "orders"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            ...(onlinePayment ? { fulfillmentType } : {}),
            menuId: cart[0]!.menuId,
            menuVersionId: cart[0]!.menuVersionId,
            requestedFor,
            lines: cartSelectionLines(cart),
            submissionKey: key,
            customer: {
              contactName: contactName.trim(),
              phoneE164: phoneE164.trim(),
              email: email.trim().toLowerCase(),
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
        if (response.status === 409) setReview(null);
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
      const result = onlinePayment
        ? parseOnlineOrderConfirmation(payload.data)
        : fulfillmentType === "delivery"
          ? parseGuestDeliveryOrderConfirmation(payload.data)
          : parseGuestPickupOrderConfirmation(payload.data);
      if (!result) throw new Error("Invalid confirmation");
      setConfirmation(result);
      if (result.paymentCollectionMode === "online") {
        const action = {
          orderId: result.orderId,
          paymentAccessToken: result.paymentAccessToken,
          paymentDeadline: result.paymentDeadline,
        };
        setPaymentAction(action);
        try {
          sessionStorage.setItem(paymentStorageKey, JSON.stringify(action));
        } catch {
          /* in-memory fallback */
        }
      } else {
        setPaymentAction(null);
        try {
          sessionStorage.removeItem(paymentStorageKey);
        } catch {
          /* optional storage */
        }
      }
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
      setReview(null);
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
            {orderStatus?.paymentState &&
            orderStatus.status === "submitted" &&
            orderStatus.paymentState !== "paid"
              ? paymentStateLabels[orderStatus.paymentState]
              : confirmation?.paymentCollectionMode === "online" && !orderStatus
                ? "Zahlung offen"
                : orderStatus
                  ? orderStatus.fulfillmentType === "delivery" && orderStatus.status === "ready"
                    ? orderStatus.communication?.dispatchedAt
                      ? "Unterwegs"
                      : "Bereit zur Auslieferung"
                    : orderStatus.fulfillmentType === "delivery" &&
                        orderStatus.status === "completed"
                      ? "Zugestellt"
                      : statusLabels[orderStatus.status]
                  : confirmation
                    ? statusLabels[confirmation.status]
                    : "Bestellstatus"}
          </h2>
          {orderStatus?.taxSummary && (
            <TaxBreakdown summary={orderStatus.taxSummary} currency={orderStatus.currency} />
          )}
          {(orderStatus || confirmation) && (
            <p className="order-reference">
              Bestellnummer: {orderReference((orderStatus ?? confirmation)!)}
            </p>
          )}
          {(orderStatus || confirmation) && (
            <p>
              {(orderStatus ?? confirmation)!.itemCount} Gerichte ·{" "}
              {money(
                (orderStatus ?? confirmation)!.totalAmountMinor,
                (orderStatus ?? confirmation)!.currency,
              )}{" "}
              ·{" "}
              {(orderStatus ?? confirmation)?.paymentCollectionMode === "online"
                ? "Onlinezahlung im Testbetrieb"
                : "Zahlung bei "}
              {(orderStatus ?? confirmation)?.paymentCollectionMode === "online"
                ? ""
                : (orderStatus ?? confirmation)?.fulfillmentType === "delivery"
                  ? "Lieferung"
                  : "Abholung"}
            </p>
          )}
          {orderStatus?.communication?.confirmedFor && (
            <p>
              Bestätigte {orderStatus.fulfillmentType === "delivery" ? "Lieferzeit" : "Abholzeit"}:{" "}
              {new Intl.DateTimeFormat("de-DE", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: orderStatus.communication.timezone,
              }).format(new Date(orderStatus.communication.confirmedFor))}{" "}
              Uhr
            </p>
          )}
          {confirmation && !orderStatus && (
            <p>
              {confirmation.paymentCollectionMode === "online"
                ? "Bitte schließe die Testzahlung ab. Erst danach kann das Restaurant die Bestellung annehmen."
                : "Das Restaurant muss die Bestellung im nächsten Prozessschritt noch annehmen."}
            </p>
          )}
          {orderStatus?.paymentState && <p>{paymentStateLabels[orderStatus.paymentState]}</p>}
          {paymentAction &&
            paymentAction.orderId === (orderStatus ?? confirmation)?.orderId &&
            Date.parse(paymentAction.paymentDeadline) > Date.now() &&
            (!orderStatus?.paymentState ||
              orderStatus.paymentState === "open" ||
              orderStatus.paymentState === "checking") && (
              <button type="button" disabled={openingPayment} onClick={() => void openPayment()}>
                {openingPayment ? "Zahlung wird geöffnet …" : "Testzahlung öffnen oder fortsetzen"}
              </button>
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
                              <ItemPicker
                                key={menu.versionId + ":" + item.id}
                                item={item}
                                currency={menu.currency}
                                onAdd={(selection) => {
                                  const next = addCartItem(cart, menu, item, selection);
                                  if (next === cart)
                                    setCartMessage(
                                      "Diese Auswahl ist nicht gültig oder passt nicht zu deinem Warenkorb. Bitte prüfe Auswahl und Speisekarte.",
                                    );
                                  else {
                                    setCart(next);
                                    setCartMessage("");
                                    invalidateSubmission();
                                  }
                                }}
                              />
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
                          <li key={cartLineKey(line)}>
                            <div>
                              <strong>{line.name}</strong>
                              {!!line.selectionLabels?.length && (
                                <small>{line.selectionLabels.join(", ")}</small>
                              )}
                              <span>{money(line.unitPriceAmountMinor * line.quantity)}</span>
                            </div>
                            <div className="quantity-controls">
                              <button
                                type="button"
                                className="secondary compact"
                                aria-label={`${line.name} einmal weniger`}
                                onClick={() => {
                                  setCart(
                                    setCartItemQuantity(cart, cartLineKey(line), line.quantity - 1),
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
                                    setCartItemQuantity(cart, cartLineKey(line), line.quantity + 1),
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

                  <section aria-label="Warenkorb prüfen und bestätigen">
                    <button
                      type="button"
                      disabled={!cart.length || reviewing}
                      onClick={() => void reviewCart()}
                    >
                      {reviewing ? "Wird serverseitig geprüft …" : "Warenkorb und Preise prüfen"}
                    </button>
                    {review && review.signature === reviewSignature && (
                      <>
                        <p>
                          {review.quote.status === "changed"
                            ? "Aktualisierte Speisekarte – bitte erneut bestätigen."
                            : "Aktuelle Speisekarte geprüft."}
                        </p>
                        <p>
                          Artikel: {money(review.quote.subtotalAmountMinor)}
                          {review.quote.deliveryQuote && (
                            <>
                              {" "}
                              · Liefergebühr:{" "}
                              {money(review.quote.deliveryQuote.deliveryFeeAmountMinor)} · Gesamt:{" "}
                              {money(review.quote.deliveryQuote.totalAmountMinor)}
                            </>
                          )}
                        </p>
                        <TaxBreakdown
                          summary={review.quote.taxSummary}
                          currency={review.quote.currency}
                        />
                        <label>
                          <input
                            type="checkbox"
                            checked={review.accepted}
                            onChange={(e) => {
                              setReview({ ...review, accepted: e.target.checked });
                              setQuoteAccepted(e.target.checked);
                            }}
                          />
                          Ich bestätige die angezeigten Gerichte, Auswahl und aktuellen Preise.
                        </label>
                      </>
                    )}
                  </section>
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
                      {deliveryQuote && (
                        <div aria-live="polite">
                          <p>Mindestbestellwert: {money(deliveryQuote.minimumAmountMinor)}</p>
                          <p>Artikel: {money(deliveryQuote.subtotalAmountMinor)}</p>
                          <p>Liefergebühr: {money(deliveryQuote.deliveryFeeAmountMinor)}</p>
                          <p>
                            <strong>Gesamt: {money(deliveryQuote.totalAmountMinor)}</strong> ·
                            Zahlung bei Lieferung
                          </p>
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
                    {scope.onlinePaymentEnabled && (
                      <label>
                        Zahlungsart
                        <select
                          value={onlinePayment ? "online" : "on_fulfillment"}
                          onChange={(e) => {
                            invalidateSubmission(false);
                            setOnlinePayment(e.target.value === "online");
                          }}
                        >
                          <option value="on_fulfillment">Zahlung bei Übergabe</option>
                          <option value="online">Online bezahlen – Testzahlung</option>
                        </select>
                      </label>
                    )}
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
                    <label htmlFor="contact-email">E-Mail-Adresse</label>
                    <input
                      id="contact-email"
                      type="email"
                      autoComplete="email"
                      required
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
                        !reviewIsAccepted ||
                        (fulfillmentType === "delivery" && (!deliveryQuote || !quoteAccepted)) ||
                        checkoutState === "submitting"
                      }
                    >
                      {checkoutState === "submitting"
                        ? "Wird übermittelt …"
                        : onlinePayment
                          ? "Bestellung für Testzahlung reservieren"
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
