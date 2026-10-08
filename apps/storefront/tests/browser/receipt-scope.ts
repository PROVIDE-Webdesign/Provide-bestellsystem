import assert from "node:assert/strict";
import type { Browser, Page, Route } from "playwright";
import fixture from "../../../../fixtures/storefront-catalog.json" with { type: "json" };

/** Production Storefront, native browsers, synthetic HTTP/widget/storage fixtures.
 * Deliberately ignore abort in the transport: correctness must also guard continuations. */
export async function verifyReceiptScopeBrowser(browser: Browser, output: string) {
  const base = "/api/storefront/storefront-restaurant-a/storefront-a-mitte";
  const now = Date.parse("2026-10-08T10:00:00Z");
  const intent = {
    sessionId: "fc000000-0000-0000-0000-000000000031",
    submissionKey: "scope-regression-001",
    writeExpiresAt: new Date(now + 1800000).toISOString(),
    receiptExpiresAt: new Date(now + 5400000).toISOString(),
  };
  const confirmation = {
    orderId: "fa000000-0000-0000-0000-000000000421",
    orderNumber: "BS-00000421",
    status: "submitted",
    fulfillmentType: "pickup",
    paymentCollectionMode: "on_fulfillment",
    requestedFor: new Date(now + 3600000).toISOString(),
    currency: "EUR",
    totalAmountMinor: 1500,
    itemCount: 1,
    updatedAt: new Date(now).toISOString(),
    statusAvailableUntil: new Date(now + 176400000).toISOString(),
    statusAccessToken: "a".repeat(43),
  };
  const snapshot = (page: Page) =>
    page.evaluate(() => ({
      view: document.querySelector("main")?.textContent,
      cart: document.querySelector(".cart-panel")?.textContent,
      inputs: [...document.querySelectorAll<HTMLInputElement>("input")].map((i) => [
        i.id,
        i.value,
        i.checked,
      ]),
      focus: document.activeElement?.id,
      storage: Object.fromEntries(
        Object.keys(sessionStorage)
          .sort()
          .map((k) => [k, sessionStorage.getItem(k)]),
      ),
      local: Object.fromEntries(
        Object.keys(localStorage)
          .sort()
          .map((k) => [k, localStorage.getItem(k)]),
      ),
    }));
  for (const width of [1440, 390])
    for (const scenario of [
      "committed",
      "unsubmitted",
      "410",
      "503",
      "unmount",
      "bootstrap",
      "issue",
      "current",
    ] as const) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors: string[] = [],
        pending: Route[] = [];
      let reached!: () => void;
      const pendingStarted = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let writes = 0;
      page.on("pageerror", (e) => errors.push(e.message));
      await page.clock.setFixedTime(new Date(now));
      await page.addInitScript(
        ({ base, intent, restore }) => {
          if (restore)
            sessionStorage.setItem(
              "provide-checkout-intent:" + base,
              JSON.stringify({ scope: base, intent }),
            );
          const original = window.fetch.bind(window);
          Object.assign(window, {
            __scopeReturned: 0,
            turnstile: {
              render: (
                _: HTMLElement,
                options: { cData: string; callback: (token: string) => void },
              ) => {
                queueMicrotask(() => options.callback("synthetic-" + options.cData));
                return options.cData;
              },
              remove: () => undefined,
            },
          });
          window.fetch = async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            const tracked = url.startsWith(base) && /checkout-(receipt|session|context)$/.test(url);
            // Preserve native fetch but intentionally make its cancellation ineffective.
            const options = tracked && init ? { ...init, signal: null } : init;
            const response = await original(input, options);
            if (tracked)
              Object.assign(window, {
                __scopeReturned:
                  (window as unknown as { __scopeReturned: number }).__scopeReturned + 1,
              });
            return response;
          };
        },
        { base, intent, restore: !["bootstrap", "issue"].includes(scenario) },
      );
      await page.route("**/api/storefront/**", async (route) => {
        const url = new URL(route.request().url());
        const resource = url.pathname.split("/").at(-1);
        const isA = url.pathname.startsWith(base);
        if (resource === "catalog") {
          await route.fulfill({
            json: {
              data: {
                ...fixture,
                restaurant: {
                  ...fixture.restaurant,
                  name: isA ? "Synthetic Restaurant A" : "Synthetic Restaurant B",
                },
              },
            },
          });
        } else if (
          isA &&
          (resource === "checkout-receipt" ||
            (scenario === "bootstrap" && resource === "checkout-context") ||
            (scenario === "issue" && resource === "checkout-session"))
        ) {
          pending.push(route);
          reached();
        } else if (resource === "checkout-context") {
          await route.fulfill({ json: { data: { ready: true, csrf: "a".repeat(43) } } });
        } else if (["orders", "online-orders", "delivery-orders"].includes(resource ?? "")) {
          writes++;
          await route.fulfill({ status: 503, json: {} });
        } else
          await route.fulfill({ status: 503, json: { error: { code: "service_unavailable" } } });
      });
      try {
        await page.goto("http://127.0.0.1:4321");
        await page.getByRole("heading", { name: "Synthetic Restaurant A", exact: true }).waitFor();
        if (["bootstrap", "issue"].includes(scenario))
          await page
            .getByRole("button", { name: "Sicherheitsprüfung starten", exact: true })
            .click();
        await pendingStarted;
        assert.ok(pending.length > 0);
        if (scenario !== "current") {
          await page.evaluate(
            (unmount) =>
              window.dispatchEvent(
                new CustomEvent("synthetic-storefront-scope", {
                  detail: {
                    restaurant: "storefront-restaurant-b",
                    location: "storefront-b-mitte",
                    mounted: !unmount,
                  },
                }),
              ),
            scenario === "unmount",
          );
          if (scenario === "unmount")
            await page.getByText("Storefront geschlossen", { exact: true }).waitFor();
          else {
            await page
              .getByRole("heading", { name: "Synthetic Restaurant B", exact: true })
              .waitFor();
            await page.getByRole("button", { name: "Hinzufügen", exact: true }).first().click();
            await page.getByLabel("Name", { exact: true }).fill("Gast B");
            await page.getByLabel("Name", { exact: true }).focus();
            assert.equal(await page.locator(".cart-panel h2").textContent(), "1 Gerichte");
          }
        }
        const before = await snapshot(page);
        const returned = await page.evaluate(
          () => (window as unknown as { __scopeReturned: number }).__scopeReturned,
        );
        for (const route of pending) {
          await route.fulfill(
            scenario === "410" || scenario === "503"
              ? { status: Number(scenario), json: { error: { code: "service_unavailable" } } }
              : {
                  json: {
                    data:
                      scenario === "bootstrap"
                        ? { ready: true, csrf: "a".repeat(43), hasExistingIntents: true }
                        : scenario === "issue"
                          ? intent
                          : scenario === "unsubmitted"
                            ? { state: "unsubmitted", writeExpired: true }
                            : { state: "committed", mode: "orders", confirmation },
                  },
                },
          );
        }
        await page.waitForFunction(
          (n) => (window as unknown as { __scopeReturned: number }).__scopeReturned >= n,
          returned + pending.length,
        );
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        if (scenario === "current") {
          await page.locator(".order-reference").filter({ hasText: "BS-00000421" }).waitFor();
          assert.equal(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              "provide-checkout-intent:" + base,
            ),
            null,
          );
        } else {
          assert.deepEqual(
            await snapshot(page),
            before,
            `late ${scenario} must preserve cart/form/focus/storage`,
          );
          assert.equal(
            await page.locator(".order-reference").filter({ hasText: "BS-00000421" }).count(),
            0,
          );
        }
        assert.equal(writes, 0, "receipt/bootstrap/issue never auto-submit an order");
        assert.deepEqual(errors, []);
        await page.screenshot({
          path: output + `r23-scope-${scenario}-${width}.png`,
          fullPage: true,
        });
        console.log(`R23-01 ${scenario} ${width}: PASS (synthetic HTTP, native browser)`);
      } finally {
        await context.close();
      }
    }
}
