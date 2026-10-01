import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, firefox, webkit } from "playwright";
import catalogFixture from "../../../../fixtures/storefront-catalog.json" with { type: "json" };
import rawConfiguration from "../../../../fixtures/menu-configuration.json" with { type: "json" };
import {
  parseMenuConfiguration,
  parsePublicCatalog,
  parseMenuAdminCommand,
  type MenuAdminState,
  type MenuAdminVersion,
} from "@provide/contracts";
const configuration = parseMenuConfiguration(rawConfiguration)!;
const catalog = parsePublicCatalog(catalogFixture),
  menu = catalog.menus[0]!,
  item = menu.sections[0]!.items[0]!;
const configuredCatalog = {
  ...catalog,
  menus: [
    {
      ...menu,
      sections: menu.sections.map((s) => ({
        ...s,
        items: s.items.map((i) => (i.id === item.id ? { ...i, configuration } : i)),
      })),
    },
  ],
};
const output = fileURLToPath(new URL("../../../../output/menu-cart-browser/", import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("./", import.meta.url)),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4321,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../../../", import.meta.url))] },
  },
});
await server.listen();
const engine = process.env.BROWSER_ENGINE ?? "chromium";
if (!["chromium", "firefox", "webkit"].includes(engine)) throw Error("Unsupported browser engine");
const engines = { chromium, firefox, webkit };
const selectedBrowser = engines[engine as "chromium" | "firefox" | "webkit"];
const browser = await selectedBrowser.launch({ headless: true });
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let quoted = 0,
      submitted = 0;
    await page.route("**/api/storefront/**", async (route) => {
      const resource = new URL(route.request().url()).pathname.split("/").at(-1);
      if (resource === "catalog") {
        await route.fulfill({ json: { data: configuredCatalog } });
        return;
      }
      const body = route.request().postDataJSON() as {
        lines?: { menuItemId: string; quantity: number; variantId: string; optionIds: string[] }[];
      };
      if (resource === "cart-quote") {
        quoted++;
        assert.equal(body.lines?.[0]?.variantId, configuration.variants[1]!.id);
        assert.deepEqual(body.lines[0].optionIds, [configuration.optionGroups[0]!.options[1]!.id]);
        await route.fulfill({
          json: {
            data: {
              status: "changed",
              currentMenuVersionId: menu.versionId,
              currency: "EUR",
              itemCount: 1,
              subtotalAmountMinor: 1500,
              deliveryQuote: null,
              lines: [
                {
                  menuItemId: item.id,
                  name: item.name,
                  quantity: 1,
                  variantId: configuration.variants[1]!.id,
                  optionIds: [configuration.optionGroups[0]!.options[1]!.id],
                  unitPriceAmountMinor: 1500,
                  lineAmountMinor: 1500,
                  selectionSnapshot: {
                    schemaVersion: 1,
                    informationConfirmed: true,
                    taxRateBasisPoints: 700,
                    grossAmountMinor: 1500,
                    taxAmountMinor: 98,
                    allergens: configuration.allergens,
                    additives: [],
                    variant: configuration.variants[1],
                    options: [configuration.optionGroups[0]!.options[1]],
                  },
                },
              ],
            },
          },
        });
        return;
      }
      if (resource === "orders") {
        submitted++;
        assert.equal(body.lines?.[0]?.variantId, configuration.variants[1]!.id);
        await route.fulfill({ status: 409, json: { error: { code: "conflict" } } });
        return;
      }
      await route.fulfill({ status: 404, json: {} });
    });
    await page.goto("http://127.0.0.1:4321");
    await page.getByRole("heading", { name: item.name, exact: true }).waitFor();
    const dish = page
      .locator("li.dish")
      .filter({ has: page.getByRole("heading", { name: item.name, exact: true }) });
    const nameBox = await dish.getByRole("heading", { name: item.name, exact: true }).boundingBox();
    assert.ok(nameBox && nameBox.width >= 150, "Dish name must have a readable column on mobile");
    await dish.getByRole("button", { name: "Hinzufügen" }).click();
    await dish.getByRole("alert").waitFor();
    await page.screenshot({ path: output + `picker-${viewport.width}.png`, fullPage: true });
    assert.match(await dish.getByRole("alert").innerText(), /vervollständige/);
    await dish.getByLabel("Variante", { exact: true }).selectOption(configuration.variants[1]!.id);
    await dish.getByRole("checkbox", { name: /Extra B/ }).check();
    await dish.getByRole("button", { name: "Hinzufügen" }).click();
    await page.getByRole("heading", { name: "1 Gerichte" }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "1 Gerichte" }).waitFor();
    await page.getByRole("heading", { name: item.name, exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Abholbestellung absenden" }).isDisabled(),
      true,
    );
    await page.getByLabel("Datum und Uhrzeit").fill("2026-10-02T12:00");
    await page.getByRole("button", { name: "Warenkorb und Preise prüfen" }).click();
    const confirmation = page.getByRole("checkbox", {
      name: "Ich bestätige die angezeigten Gerichte, Auswahl und aktuellen Preise.",
    });
    await confirmation.waitFor();
    assert.equal(await confirmation.isChecked(), false);
    await confirmation.check();
    assert.equal(
      await page.getByRole("button", { name: "Abholbestellung absenden" }).isEnabled(),
      true,
    );
    await page.getByLabel("Name", { exact: true }).fill("Synthetic");
    await page.getByLabel("Telefonnummer").fill("+999100000001");
    await page.getByLabel("E-Mail-Adresse").fill("synthetic@example.invalid");
    await page.getByRole("checkbox", { name: /Datenschutzhinweis/ }).check();
    await page.getByRole("button", { name: "Abholbestellung absenden" }).click();
    await page.getByText(/Die Bestellung konnte nicht angenommen werden/).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Abholbestellung absenden" }).isDisabled(),
      true,
    );
    assert.equal(quoted, 1);
    assert.equal(submitted, 1);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    await page.screenshot({ path: output + `cart-${viewport.width}.png`, fullPage: true });
    // Expired recovery must clear itself; the cart never restores checkout approval.
    await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (k.startsWith("provide:cart:")) {
          const v = JSON.parse(localStorage.getItem(k)!) as {
            createdAt: number;
            expiresAt: number;
          };
          v.createdAt = Date.now() - 86400001;
          v.expiresAt = v.createdAt + 86400000;
          localStorage.setItem(k, JSON.stringify(v));
        }
      }
    });
    await page.reload();
    await page.getByRole("heading", { name: "0 Gerichte" }).waitFor();
    const published: MenuAdminVersion = {
      id: menu.versionId,
      number: 1,
      status: "published",
      revision: 0,
      sections: [{ key: "dishes", name: "Dishes" }],
      items: [
        {
          id: item.id,
          sectionKey: "dishes",
          name: item.name,
          description: null,
          priceAmountMinor: 1250,
          isActive: true,
          configuration,
        },
      ],
    };
    let state: MenuAdminState = {
      timezone: "Europe/Berlin",
      stops: [],
      menus: [
        {
          id: menu.id,
          name: menu.name,
          versions: [published],
          publications: [{ versionId: published.id, effectiveAt: "2026-09-01T12:00:00Z" }],
        },
      ],
    };
    let saves = 0;
    await page.route("**/api/menu?*", async (route) => {
      if (route.request().method() === "POST") {
        const command = parseMenuAdminCommand(route.request().postDataJSON());
        assert.ok(command);
        if (command.action === "create_draft") {
          const draft = {
            ...published,
            id: "fa000000-0000-0000-0000-000000000009",
            number: 2,
            status: "draft" as const,
          };
          state = { ...state, menus: [{ ...state.menus[0]!, versions: [draft, published] }] };
        }
        if (command.action === "save_draft") {
          saves++;
          state = {
            ...state,
            menus: [
              {
                ...state.menus[0]!,
                versions: [{ ...state.menus[0]!.versions[0]!, ...command, revision: 1 }, published],
              },
            ],
          };
        }
      }
      await route.fulfill({ json: { data: state } });
    });
    await page.goto("http://127.0.0.1:4321/?dashboard");
    await page.getByRole("button", { name: "Menüstand laden" }).click();
    await page.getByRole("button", { name: "Als neuen Entwurf kopieren" }).click();
    await page.getByText("Version 2: Entwurf, für Kunden unsichtbar", { exact: false }).waitFor();
    await page.getByLabel("Preis in Euro", { exact: true }).fill("14");
    await page.getByLabel("Bestätigter Steuersatz in Prozent").fill("19");
    await page.getByRole("button", { name: "Entwurf speichern" }).click();
    await page.getByText(/Bitte bestätige zuerst die geprüften Produktinformationen/).waitFor();
    assert.equal(saves, 0);
    await page.getByRole("checkbox", { name: /Ich habe Steuersatz/ }).check();
    await page.getByRole("button", { name: "Entwurf speichern" }).click();
    await page.getByText(/Änderung gespeichert/).waitFor();
    assert.equal(saves, 1);
    await page.getByRole("button", { name: "Änderungsvorschau anzeigen" }).click();
    await page.getByText(/12.50 EUR → 14.00 EUR/).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({ path: output + `editor-${viewport.width}.png`, fullPage: true });
    await context.close();
    console.log(`Browser ${engine} menu/cart ${viewport.width}px PASS`);
  }
} finally {
  await browser.close();
  await server.close();
}
