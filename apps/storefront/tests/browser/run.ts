import { verifySupportBrowser } from "./support.ts";
import { verifyRecoveryBrowser } from "./recovery.ts";
import { verifyLocationOperationsBrowser } from "./location-operations.ts";
import assert from "node:assert/strict";
import { verifyOrderLiveBrowser } from "./order-live.ts";
import { verifyViewerBrowser } from "./viewer.ts";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, firefox, webkit } from "playwright";
import catalogFixture from "../../../../fixtures/storefront-catalog.json" with { type: "json" };
import pendingImport from "../../../../docs/pilot/asian-kitchen-12-0-r1-pending.json" with { type: "json" };
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
  resolve: { alias: { "@": fileURLToPath(new URL("../../../dashboard/", import.meta.url)) } },
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
    // Synthetic fixture access expires on Oct 4; keep its observation date
    // deterministic without freezing timers or changing production expiry.
    await page.clock.setFixedTime(new Date("2026-10-03T10:00:00.000Z"));
    await page.addInitScript(() => {
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
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let quoted = 0,
      submitted = 0;
    const numbered = {
      orderId: "fa000000-0000-0000-0000-000000000421",
      orderNumber: "BS-00000421",
      status: "submitted",
      fulfillmentType: "pickup",
      paymentCollectionMode: "on_fulfillment",
      requestedFor: "2026-10-02T10:00:00.000Z",
      currency: "EUR",
      totalAmountMinor: 1500,
      itemCount: 1,
      updatedAt: "2026-10-01T10:00:00.000Z",
      statusAvailableUntil: "2026-10-04T10:00:00.000Z",
    };
    await page.route("**/api/storefront/**", async (route) => {
      const resource = new URL(route.request().url()).pathname.split("/").at(-1);
      if (resource === "catalog") {
        await route.fulfill({ json: { data: configuredCatalog } });
        return;
      }
      if (resource === "checkout-context") {
        await route.fulfill({ json: { data: { ready: true, csrf: "a".repeat(43) } } });
        return;
      }
      if (resource === "checkout-session") {
        const q = route.request().postDataJSON() as { submissionKey: string };
        await route.fulfill({
          json: {
            data: {
              sessionId: "fb000000-0000-0000-0000-000000000021",
              submissionKey: q.submissionKey,
              writeExpiresAt: "2026-10-03T10:30:00.000Z",
              receiptExpiresAt: "2026-10-03T11:30:00.000Z",
            },
          },
        });
        return;
      }
      if (resource === "checkout-receipt") {
        await route.fulfill({ json: { data: { state: "unsubmitted", writeExpired: false } } });
        return;
      }
      if (resource === "order-status") {
        await route.fulfill({ json: { data: { ...numbered, status: "accepted" } } });
        return;
      }
      const posted: unknown = route.request().postDataJSON();
      const body = (resource === "orders" ? (posted as { command: unknown }).command : posted) as {
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
              taxSummary: {
                schemaVersion: 1,
                status: "complete",
                subtotalAmountMinor: 1500,
                discountAmountMinor: 0,
                deliveryFeeAmountMinor: 0,
                totalAmountMinor: 1500,
                knownNetAmountMinor: 1402,
                taxAmountMinor: 98,
                undeclaredGrossAmountMinor: 0,
                buckets: [
                  {
                    taxRateBasisPoints: 700,
                    grossAmountMinor: 1500,
                    netAmountMinor: 1402,
                    taxAmountMinor: 98,
                  },
                ],
              },
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
        await route.fulfill(
          submitted === 1
            ? { status: 409, json: { error: { code: "conflict" } } }
            : { status: 201, json: { data: { ...numbered, statusAccessToken: "a".repeat(43) } } },
        );
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
    await page.getByText("Enthaltene Steuern und Summen", { exact: true }).click();
    await page.getByText("Enthaltene Steuer 7 %: 0,98 €", { exact: false }).waitFor();
    await page.screenshot({ path: output + `tax-${viewport.width}.png`, fullPage: true });
    await confirmation.check();
    await page.getByRole("button", { name: "Sicherheitsprüfung starten" }).click();
    await page
      .getByText(
        "Bestellversuch vorbereitet. Du kannst die Bestellung jetzt ausdrücklich absenden.",
      )
      .waitFor();
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
    await page.getByRole("button", { name: "Warenkorb und Preise prüfen" }).click();
    await confirmation.waitFor();
    await confirmation.check();
    await page.getByRole("button", { name: "Abholbestellung absenden" }).click();
    await page.getByText("Bestellnummer: BS-00000421", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Bestellung angenommen", exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: output + `order-number-guest-${viewport.width}.png`,
      fullPage: true,
    });
    await page.reload();
    await page.getByText("Bestellnummer: BS-00000421", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Bestellung angenommen", exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
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
    await page.getByRole("heading", { name: "Bestellung angenommen", exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
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
      deliveryTax: {
        policyId: "fa000000-0000-0000-0000-000000000011",
        mode: "undeclared",
        taxRateBasisPoints: null,
      },
      menus: [
        {
          id: menu.id,
          name: menu.name,
          versions: [published],
          publications: [{ versionId: published.id, effectiveAt: "2026-09-01T12:00:00Z" }],
        },
      ],
    };
    let saves = 0,
      imports = 0;
    await page.route("**/api/menu?*", async (route) => {
      if (route.request().method() === "POST") {
        const command = parseMenuAdminCommand(route.request().postDataJSON());
        assert.ok(command);
        if (command.action === "set_delivery_tax") {
          state = {
            ...state,
            deliveryTax: {
              policyId: "fa000000-0000-0000-0000-000000000012",
              mode: command.mode,
              taxRateBasisPoints: command.taxRateBasisPoints,
            },
          };
        }
        if (command.action === "import_draft") {
          imports++;
          const version: MenuAdminVersion = {
            id: "fa000000-0000-0000-0000-000000000013",
            number: 3,
            status: "draft",
            revision: 1,
            sections: command.sections,
            items: command.items,
          };
          state = {
            ...state,
            menus: [{ ...state.menus[0]!, versions: [version, ...state.menus[0]!.versions] }],
          };
        }
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
    const fee = page.getByRole("group", { name: "Steuerregel für die Liefergebühr" });
    const feeSave = fee.getByRole("button", { name: "Steuerregel als neue Lieferregel speichern" });
    assert.equal(await feeSave.isDisabled(), true);
    await fee.getByLabel("Bestätigter Liefergebühr-Steuersatz in Prozent").fill("19");
    await fee.getByLabel("Begründung", { exact: true }).fill("Synthetic declared fee");
    await fee.getByLabel("Die fachliche Steuerregel wurde geprüft und bestätigt.").check();
    await feeSave.click();
    await fee.getByText("Aktuell: 19 %", { exact: true }).waitFor();
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
    await page.waitForLoadState("networkidle");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: output + `editor-${viewport.width}.png`, fullPage: true });
    const fileInput = page.getByLabel("Importdatei (JSON)");
    await fileInput.setInputFiles({
      name: "pending.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(pendingImport)),
    });
    await page.getByText("Import gesperrt:", { exact: false }).waitFor();
    const importButton = page.getByRole("button", { name: "Als neuen Entwurf importieren" });
    assert.equal(await importButton.isDisabled(), true);
    assert.equal(imports, 0);
    const completedImport = {
      format: "provide-menu-import-v1",
      source: { name: "synthetic-import.json", sha256: "c".repeat(64) },
      sections: published.sections,
      items: published.items,
    };
    await fileInput.setInputFiles({
      name: "complete.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(completedImport)),
    });
    await page.getByText("Import geprüft.", { exact: false }).waitFor();
    page.once("dialog", (dialog) => void dialog.accept());
    await importButton.click();
    await page.getByText("Version 3: Entwurf, für Kunden unsichtbar", { exact: false }).waitFor();
    assert.equal(imports, 1);
    await page.screenshot({ path: output + `import-${viewport.width}.png`, fullPage: true });
    const { statusAvailableUntil: _until, ...summary } = numbered;
    void _until;
    await page.route("**/api/orders**", async (route) => {
      const detailed = new URL(route.request().url()).pathname !== "/api/orders";
      const order = { ...summary, allowedTransitions: ["accepted", "rejected", "cancelled"] };
      await route.fulfill({
        json: {
          data: detailed
            ? {
                ...order,
                restaurantId: "f2000000-0000-0000-0000-000000000001",
                locationId: "f3000000-0000-0000-0000-000000000001",
                contactName: "Synthetic Guest",
                lines: [
                  {
                    lineNumber: 1,
                    displayName: "Synthetic",
                    quantity: 1,
                    unitPriceAmountMinor: 1500,
                    lineAmountMinor: 1500,
                  },
                ],
              }
            : {
                restaurantId: "f2000000-0000-0000-0000-000000000001",
                locationId: "f3000000-0000-0000-0000-000000000001",
                orders: [order],
                nextCursor: null,
              },
        },
      });
    });
    await page.goto("http://127.0.0.1:4321/?board");
    await page.getByLabel("Bestellnummer suchen").fill("BS-00000421");
    await page.getByRole("button", { name: "Suchen", exact: true }).click();
    await page.getByRole("button", { name: "Suche zurücksetzen", exact: true }).waitFor();
    try {
      await page.getByRole("button", { name: /BS-00000421/ }).click({ timeout: 10000 });
    } catch (error) {
      await page.screenshot({
        path: output + `order-number-dashboard-failure-${viewport.width}.png`,
        fullPage: true,
      });
      console.error("Dashboard number failure:", await page.locator("body").innerText(), errors);
      throw error;
    }
    await page.getByRole("heading", { name: "#BS-00000421", exact: true }).waitFor();
    await page.screenshot({
      path: output + `order-number-dashboard-${viewport.width}.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    await verifyOrderLiveBrowser(page, output, viewport.width);
    await verifyLocationOperationsBrowser(page, output, viewport.width);
    await verifyHistoryBrowser(page, output, viewport.width);
    await verifyProvideBrowser(page, output, viewport.width);
    await verifySupportBrowser(page, output, viewport.width);
    await verifyPersonnelBrowser(page, output, viewport.width);
    await verifyViewerBrowser(page, output, viewport.width);
    await verifyRecoveryBrowser(page, output, viewport.width);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Browser ${engine} menu/cart ${viewport.width}px PASS`);
  }
} finally {
  await browser.close();
  await server.close();
}
import { verifyHistoryBrowser } from "./order-history.ts";
import { verifyProvideBrowser } from "./provide-admin.ts";
import { verifyPersonnelBrowser } from "./personnel.ts";
