/** Real React/CSS and local assets; fixture API only, no hosted operations. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const require = createRequire(new URL("apps/storefront/package.json", root));
const { createServer } = await import(require.resolve("vite"));
const { default: react } = await import(require.resolve("@vitejs/plugin-react"));
const engines = require("playwright");
const engine = process.env.BROWSER_ENGINE ?? "chromium";
assert.ok(["chromium", "firefox", "webkit"].includes(engine));
const output = fileURLToPath(new URL(`output/selected-views/${engine}/`, root));
await mkdir(output, { recursive: true });
const report = { engine, cases: [], errors: [], status: "RUNNING" };
const servers = [];
let browser;
async function fit(page, locator) {
  const box = await locator.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, "Control must be visible");
  assert.ok(
    box.x >= -1 && box.x + box.width <= page.viewportSize().width + 1,
    "Control fits width",
  );
}
try {
  const origins = {};
  for (const app of ["dashboard", "storefront"]) {
    const appRoot = new URL(`apps/${app}/`, root);
    const server = await createServer({
      configFile: false,
      root: fileURLToPath(new URL("design-preview/", appRoot)),
      publicDir: fileURLToPath(new URL("public/", appRoot)),
      cacheDir: fileURLToPath(new URL(`output/vite-cache/selected-${app}-${engine}/`, root)),
      plugins: [react()],
      resolve: {
        alias: {
          "@provide/contracts": fileURLToPath(new URL("packages/contracts/src/index.ts", root)),
        },
      },
      server: { host: "127.0.0.1", port: 0, fs: { allow: [fileURLToPath(root)] } },
    });
    await server.listen();
    servers.push(server);
    origins[app] = `http://127.0.0.1:${server.httpServer.address().port}`;
  }
  browser = await engines[engine].launch({ headless: true });
  report.browserVersion = browser.version();
  for (const width of [320, 390, 640, 768, 1024, 1280, 1600]) {
    for (const view of ["orders", "menu", "settings"]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 640 ? 450 : 1000 },
        timezoneId: "Europe/Berlin",
        locale: "de-DE",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on("pageerror", (error) => report.errors.push(`${width}/${view}: ${error.message}`));
      await context.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
      );
      try {
        await page.goto(`${origins.dashboard}/?view=${view}`);
        await page.locator(".operator-shop-state").waitFor();
        await page
          .getByRole("heading", {
            name:
              view === "menu"
                ? "Speisekarte"
                : view === "settings"
                  ? "Einstellungen"
                  : "Bestellungen",
            exact: true,
          })
          .waitFor();
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        );
        await fit(page, page.getByLabel("Restaurant wählen"));
        await fit(page, page.locator(".operator-shop-state"));
        const nav = page.getByRole("navigation", { name: "Restaurantverwaltung" });
        assert.equal(
          await nav.getByRole("button", { name: "Verlauf", exact: true }).count(),
          view === "orders" ? 1 : 0,
        );
        if (view !== "orders") {
          const bounds = await nav.boundingBox();
          assert.ok(
            bounds.height < 180,
            "S1/E1 navigation must not become a viewport-sized spacer",
          );
          assert.equal(await nav.getByRole("button").count(), 3);
        }
        if (view === "menu") {
          await page.locator(".menu-item-row").nth(3).waitFor();
          const asset = await page.request.get(`${origins.dashboard}/operator-menu/dishes.png`);
          assert.match(asset.headers()["content-type"], /image\/png/);
          const search = page.getByLabel("Gericht suchen");
          await search.fill("Chicken");
          assert.equal(await page.locator(".menu-item-row").count(), 1);
          await search.fill("Unbekanntes Beispielgericht");
          assert.equal(await page.locator(".menu-item-row").count(), 0);
          await search.fill("");
          assert.equal(await page.locator(".menu-item-row").count(), 4);
          await page.getByRole("button", { name: "Sushi", exact: true }).click();
          assert.equal(await page.locator(".menu-item-row").count(), 1);
          await page.getByRole("button", { name: "Alle", exact: true }).click();
        } else if (view === "settings") {
          await page.locator(".settings-topic").nth(5).waitFor();
          assert.equal(await page.locator(".settings-topic").count(), 6);
          await page.getByRole("button", { name: /Mein Zugang/ }).click();
          await page.getByRole("button", { name: /Zur Übersicht/ }).click();
          assert.equal(await page.locator(".settings-topic").count(), 6);
        } else {
          const alarm = page.locator(".operator-alarm-menu > summary");
          assert.equal(await alarm.innerText(), "Bestelleingang & Alarm");
          await fit(page, alarm);
          await alarm.focus();
          await page.keyboard.press("Enter");
          await page.locator(".operator-alarm-menu[open]").waitFor();
          await fit(page, page.locator(".operator-alarm-menu .order-inbox"));
          await alarm.press("Enter");
          await page.locator(".operator-detail-heading h2").waitFor();
          await page.getByRole("button", { name: "Ablehnen", exact: true }).click();
          const dialog = page.locator("dialog[open]");
          await dialog.waitFor();
          await fit(page, dialog);
          await page.keyboard.press("Tab");
          assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("dialog[open]").count(), 0);
        }
        if ([390, 1024, 1280].includes(width)) {
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: `${output}${view}-${width}.png`, fullPage: true });
        }
        report.cases.push({ view, width, result: "PASS", reflow200: width === 640 });
      } catch (error) {
        report.failedCase = { view, width };
        report.failedLayout = await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              ".operator-header, .operator-header-actions, .operator-operations, .operator-shop-state",
            ),
          ].map((el) => ({
            className: el.className,
            text: el.textContent,
            display: getComputedStyle(el).display,
            box: el.getBoundingClientRect().toJSON(),
          })),
        );
        await page.screenshot({ path: `${output}failure-${view}-${width}.png`, fullPage: true });
        throw error;
      } finally {
        await context.close();
      }
    }
  }
  for (const width of [320, 390, 640, 814, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 640 ? 450 : 1437 },
      locale: "de-DE",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => report.errors.push(`shop/${width}: ${error.message}`));
    await context.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
    );
    try {
      await page.goto(origins.storefront);
      await page.locator(".shop-dish").nth(2).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (width === 320) await fit(page, page.getByRole("button", { name: "Wok", exact: true }));
      await page.locator(".shop-favorites .shop-plus").nth(0).click();
      await page.locator(".shop-favorites .shop-plus").nth(1).click();
      assert.match(await page.locator(".basket-button").innerText(), /2 Artikel/);
      assert.match(await page.locator(".basket-button").innerText(), /26,80/);
      const details = page.locator(".shop-dish .dish-photo-button").first();
      await details.click();
      const dialog = page.locator("dialog[open]");
      await dialog.waitFor();
      await fit(page, dialog);
      await page.keyboard.press("Tab");
      assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("dialog[open]").count(), 0);
      const favorite = page.locator(".shop-favorites .heart-button").first();
      await favorite.click();
      await page.reload();
      await page.locator(".shop-favorites li").waitFor();
      assert.equal(await page.locator(".shop-favorites li").count(), 1);
      await page.getByRole("button", { name: "Meine Bestellungen", exact: true }).click();
      await page.getByRole("button", { name: "Speisekarte", exact: true }).click();
      await page.locator(".shop-dish").first().waitFor();
      if ([390, 814].includes(width))
        await page.screenshot({ path: `${output}shop-${width}.png`, fullPage: true });
      report.cases.push({ view: "shop", width, result: "PASS", reflow200: width === 640 });
    } catch (error) {
      report.failedCase = { view: "shop", width };
      await page.screenshot({ path: `${output}failure-shop-${width}.png`, fullPage: true });
      throw error;
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const server of servers) await server.close();
  await writeFile(`${output}report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
