import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import {
  parseCartQuote,
  parseCartQuoteRequest,
  parseCheckoutIssue,
  parseGuestPickupOrderConfirmation,
  parseGuestPickupOrderRequest,
  parsePublicCatalog,
  record,
  taxAmount,
} from "@provide/contracts";
import fixture from "../../../../fixtures/storefront-catalog.json" with { type: "json" };

const now = Date.parse("2026-10-28T10:00:00Z");
const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, "0")}`;
function restaurant(letter: "a" | "b", seed: number, price: number, quantity: number) {
  const variant = {
    id: id("ea100000", seed),
    name: `TEST Variante ${letter}`,
    priceDeltaAmountMinor: 200,
    isActive: true,
  };
  const item = {
    id: id("f6000000", seed),
    name: `TEST Gericht ${letter}`,
    description: null,
    priceAmountMinor: price,
    availability: "available",
    configuration: {
      schemaVersion: 1,
      informationConfirmed: true,
      taxRateBasisPoints: 700,
      allergens: [],
      additives: [],
      variants: [variant],
      optionGroups: [],
    },
  };
  const slug = `storefront-restaurant-${letter}`,
    location = `storefront-${letter}-mitte`;
  const menuId = id("f4000000", seed),
    versionId = id("f5000000", seed);
  const catalog = parsePublicCatalog({
    ...fixture,
    restaurant: { slug, name: `TEST Restaurant ${letter}` },
    location: { ...fixture.location, slug: location, name: `TEST Standort ${letter}` },
    menus: [
      {
        id: menuId,
        versionId,
        name: `TEST Karte ${letter}`,
        currency: "EUR",
        sections: [{ key: "gerichte", name: "Gerichte", items: [item] }],
      },
    ],
  });
  const unit = price + variant.priceDeltaAmountMinor + 50;
  const total = unit * quantity;
  const quote = {
    status: "changed",
    currentMenuVersionId: versionId,
    currency: "EUR",
    itemCount: quantity,
    subtotalAmountMinor: total,
    deliveryQuote: null,
    lines: [
      {
        menuItemId: item.id,
        name: item.name,
        quantity,
        variantId: variant.id,
        optionIds: [],
        unitPriceAmountMinor: unit,
        lineAmountMinor: total,
        selectionSnapshot: {
          schemaVersion: 1,
          variant: { id: variant.id, name: variant.name, priceDeltaAmountMinor: 200 },
          options: [],
          allergens: [],
          additives: [],
          taxRateBasisPoints: 700,
          taxAmountMinor: taxAmount(total, 700),
        },
      },
    ],
  };
  assert.ok(parseCartQuote(quote));
  const confirmation = {
    orderId: id("fa000000", seed),
    orderNumber: `BS-${String(seed).padStart(8, "0")}`,
    statusAccessToken: letter.repeat(43),
    statusAvailableUntil: new Date(now + 49 * 3600000).toISOString(),
    status: "submitted",
    fulfillmentType: "pickup",
    paymentCollectionMode: "on_fulfillment",
    requestedFor: new Date(now + 3600000).toISOString(),
    currency: "EUR",
    totalAmountMinor: total,
    itemCount: quantity,
  };
  assert.ok(parseGuestPickupOrderConfirmation(confirmation));
  return {
    letter,
    slug,
    location,
    base: `/api/storefront/${slug}/${location}`,
    catalog,
    item,
    variant,
    menuId,
    versionId,
    quantity,
    quote,
    confirmation,
    writes: 0,
    statusReads: 0,
    submissionKey: "",
  };
}

/** Actual shared Storefront; distinct catalogs and transport doubles, no deployed tenant or payment. */
export async function verifyTwoRestaurantsBrowser(browser: Browser, output: string) {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const restaurants = [restaurant("a", 101, 1250, 2), restaurant("b", 201, 890, 1)];
    const errors: string[] = [];
    const observed: { restaurant: string; resource: string; method: string }[] = [];
    await context.addInitScript(() => {
      Object.assign(window, {
        turnstile: {
          render: (
            _element: HTMLElement,
            options: { cData: string; callback: (token: string) => void },
          ) => {
            queueMicrotask(() => options.callback("synthetic-" + options.cData));
            return options.cData;
          },
          remove: () => undefined,
        },
      });
    });
    await context.route("**/api/storefront/**", async (route) => {
      const url = new URL(route.request().url());
      const current = restaurants.find((r) => url.pathname.startsWith(r.base + "/"));
      assert.ok(current, "Every transport must address one of the two configured scopes");
      const resource = url.pathname.split("/").at(-1)!;
      observed.push({ restaurant: current.letter, resource, method: route.request().method() });
      if (resource === "catalog") return route.fulfill({ json: { data: current.catalog } });
      if (resource === "checkout-context")
        return route.fulfill({
          json: { data: { ready: true, csrf: "x".repeat(43), hasExistingIntents: false } },
        });
      const body = record(route.request().postDataJSON());
      if (resource === "cart-quote") {
        const request = parseCartQuoteRequest(body);
        assert.ok(request);
        assert.equal(request.menuId, current.menuId);
        assert.equal(request.menuVersionId, current.versionId);
        assert.equal(request.requestedFor, current.confirmation.requestedFor);
        assert.deepEqual(request.lines, [
          {
            menuItemId: current.item.id,
            quantity: current.quantity,
            variantId: current.variant.id,
          },
        ]);
        return route.fulfill({ json: { data: current.quote } });
      }
      if (resource === "checkout-session") {
        const request = parseCheckoutIssue(body);
        assert.ok(request);
        current.submissionKey = request.submissionKey;
        return route.fulfill({
          json: {
            data: {
              sessionId: id("fb000000", current.quantity === 2 ? 101 : 201),
              submissionKey: request.submissionKey,
              writeExpiresAt: new Date(now + 1800000).toISOString(),
              receiptExpiresAt: new Date(now + 5400000).toISOString(),
            },
          },
        });
      }
      if (resource === "orders") {
        const command = parseGuestPickupOrderRequest(body?.command);
        assert.ok(command);
        assert.equal(command.menuId, current.menuId);
        assert.equal(command.menuVersionId, current.versionId);
        assert.equal(command.submissionKey, current.submissionKey);
        assert.equal(command.customer.contactName, `Synthetic Guest ${current.letter}`);
        assert.deepEqual(command.lines, [
          {
            menuItemId: current.item.id,
            quantity: current.quantity,
            variantId: current.variant.id,
          },
        ]);
        current.writes++;
        return route.fulfill({ status: 201, json: { data: current.confirmation } });
      }
      if (resource === "checkout-receipt") {
        assert.equal(body?.submissionKey, current.submissionKey);
        return route.fulfill({
          json: {
            data: current.writes
              ? { state: "committed", mode: "orders", confirmation: current.confirmation }
              : { state: "unsubmitted", writeExpired: false },
          },
        });
      }
      if (resource === "order-status") {
        assert.equal(body?.orderId, current.confirmation.orderId);
        assert.equal(body?.statusAccessToken, current.confirmation.statusAccessToken);
        current.statusReads++;
        return route.fulfill({
          json: {
            data: {
              ...current.confirmation,
              status: "accepted",
              updatedAt: new Date(now).toISOString(),
            },
          },
        });
      }
      throw Error("Unexpected two-restaurant resource: " + resource);
    });
    async function verifyNotice(page: Page, mode: string) {
      const notice = page.locator("#checkout-privacy-notice");
      const toggle = notice.locator("summary");
      const checkbox = page.getByRole("checkbox", { name: /Datenschutzhinweis/ });
      const writesBefore = observed.filter((r) =>
        ["orders", "checkout-session"].includes(r.resource),
      ).length;
      assert.equal(await notice.getAttribute("open"), null);
      assert.equal(await checkbox.isChecked(), false);
      await toggle.focus();
      await toggle.press("Enter");
      assert.notEqual(await notice.getAttribute("open"), null);
      await notice.getByText("Bitte nur erfundene Testdaten verwenden.", { exact: true }).waitFor();
      assert.ok((await notice.innerText()).includes("preview-v1"));
      assert.ok((await notice.innerText()).includes("Cloudflare Turnstile"));
      assert.ok((await notice.innerText()).includes("Supabase-Datenbank"));
      assert.equal(
        await checkbox.isChecked(),
        false,
        "Opening the notice is not an acknowledgment",
      );
      assert.equal(
        observed.filter((r) => ["orders", "checkout-session"].includes(r.resource)).length,
        writesBefore,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
      );
      await page.screenshot({
        path: output + `checkout-notice-${mode}-${width}.png`,
        fullPage: true,
      });
      await toggle.press("Enter");
      assert.equal(await notice.getAttribute("open"), null);
    }
    const pages: Page[] = [];
    try {
      // The preview label follows the same activation prerequisites as the checkout controls.
      for (const mode of ["disabled", "missing-key"]) {
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        await page.clock.setFixedTime(new Date(now));
        await page.goto(`http://127.0.0.1:4321/?checkout=${mode}`);
        await page
          .getByRole("heading", { name: restaurants[0]!.catalog.restaurant.name, exact: true })
          .waitFor();
        assert.equal(
          await page.locator(".preview-label").textContent(),
          "Testansicht · Checkout nicht freigeschaltet",
        );
        await page
          .getByText("Der sichere Checkout ist noch nicht freigeschaltet.", { exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "Sicherheitsprüfung starten", exact: true })
            .count(),
          0,
        );
        await verifyNotice(page, mode);
        await page.close();
      }
      for (const current of restaurants) {
        const page = await context.newPage();
        pages.push(page);
        page.on("pageerror", (error) => errors.push(error.message));
        await page.clock.setFixedTime(new Date(now));
        await page.goto(
          `http://127.0.0.1:4321/?restaurant=${current.slug}&location=${current.location}`,
        );
        await page
          .getByRole("heading", { name: current.catalog.restaurant.name, exact: true })
          .waitFor();
        assert.equal(
          await page.locator(".preview-label").textContent(),
          "Testansicht · Test-Checkout aktiviert",
        );
        if (current.letter === "a") await verifyNotice(page, "enabled");
        const other = restaurants.find((r) => r !== current)!;
        assert.equal(
          await page.getByRole("heading", { name: other.item.name, exact: true }).count(),
          0,
        );
        const dish = page
          .locator("li.dish")
          .filter({ has: page.getByRole("heading", { name: current.item.name, exact: true }) });
        await dish.getByLabel("Variante", { exact: true }).selectOption(current.variant.id);
        await dish.getByRole("button", { name: "Hinzufügen", exact: true }).click();
        if (current.quantity === 2)
          await page.getByRole("button", { name: `${current.item.name} einmal mehr` }).click();
        await page
          .getByRole("heading", { name: `${current.quantity} Gerichte`, exact: true })
          .waitFor();
      }
      for (const [index, current] of restaurants.entries()) {
        const page = pages[index]!;
        await page.reload();
        await page
          .getByRole("heading", { name: `${current.quantity} Gerichte`, exact: true })
          .waitFor();
        assert.equal(
          (await page.locator(".cart-panel").innerText()).includes(
            restaurants[1 - index]!.item.name,
          ),
          false,
        );
        await page.getByLabel("Datum und Uhrzeit").fill("2026-10-28T12:00");
        await page
          .getByRole("button", { name: "Warenkorb und Preise prüfen", exact: true })
          .click();
        await page
          .getByText(
            "Die Speisekarte hat sich geändert. Prüfe die neuen Positionen und Preise und bestätige sie bewusst.",
            { exact: true },
          )
          .waitFor();
        const approval = page.getByRole("checkbox", {
          name: "Ich bestätige die angezeigten Gerichte, Auswahl und aktuellen Preise.",
        });
        assert.equal(await approval.isChecked(), false);
        await approval.check();
        const formatted = new Intl.NumberFormat("de-DE", {
          style: "currency",
          currency: "EUR",
        }).format(current.confirmation.totalAmountMinor / 100);
        assert.ok((await page.locator(".cart-panel").innerText()).includes(formatted));
        await page.getByLabel("Name", { exact: true }).fill(`Synthetic Guest ${current.letter}`);
        await page.getByLabel("Telefonnummer").fill("+999100000001");
        await page.getByLabel("E-Mail-Adresse").fill(`guest-${current.letter}@example.invalid`);
        await page.getByRole("checkbox", { name: /Datenschutzhinweis/ }).check();
        await page.getByRole("button", { name: "Sicherheitsprüfung starten", exact: true }).click();
        await page
          .getByText(
            "Bestellversuch vorbereitet. Du kannst die Bestellung jetzt ausdrücklich absenden.",
            { exact: true },
          )
          .waitFor();
        await page.getByRole("button", { name: "Abholbestellung absenden", exact: true }).click();
        await page
          .getByText(`Bestellnummer: ${current.confirmation.orderNumber}`, { exact: true })
          .waitFor();
        await page.getByRole("heading", { name: "Bestellung angenommen", exact: true }).waitFor();
        assert.equal(current.writes, 1);
        const other = restaurants[1 - index]!;
        assert.equal(
          (await page.locator("body").innerText()).includes(other.confirmation.orderNumber),
          false,
        );
        if (index === 0) {
          await pages[1]!.reload();
          await pages[1]!
            .getByRole("heading", { name: `${other.quantity} Gerichte`, exact: true })
            .waitFor();
          assert.equal(other.writes, 0, "Ordering in A must not submit or clear B");
        }
      }
      for (const [index, current] of restaurants.entries()) {
        const page = pages[index]!;
        await page.reload();
        await page
          .getByText(`Bestellnummer: ${current.confirmation.orderNumber}`, { exact: true })
          .waitFor();
        await page.getByRole("heading", { name: "Bestellung angenommen", exact: true }).waitFor();
        await page.getByRole("heading", { name: "0 Gerichte", exact: true }).waitFor();
        assert.equal(current.writes, 1, "Reload must restore status without a new order");
        assert.ok(current.statusReads > 0);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
        );
        await page.screenshot({
          path: output + `two-restaurants-${current.letter}-${width}.png`,
          fullPage: true,
        });
      }
      assert.notEqual(restaurants[0]!.submissionKey, restaurants[1]!.submissionKey);
      assert.deepEqual(errors, []);
      await writeFile(
        output + `two-restaurants-${width}.json`,
        JSON.stringify(
          {
            width,
            transport:
              "Actual shared Storefront in native browser; distinct synthetic catalogs, HTTP and challenge doubles; no deployed second restaurant or DB authorization claim",
            results: restaurants.map((r) => ({
              restaurant: r.slug,
              writes: r.writes,
              statusReads: r.statusReads,
              totalAmountMinor: r.confirmation.totalAmountMinor,
            })),
            cases: [
              "distinct-catalog-and-variant",
              "scoped-cart-reload",
              "independent-tabs",
              "server-price-change-review",
              "two-scoped-orders",
              "scoped-status-reload-no-resubmit",
              "checkout-activation-enabled-disabled-missing-key",
              "reachable-keyboard-privacy-notice-without-acknowledgment-or-submission",
            ],
            observed,
          },
          null,
          2,
        ),
      );
      console.log(
        `P2 two restaurants ${width}px: distinct catalogs/carts/prices/orders/status PASS (synthetic transport)`,
      );
    } finally {
      await context.close();
    }
  }
}
