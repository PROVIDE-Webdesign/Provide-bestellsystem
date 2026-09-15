"use client";

import { useEffect, useRef, useState } from "react";
import {
  isStorefrontScope,
  parsePublicCatalog,
  parsePublicAvailability,
  type FulfillmentType,
  type PublicCatalog,
  type StorefrontScope,
} from "@provide/contracts";
import { locationTimeToInstant } from "./time";

export default function Storefront(scope: StorefrontScope) {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [refresh, setRefresh] = useState(0);
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("pickup");
  const [localTime, setLocalTime] = useState("");
  const [itemCount, setItemCount] = useState("1");
  const [answer, setAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const availabilityRequest = useRef<AbortController | null>(null);
  const base = `/api/storefront/${encodeURIComponent(scope.restaurantSlug)}/${encodeURIComponent(scope.locationSlug)}`;
  const validScope = isStorefrontScope(scope);

  function clearAnswer() {
    availabilityRequest.current?.abort();
    availabilityRequest.current = null;
    setAnswer("");
    setChecking(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    availabilityRequest.current?.abort();
    availabilityRequest.current = null;
    setCatalog(null);
    setAnswer("");
    setChecking(false);
    setLoadState("loading");
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
      availabilityRequest.current?.abort();
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
    if (!/^[1-9]\d{0,3}$/.test(itemCount) || Number(itemCount) > 1000) {
      setAnswer("Bitte gib eine Anzahl zwischen 1 und 1000 ein.");
      return;
    }
    const controller = new AbortController();
    availabilityRequest.current = controller;
    setChecking(true);
    try {
      const query = new URLSearchParams({ fulfillmentType, requestedFor, itemCount });
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
      if (controller.signal.aborted) return;
      setAnswer(
        result.status === "available"
          ? "Für deine Auswahl ist derzeit Kapazität verfügbar. Es wurde nichts reserviert. Die einzelnen Gerichte werden beim späteren Bestellen erneut geprüft."
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

  return (
    <main className="storefront">
      <a className="skip-link" href="#menu">
        Zur Speisekarte
      </a>
      <header className="brand">
        <a href="/">
          PROVIDE<span> BESTELLEN</span>
        </a>
        <span className="preview-label">Testansicht · keine Bestellungen</span>
      </header>
      {loadState === "loading" && (
        <section aria-live="polite">
          <h1>Speisekarte wird geladen …</h1>
        </section>
      )}
      {loadState === "missing" && (
        <section>
          <h1>Speisekarte derzeit nicht verfügbar</h1>
          <p>Für diesen Standort ist aktuell keine öffentliche Speisekarte verfügbar.</p>
          <button onClick={() => setRefresh((v) => v + 1)}>Erneut prüfen</button>
        </section>
      )}
      {loadState === "error" && (
        <section role="alert">
          <h1>Verbindung gerade nicht möglich</h1>
          <p>Bitte lade die Speisekarte erneut.</p>
          <button onClick={() => setRefresh((v) => v + 1)}>Erneut laden</button>
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
          <div className="storefront-grid">
            <div id="menu" tabIndex={-1}>
              {catalog.menus.length === 0 && (
                <p>Hier sind derzeit keine Gerichte veröffentlicht.</p>
              )}
              {catalog.menus.map((menu) => (
                <section className="menu" key={menu.id} aria-label={menu.name}>
                  <h2>{menu.name}</h2>
                  {menu.sections.length === 0 && (
                    <p>Hier sind derzeit keine Gerichte veröffentlicht.</p>
                  )}
                  {menu.sections.map((section) => (
                    <div className="menu-section" key={section.key}>
                      <h3>{section.name}</h3>
                      {section.items.length === 0 ? (
                        <p>In dieser Kategorie sind derzeit keine Gerichte verfügbar.</p>
                      ) : (
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
                              <span className="price">
                                {new Intl.NumberFormat("de-DE", {
                                  style: "currency",
                                  currency: menu.currency,
                                }).format(item.priceAmountMinor / 100)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </section>
              ))}
            </div>
            <aside className="availability-panel" aria-labelledby="availability-title">
              <p className="eyebrow">DEIN WUNSCHTERMIN</p>
              <h2 id="availability-title">Wann passt es dir?</h2>
              <p>Prüfe die Kapazität für deinen gewünschten Zeitpunkt.</p>
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
                    setLocalTime(event.target.value);
                  }}
                  aria-describedby="timezone-note"
                />
                <p id="timezone-note" className="field-hint">
                  Ortszeit des Restaurants: {catalog.location.timezone}
                </p>
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
                <button type="submit" disabled={checking}>
                  {checking ? "Wird geprüft …" : "Verfügbarkeit prüfen"}
                </button>
                <p className="answer" role="status" aria-live="polite">
                  {answer}
                </p>
              </form>
              <p className="fine-print">
                Die Prüfung ist unverbindlich und reserviert weder Gerichte noch einen Termin.
              </p>
            </aside>
          </div>
          <footer>
            <span>Preise und Verfügbarkeit können sich ändern.</span>
            <button
              className="secondary"
              onClick={() => {
                clearAnswer();
                setCatalog(null);
                setRefresh((v) => v + 1);
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
