import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { it } from "vitest";
import { createApiWorker } from "../apps/api/src/index.ts";
import { handleCheckoutGateway } from "../apps/storefront/app/storefront/protected-gateway.ts";
import { handleHandoffGateway } from "../apps/storefront/app/storefront/handoff-gateway.ts";
import website from "../apps/website-cart-demo/worker.mjs";

const storefrontRequire = createRequire(resolve("apps/storefront/package.json"));
const { createServer } = await import(storefrontRequire.resolve("vite"));
const { default: react } = await import(storefrontRequire.resolve("@vitejs/plugin-react"));
const { chromium, devices } = storefrontRequire("playwright");
const { checkoutDigest, parseCartQuote, parsePublicCatalog } = await import(
  storefrontRequire.resolve("@provide/contracts")
);
const { Client } = createRequire(resolve("apps/api/package.json"))("pg");
const root = process.cwd();
const shop = "https://provide-bs-storefront-preview.alpaysey.workers.dev";
const gatewaySecret = "synthetic-local-handoff-gateway-key-for-tests-only";
const serverEnv = {
  APP_ENV: "test",
  CART_QUOTE_ENABLED: "true",
  CHECKOUT_PROTECTION_ENABLED: "true",
  CHECKOUT_FINGERPRINT_SECRET: "synthetic-local-handoff-fingerprint-key-for-tests-only",
  ORDER_STATUS_TOKEN_SECRET: "synthetic-local-handoff-status-key-for-tests-only",
  CHECKOUT_STOREFRONT_ORIGIN: shop,
  CHECKOUT_GATEWAY_SECRET: gatewaySecret,
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: process.env.BS16_TEST_DB },
};
const gatewayEnv = {
  APP_ENV: "test",
  CHECKOUT_PROTECTION_ENABLED: "true",
  CHECKOUT_STOREFRONT_ORIGIN: shop,
  PUBLIC_API_URL: "https://api.example.test",
  CHECKOUT_GATEWAY_SECRET: gatewaySecret,
  CHECKOUT_NETWORK_SECRET: "synthetic-local-handoff-network-key-for-tests-only",
};
const restaurants = [
  {
    id: "pilot-website-a",
    slug: "storefront-restaurant-a",
    location: "storefront-a-mitte",
    title: "PROVIDE Testküche",
    locationName: "Teststandort Mitte",
    item: "Gemüsecurry",
    other: "Duftreis",
    restaurantId: 1,
    menuId: 1,
    ownerId: 1,
    unit: 1500,
    quantity: 2,
  },
  {
    id: "pilot-website-b",
    slug: "test-marktgarten",
    location: "test-marktgarten-mitte",
    title: "Test Marktgarten",
    locationName: "Marktgarten Mitte",
    item: "Ofengemüse",
    other: "Apfelschorle",
    restaurantId: 2,
    menuId: 101,
    ownerId: 5,
    unit: 1230,
    quantity: 3,
  },
];
for (const [i, r] of restaurants.entries()) {
  r.origin = `https://restaurant-${i + 1}.example.test`;
  r.shopPath = `/r/${r.slug}/${r.location}`;
}
const uuid = (kind, n) => `f${kind}000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const money = (n) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n / 100);

async function seed(admin) {
  const existing = Number(
    (await admin.query("select count(*) as n from private.cart_handoff_integrations")).rows[0].n,
  );
  if (existing === 2) {
    await admin.query(
      "delete from private.cart_handoff_drafts; delete from private.cart_handoff_budget",
    );
    await admin.query(
      "update private.cart_handoff_integrations set expires_at=now()+interval '30 minutes'",
    );
    return;
  }
  assert.equal(existing, 0);
  const raw = await readFile(resolve("supabase/tests/fixtures/storefront.fixture.inc"), "utf8");
  const start = raw.search(/insert into\s+public\.restaurant_feature_flags/i);
  const end = raw.indexOf("/*", start);
  assert.ok(start >= 0 && end > start, "fixture needs its public catalog and schedule block");
  const fixtureB = raw
    .slice(start, end)
    .replaceAll(uuid(2, 1), uuid(2, 2))
    .replaceAll(uuid(3, 1), uuid(3, 2))
    .replaceAll(uuid(1, 1), uuid(1, 5))
    .replace(/f([4-9])000000-0000-0000-0000-(\d{12})/g, (_m, kind, id) =>
      uuid(kind, Number(id) + 100),
    )
    .replaceAll("Gemüsecurry", "Ofengemüse")
    .replaceAll("Duftreis", "Apfelschorle")
    .replace(/\b1250\b/g, "980")
    .replace(/\b300\b/g, "390");
  await admin.query(
    raw
      .replaceAll("storefront-restaurant-b", "test-marktgarten")
      .replaceAll("storefront-b-mitte", "test-marktgarten-mitte")
      .replaceAll("Andere Testküche", "Test Marktgarten")
      .replaceAll("Anderer Teststandort", "Marktgarten Mitte"),
  );
  await admin.query(fixtureB);
  const configuration = JSON.parse(
    await readFile(resolve("fixtures/menu-configuration.json"), "utf8"),
  );
  for (const r of restaurants) {
    const menu = uuid(4, r.menuId);
    const version = (
      await admin.query("select private.create_menu_draft($1,$2,$3,$4,'aal2') as id", [
        uuid(2, r.restaurantId),
        menu,
        uuid(5, r.menuId),
        uuid(1, r.ownerId),
      ])
    ).rows[0].id;
    await admin.query("select private.set_menu_item_configuration($1,$2,$3,$4,$5,'aal2',0,$6)", [
      uuid(2, r.restaurantId),
      menu,
      version,
      uuid(6, r.menuId),
      uuid(1, r.ownerId),
      configuration,
    ]);
    await admin.query(
      "select private.publish_menu_version($1,$2,$3,$4,statement_timestamp(),$5,'aal2')",
      [uuid(2, r.restaurantId), uuid(3, r.restaurantId), menu, version, uuid(1, r.ownerId)],
    );
    await admin.query(
      "insert into private.cart_handoff_integrations (id,restaurant_slug,location_slug,source_origin,enabled,expires_at) values ($1,$2,$3,$4,true,now()+interval '30 minutes')",
      [r.id, r.slug, r.location, r.origin],
    );
  }
}

function requestOf(req, headers, url = req.url()) {
  return new Request(url, {
    method: req.method(),
    headers,
    body: req.postDataBuffer() ?? undefined,
  });
}
async function responseTo(route, response) {
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: Buffer.from(await response.arrayBuffer()),
  });
}
const importPanel = (page) => page.getByRole("region", { name: "Warenkorb übernehmen" });
const storageOff = process.env.BS16_STORAGE_ONLY === "1";

it("runs the website and shop in Chromium against the real handoff and PostgreSQL quote paths", async () => {
  assert.equal(
    serverEnv.HYPERDRIVE.connectionString && new URL(serverEnv.HYPERDRIVE.connectionString).host,
    "127.0.0.1:26322",
  );
  const admin = new Client({ connectionString: serverEnv.HYPERDRIVE.connectionString });
  await admin.connect();
  const server = await createServer({
    configFile: false,
    cacheDir: resolve("output/vite-cache/handoff"),
    root: resolve("apps/storefront/tests/browser"),
    plugins: [react()],
    resolve: { alias: { "@": resolve("apps/dashboard") } },
    server: { host: "127.0.0.1", port: 26330, strictPort: true, hmr: false, fs: { allow: [root] } },
  });
  await server.listen();
  const browser = await chromium.launch();
  const evidence = [];
  const worker = createApiWorker();
  const work = (url, init) => worker.fetch(new Request(url, init), serverEnv);
  const deny = [];
  let lastCreated;
  try {
    await admin.query("begin");
    try {
      await seed(admin);
      await admin.query("commit");
    } catch (error) {
      await admin.query("rollback");
      throw error;
    }
    const bases = await Promise.all(
      restaurants.map(async (r) => {
        const request = new Request(shop + "/api/cart-handoff/" + r.id, {
          headers: { origin: r.origin },
        });
        const response = await handleHandoffGateway(
          request,
          r.id,
          gatewayEnv,
          work,
          () => "192.0.2.25",
        );
        assert.equal(response.status, 200, `catalog ${r.slug}`);
        const catalog = parsePublicCatalog((await response.json()).data.catalog);
        assert.equal(catalog.restaurant.slug, r.slug);
        assert.equal(catalog.location.slug, r.location);
        const menu = catalog.menus[0];
        const item = menu.sections[0].items[0];
        assert.equal(item.name, r.item);
        return { ...r, catalog, menu, item };
      }),
    );

    async function contextFor(profile, storageDenied = false) {
      const context = await browser.newContext(profile);
      context.setDefaultTimeout(7000);
      await context.addInitScript((disableStorage) => {
        const path = location.pathname.match(/^\/r\/([^/]+)\/([^/]+)$/);
        if (path) {
          const search = new URLSearchParams({ restaurant: path[1], location: path[2] });
          history.replaceState(null, "", location.pathname + "?" + search + location.hash);
          if (disableStorage)
            Object.defineProperty(window, "sessionStorage", {
              get() {
                throw new DOMException("Storage disabled", "SecurityError");
              },
            });
        }
      }, storageDenied);
      await context.route("**/*", async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const headers = await req.allHeaders();
        const source = bases.find((r) => url.origin === r.origin);
        if (source)
          return responseTo(
            route,
            await website.fetch(requestOf(req, headers), {
              INTEGRATION_ID: source.id,
              RESTAURANT_NAME: source.title,
            }),
          );
        if (url.origin !== shop) return route.abort();
        if (url.pathname.startsWith("/api/cart-handoff/")) {
          if (req.method() === "POST") headers.origin ??= shop;
          const response = await handleHandoffGateway(
            requestOf(req, headers),
            url.pathname.split("/").at(-1),
            gatewayEnv,
            work,
            () => "192.0.2.25",
          );
          const action = req.method() === "POST" ? req.postDataJSON().action : req.method();
          if (action === "create" && response.ok)
            lastCreated = (await response.clone().json()).data.url;
          if (action === "redeem")
            evidence.push({
              action,
              status: response.status,
              body: req.postDataJSON().restaurantSlug,
            });
          return responseTo(route, response);
        }
        if (url.pathname.startsWith("/api/storefront/")) {
          const resource = url.pathname.split("/").at(-1);
          if (!["catalog", "availability", "cart-quote", "checkout-context"].includes(resource)) {
            deny.push(resource);
            return route.abort();
          }
          const [, , , restaurantSlug, locationSlug] = url.pathname.split("/");
          if (req.method() === "POST") headers.origin ??= shop;
          const response = await handleCheckoutGateway(
            requestOf(req, headers),
            { restaurantSlug, locationSlug, resource },
            gatewayEnv,
            work,
            () => "192.0.2.26",
          );
          if (!response.ok)
            console.info(
              "checkout transport",
              resource,
              response.status,
              (await response.clone().json()).error?.code,
            );
          if (resource === "cart-quote") {
            const quote = parseCartQuote((await response.clone().json()).data);
            evidence.push({ action: "quote", scope: url.pathname, status: response.status, quote });
          }
          return responseTo(route, response);
        }
        const path = url.pathname.startsWith("/r/") ? "/" : url.pathname;
        return responseTo(route, await fetch("http://127.0.0.1:26330" + path + url.search));
      });
      return context;
    }

    async function websiteLink(page, r, quantity = r.quantity) {
      await page.goto(r.origin);
      const card = page
        .locator("article")
        .filter({ has: page.getByRole("heading", { name: r.item.name, exact: true }) });
      await card.getByRole("combobox").selectOption(r.item.configuration.variants[1].id);
      await card.getByLabel(/Extra B/).check();
      await card.getByRole("spinbutton").fill(String(quantity));
      await card.getByRole("button", { name: "Hinzufügen" }).click();
      await page.getByText(new RegExp(`${r.item.name} × ${quantity}`)).waitFor();
      const created = page.waitForResponse(
        (res) => res.request().method() === "POST" && res.url().endsWith("/" + r.id),
      );
      await page.getByRole("button", { name: "Zum Bestellen" }).click();
      const response = await created;
      assert.equal(response.status(), 200);
      const url = lastCreated;
      assert.equal(new URL(url).pathname, r.shopPath);
      await page.waitForURL((target) => target.origin === shop && target.pathname === r.shopPath);
      return url;
    }
    async function verifyQuote(page, r, profileName, quantity = r.quantity) {
      await page.getByRole("button", { name: /^Warenkorb ·/ }).click();
      await page.getByRole("heading", { name: r.title, exact: true }).waitFor();
      await page.locator(".shop-address").getByText(r.locationName, { exact: false }).waitFor();
      const when = new Date(Math.ceil((Date.now() + 2 * 3600_000) / 900_000) * 900_000);
      const local = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Berlin",
        dateStyle: "short",
        timeStyle: "short",
      })
        .format(when)
        .replace(" ", "T");
      await page.locator('input[type="datetime-local"]').fill(local);
      await page.getByRole("button", { name: "Warenkorb und Preise prüfen" }).click();
      const confirm = page.getByRole("checkbox", { name: /bestätige die angezeigten Gerichte/ });
      try {
        await confirm.check();
      } catch (error) {
        console.info(
          "quote diagnostics",
          JSON.stringify(evidence.filter((e) => e.action === "quote").at(-1)),
          (await page.locator("main").innerText()).slice(-1700),
        );
        throw error;
      }
      assert.equal(await confirm.isChecked(), true);
      const observed = evidence.filter((e) => e.action === "quote").at(-1);
      assert.ok(observed.scope.includes(`/${r.slug}/${r.location}/`));
      assert.equal(observed.status, 200);
      assert.equal(observed.quote.subtotalAmountMinor, r.unit * quantity);
      assert.equal(observed.quote.itemCount, quantity);
      const [line] = observed.quote.lines;
      assert.equal(line.menuItemId, r.item.id);
      assert.equal(line.name, r.item.name);
      assert.equal(line.quantity, quantity);
      assert.equal(line.unitPriceAmountMinor, r.unit);
      assert.equal(line.selectionSnapshot.variant.name, "Large");
      assert.deepEqual(
        line.selectionSnapshot.options.map((x) => x.name),
        ["Extra B"],
      );
      await page
        .getByText(money(r.unit * quantity), { exact: true })
        .first()
        .waitFor();
      evidence.push({
        action: "confirmed",
        profile: profileName,
        restaurant: r.slug,
        location: r.location,
      });
    }
    async function assertImport(page, message) {
      await importPanel(page).getByText(message).waitFor({ timeout: 6000 });
    }

    if (storageOff) {
      const context = await contextFor({ viewport: { width: 1440, height: 1000 } }, true);
      const page = await context.newPage();
      await websiteLink(page, bases[0]);
      await page.getByRole("button", { name: "Auswahl übernehmen" }).click({ timeout: 6000 });
      await assertImport(page, /Warenkorb übernommen/);
      assert.equal(new URL(page.url()).hash, "");
      await verifyQuote(page, bases[0], "desktop-session-storage-disabled");
      await context.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
    } else {
      for (const [profileName, profile] of [
        ["desktop-chromium", { viewport: { width: 1440, height: 1000 } }],
        ["mobile-simulation", devices["iPhone 13"]],
      ]) {
        for (const r of bases) {
          const context = await contextFor(profile);
          try {
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await websiteLink(page, r);
            const accept = page.getByRole("button", { name: "Auswahl übernehmen" });
            await accept.waitFor();
            assert.equal(new URL(page.url()).hash, "");
            await page.reload();
            await accept.click();
            await assertImport(page, /Warenkorb übernommen/);
            assert.equal(new URL(page.url()).hash, "");
            await verifyQuote(page, r, profileName);
            await websiteLink(page, r, r.quantity + 1);
            await page.getByRole("button", { name: "Bisherigen Warenkorb behalten" }).click();
            await assertImport(page, /bisheriger Warenkorb bleibt erhalten/);
            await verifyQuote(page, r, profileName + "-kept");
            const websitePage = await context.newPage();
            const expiring = await websiteLink(websitePage, r);
            const hash = await checkoutDigest(new URL(expiring).hash.split(".").at(-1));
            await admin.query(
              "update private.cart_handoff_drafts set created_at=now()-interval '11 minutes', expires_at=now()-interval '1 minute' where token_hash=$1",
              [hash],
            );
            await websitePage
              .getByRole("button", { name: "Vorhandenen Warenkorb ersetzen" })
              .click();
            await assertImport(websitePage, /abgelaufen/);
            assert.equal(evidence.at(-1).status, 410);
            await verifyQuote(websitePage, r, profileName + "-expired-cart-preserved");
            const wrong = new URL(await websiteLink(websitePage, r));
            const other = bases.find((x) => x !== r);
            wrong.pathname = other.shopPath;
            const wrongPage = await context.newPage();
            await wrongPage.goto(wrong.href);
            await wrongPage.getByRole("button", { name: "Auswahl übernehmen" }).click();
            await assertImport(wrongPage, /Übernahme ist gerade nicht möglich/);
            assert.equal(evidence.at(-1).status, 403);
            await wrongPage.close();
            await websitePage.close();
            await websiteLink(page, r, r.quantity + 1);
            await page.getByRole("button", { name: "Vorhandenen Warenkorb ersetzen" }).click();
            await assertImport(page, /Warenkorb übernommen/);
            await verifyQuote(page, r, profileName + "-replaced", r.quantity + 1);
            assert.deepEqual(errors, []);
          } finally {
            await context.unrouteAll({ behavior: "ignoreErrors" });
            await context.close();
          }
        }
      }
    }
    assert.deepEqual(deny, [], "pre-confirmation flows must not request order or payment");
    for (const table of ["orders", "online_payment_jobs"]) {
      assert.equal(
        Number((await admin.query(`select count(*) as n from public.${table}`)).rows[0].n),
        0,
      );
    }
    await mkdir(resolve("output/cart-handoff"), { recursive: true });
    await writeFile(
      resolve("output/cart-handoff/" + (storageOff ? "storage" : "browser") + "-evidence.json"),
      JSON.stringify(evidence, null, 2),
    );
  } finally {
    await browser.close();
    await server.close();
    await admin.end();
  }
}, 120000);
