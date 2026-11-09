import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { parseCartQuoteRequest } from "@provide/contracts";
import catalogFixture from "../../../../fixtures/storefront-catalog.json" with { type: "json" };
import { openCart } from "./shop-navigation.ts";

export async function verifyAshPickupUx(browser: Browser, output: string) {
  const menu = catalogFixture.menus[0]!;
  const item = {
    ...menu.sections[0]!.items[0]!,
    name: "Patatas Bravas",
    description: null,
    priceAmountMinor: 590,
  };
  const catalog = {
    ...catalogFixture,
    restaurant: { slug: "the-ash-aachen-test", name: "TEST The ASH Aachen" },
    location: { ...catalogFixture.location, slug: "aachen-test" },
    menus: [
      {
        ...menu,
        sections: [
          {
            key: "abholkarte",
            name: "TEST Abholkarte nach Shoppreisen",
            items: [
              item,
              ...Array.from({ length: 12 }, (_, index) => ({
                ...item,
                id: `fd000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
                name: index === 0 ? "Steakhouse Fries" : `Testgericht ${index}`,
              })),
            ],
          },
          {
            key: "desserts",
            name: "Desserts",
            items: [
              {
                ...item,
                id: "fe000000-0000-0000-0000-000000000001",
                name: "Brownie",
              },
            ],
          },
        ],
      },
    ],
  };
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-11-09T13:00:00Z"));
    let quotes = 0;
    await page.route("**/api/storefront/**", async (route) => {
      const url = new URL(route.request().url());
      const resource = url.pathname.split("/").at(-1);
      if (resource === "catalog") return route.fulfill({ json: { data: catalog } });
      if (resource === "availability") {
        const requestedFor = url.searchParams.get("requestedFor");
        return route.fulfill({
          json: {
            data: {
              status: requestedFor === "2026-11-09T13:30:00.000Z" ? "unavailable" : "available",
              fulfillmentType: "pickup",
              itemCount: Number(url.searchParams.get("itemCount")),
              requestedFor,
              evaluatedAt: "2026-11-09T13:00:00Z",
            },
          },
        });
      }
      if (resource === "checkout-context")
        return route.fulfill({ json: { data: { ready: true, csrf: "a".repeat(43) } } });
      if (resource === "cart-quote") {
        quotes++;
        const request = parseCartQuoteRequest(route.request().postDataJSON());
        assert.ok(request);
        const line = request.lines[0]!;
        const amount = line.quantity === 2 ? 650 : 590;
        return route.fulfill({
          json: {
            data: {
              status: line.quantity === 2 ? "changed" : "current",
              currentMenuVersionId: request.menuVersionId,
              currency: "EUR",
              itemCount: line.quantity,
              subtotalAmountMinor: amount * line.quantity,
              deliveryQuote: null,
              lines: [
                {
                  menuItemId: line.menuItemId,
                  quantity: line.quantity,
                  name: item.name,
                  variantId: null,
                  optionIds: [],
                  unitPriceAmountMinor: amount,
                  lineAmountMinor: amount * line.quantity,
                  selectionSnapshot: null,
                },
              ],
            },
          },
        });
      }
      throw Error(`Unexpected browser request: ${resource}`);
    });
    await page.goto(
      "http://127.0.0.1:4321/?restaurant=the-ash-aachen-test&location=aachen-test&ash-pickup&checkout=disabled",
    );
    const add = page.getByRole("button", { name: "Patatas Bravas hinzufügen" });
    await add.waitFor();
    assert.equal(await page.getByRole("button", { name: "Beliebt", exact: true }).count(), 0);
    assert.equal(await page.getByRole("combobox", { name: "Bestellart wählen" }).count(), 0);
    assert.equal(await page.locator(".shop-dish--compact .dish-photo-button").count(), 0);
    const search = page.getByRole("searchbox", { name: "Gericht suchen" });
    await search.fill("Gericht existiert nicht");
    await page.getByRole("button", { name: "Suche zurücksetzen" }).click();
    assert.equal(await search.inputValue(), "");
    await search.fill("fries");
    await page.getByRole("button", { name: "Steakhouse Fries hinzufügen" }).waitFor();
    assert.equal(await add.isVisible(), false);
    await page.getByRole("button", { name: "Abholkarte", exact: true }).click();
    await add.click();
    assert.equal(await add.locator(".shop-plus-count").innerText(), "1");
    await page.getByRole("button", { name: "Desserts", exact: true }).click();
    await openCart(page);
    await page.getByRole("button", { name: "Speisekarte", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Desserts", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: "Abholkarte", exact: true }).click();
    const scroll = await page.evaluate(() => {
      window.scrollTo(0, 480);
      return window.scrollY;
    });
    await openCart(page);
    await page.getByRole("button", { name: "Weiter zur Abholzeit", exact: true }).click();
    assert.equal(
      await page.locator("#requested-time").evaluate((input) => document.activeElement === input),
      true,
    );
    assert.equal(await page.getByRole("radio", { name: "Lieferung" }).count(), 0);
    await page
      .getByText("Der sichere Checkout ist noch nicht freigeschaltet.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: /^Frühestens/ }).click();
    assert.equal(await page.locator("#requested-time").inputValue(), "2026-11-09T14:45");
    await page
      .getByText("Aktuelle Speisekarte geprüft.")
      .waitFor({ timeout: 8000 })
      .catch(async (error: unknown) => {
        console.error(
          "ASH checkout fixture:",
          quotes,
          errors,
          await page.locator(".side-column").innerText(),
        );
        throw error;
      });
    assert.equal(quotes, 1);
    assert.equal(await page.getByRole("button", { name: /^Warenkorb ·/ }).count(), 0);
    const consent = page.getByRole("checkbox", { name: /Ich bestätige die angezeigten Gerichte/ });
    await consent.check();
    await page.getByRole("button", { name: "Patatas Bravas einmal mehr" }).click();
    await page.getByText("Aktualisierte Speisekarte – bitte erneut bestätigen.").waitFor();
    assert.equal(quotes, 2);
    assert.equal(await consent.isChecked(), false);
    await consent.check();
    await page.getByRole("button", { name: /15:00/ }).click();
    assert.equal(await page.locator("#requested-time").inputValue(), "2026-11-09T15:00");
    await page.getByText("Aktualisierte Speisekarte – bitte erneut bestätigen.").waitFor();
    assert.equal(quotes, 3);
    assert.equal(await consent.isChecked(), false);

    assert.equal(
      await page.getByRole("button", { name: "Abholbestellung absenden" }).isDisabled(),
      true,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: output + `ash-pickup-cart-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Speisekarte", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Abholkarte", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.ok(scroll > 0);
    assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - scroll) <= 4);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`ASH pickup shop ${width}px PASS`);
  }
}
