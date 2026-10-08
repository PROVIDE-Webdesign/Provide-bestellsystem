/** Disposable evidence: actual Chromium -> HTTPS gateway -> HTTPS Worker adapter -> real PG.
 * Local challenge widget/verifier and edge identity are explicit dependency doubles.
 * No external provider, production configuration or deployment is used.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer as httpsServer, request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

const root = fileURLToPath(new URL("../", import.meta.url));
const storefrontRequire = createRequire(join(root, "apps/storefront/package.json"));
const apiRequire = createRequire(join(root, "apps/api/package.json"));
const { createServer: viteServer } = await import(storefrontRequire.resolve("vite"));
const { default: react } = await import(storefrontRequire.resolve("@vitejs/plugin-react"));
const { chromium } = storefrontRequire("playwright");
const { Client } = apiRequire("pg");
const database = process.env.TEST_DATABASE_URL;
if (!database || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(database).hostname))
  throw Error("O3 HTTP evidence requires an explicit disposable loopback database");
const output = join(root, "output/checkout-http-browser");
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "provide-o3-https-"));
const keyPath = join(temporary, "key.pem"),
  certPath = join(temporary, "cert.pem");
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
const tls = { key: await readFile(keyPath), cert: await readFile(certPath) };
const admin = new Client({ connectionString: database });
let vite, api, gateway, browser, activePage;
const report = {
  layer: "actual Chromium / HTTPS gateway / HTTPS API adapter / PostgreSQL",
  challenge: "local widget and verifier double",
  edgeIdentity: "local dependency double; real CF remains open",
  providerCalls: 0,
  externalBrowserRequests: 0,
  cases: [],
  status: "running",
};
const requests = [];
let apiOrigin,
  browserOrigin,
  dropCommittedWrite = false,
  dropIssueReply = true;
let apiCalls = 0;
const clone = (sql) =>
  sql.replace(/\bf([0-9a-f]{7}-)/g, "e$1").replaceAll("storefront-", "o3-http-");
const restaurant = "e2000000-0000-0000-0000-000000000001";
const location = "e3000000-0000-0000-0000-000000000001";
const scope = { restaurantSlug: "o3-http-restaurant-a", locationSlug: "o3-http-a-mitte" };
function webRequest(req, origin) {
  return new Request(origin + req.url, {
    method: req.method,
    headers: req.headers,
    ...(!["GET", "HEAD"].includes(req.method) ? { body: Readable.toWeb(req), duplex: "half" } : {}),
  });
}
async function webResponse(response, res) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}
/** Lose the response body after headers arrived: Chromium may transparently retry a socket
 * closed before any headers. A truncated HTTP body deterministically reaches the client's
 * uncertain-result path while the production transaction is already committed. */
async function loseCommittedResponse(response, res) {
  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(body.length > 1);
  res.writeHead(response.status, {
    ...Object.fromEntries(response.headers),
    "content-length": String(body.length),
  });
  res.flushHeaders();
  res.write(body.subarray(0, 1));
  await new Promise((resolve) => setTimeout(resolve, 10));
  res.destroy();
}
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `https://127.0.0.1:${server.address().port}`;
}
/** TLS trust relaxation is restricted to these generated loopback endpoints, never global. */
function loopbackFetch(input, init = {}) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.ok([apiOrigin, browserOrigin].includes(url.origin));
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.protocol, "https:");
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers)),
        rejectUnauthorized: false,
        signal: init.signal,
      },
      (res) => {
        const chunks = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) req.destroy(Error("Bounded response exceeded"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers }),
          ),
        );
      },
    );
    req.on("error", reject);
    req.end(init.body ?? undefined);
  });
}
async function countEffects(key) {
  const r = await admin.query(
    `select (select count(*)::integer from public.orders where restaurant_id=$1 and submission_key=$2) orders,
    (select count(*)::integer from public.order_payments p join public.orders o on o.id=p.order_id where o.restaurant_id=$1 and o.submission_key=$2) payments,
    (select count(*)::integer from public.ordering_capacity_claims c join public.orders o on o.capacity_claim_id=c.id where o.restaurant_id=$1 and o.submission_key=$2) claims`,
    [restaurant, key],
  );
  assert.deepEqual(r.rows[0], { orders: 1, payments: 1, claims: 1 });
}
try {
  await admin.connect();
  await admin.query(
    clone(await readFile(join(root, "supabase/tests/fixtures/storefront.fixture.inc"), "utf8")),
  );
  await admin.query(
    clone(await readFile(join(root, "supabase/tests/fixtures/delivery.fixture.inc"), "utf8")),
  );
  const policy = await admin.query(
    "select private.create_delivery_policy($1,'aal2',$2,$3,$4::jsonb) id",
    [
      "e1000000-0000-0000-0000-000000000001",
      restaurant,
      location,
      JSON.stringify([{ postalCodes: ["52062"], minimumAmountMinor: 2500, feeAmountMinor: 350 }]),
    ],
  );
  await admin.query("select private.publish_delivery_policy($1,'aal2',$2,$3,$4)", [
    "e1000000-0000-0000-0000-000000000001",
    restaurant,
    location,
    policy.rows[0].id,
  ]);
  // Vite 8's dev client opens a WebSocket even with HMR updates disabled. Attach
  // that development-only transport to the same disposable TLS server instead
  // of an unrelated/plaintext default port; keep all pageerror checks intact.
  gateway = httpsServer(tls);
  vite = await viteServer({
    configFile: false,
    root: join(root, "apps/storefront/tests/browser"),
    plugins: [react()],
    resolve: { alias: { "@": join(root, "apps/dashboard") } },
    server: {
      middlewareMode: true,
      hmr: false,
      ws: { server: gateway, protocol: "wss", host: "127.0.0.1" },
      fs: { allow: [root] },
    },
  });
  const { createApiWorker } = await vite.ssrLoadModule(join(root, "apps/api/src/index.ts"));
  const { handleCheckoutGateway } = await vite.ssrLoadModule(
    join(root, "apps/storefront/app/storefront/protected-gateway.ts"),
  );
  const args = [];
  args[12] = Object.fromEntries(
    ["session", "expire", "refund"].map((name) => [
      name,
      () => {
        report.providerCalls++;
        throw Error("External provider forbidden in isolated evidence");
      },
    ]),
  );
  args[25] = { verify: async (_config, token, issueId) => token === "local-" + issueId };
  const worker = createApiWorker(...args);
  const apiEnv = {
    APP_ENV: "test",
    CHECKOUT_PROTECTION_ENABLED: "true",
    HYPERDRIVE: { connectionString: database },
    HYPERDRIVE_CACHE_DISABLED: "true",
    CHECKOUT_GATEWAY_SECRET: "synthetic-http-o3-gateway-secret-at-least-32",
    CHECKOUT_FINGERPRINT_SECRET: "synthetic-http-o3-fingerprint-secret-at-least-32",
    CHECKOUT_TURNSTILE_SECRET: "synthetic-http-o3-challenge-secret-at-least-32",
    CHECKOUT_WRITE_ENABLED: "true",
    CHECKOUT_PRIVACY_NOTICE_VERSION: "preview-v1",
    CHECKOUT_RETENTION_DAYS: "30",
    ORDER_STATUS_READ_ENABLED: "true",
    ORDER_STATUS_TOKEN_SECRET: "synthetic-http-o3-status-secret-at-least-32",
    CART_QUOTE_ENABLED: "true",
    DELIVERY_ORDERING_ENABLED: "true",
  };
  api = httpsServer(tls, async (req, res) => {
    try {
      apiCalls++;
      assert.ok(
        !req.headers.cookie && !req.headers.authorization && !req.headers["cf-connecting-ip"],
      );
      await webResponse(await worker.fetch(webRequest(req, apiOrigin), apiEnv), res);
    } catch {
      res.writeHead(500);
      res.end("Isolated API adapter failed");
    }
  });
  apiOrigin = await listen(api);
  gateway.on("request", async (req, res) => {
    if (!req.url.startsWith("/api/storefront/")) {
      vite.middlewares(req, res);
      return;
    }
    try {
      const [, , , restaurantSlug, locationSlug, resource] = new URL(
        req.url,
        "https://local.test",
      ).pathname.split("/");
      const web = webRequest(req, browserOrigin);
      const text = req.method === "POST" ? await web.clone().text() : "";
      // Capture only field names/public metadata, never contact values or browser verifier.
      const parsed = text ? JSON.parse(text) : null;
      const observed = {
        resource,
        fields: parsed ? Object.keys(parsed).sort() : [],
        sessionId: parsed?.sessionId,
        issueId: parsed?.issueId,
        submissionKey: parsed?.command?.submissionKey ?? parsed?.submissionKey,
      };
      requests.push(observed);
      const response = await handleCheckoutGateway(
        web,
        { restaurantSlug, locationSlug, resource },
        {
          ...apiEnv,
          PUBLIC_API_URL: apiOrigin,
          CHECKOUT_STOREFRONT_ORIGIN: browserOrigin,
          CHECKOUT_NETWORK_SECRET: "synthetic-http-o3-network-secret-at-least-32",
        },
        loopbackFetch,
        () => "127.0.0.1",
      );
      observed.status = response.status;
      if (dropIssueReply && resource === "checkout-session" && response.status === 201) {
        dropIssueReply = false;
        await loseCommittedResponse(response, res);
        return;
      }
      if (
        dropCommittedWrite &&
        ["orders", "delivery-orders"].includes(resource) &&
        response.status === 201
      ) {
        dropCommittedWrite = false;
        await loseCommittedResponse(response, res);
        return;
      }
      await webResponse(response, res);
    } catch {
      res.writeHead(500);
      res.end("Isolated gateway adapter failed");
    }
  });
  browserOrigin = await listen(gateway);
  apiEnv.CHECKOUT_STOREFRONT_ORIGIN = browserOrigin;
  for (const resource of [
    "orders",
    "delivery-orders",
    "online-orders",
    "cart-quote",
    "delivery-quote",
    "order-status",
    "payment-session",
    "checkout-session",
    "checkout-receipt",
  ])
    assert.equal(
      (
        await loopbackFetch(
          apiOrigin + `/v1/storefront/${scope.restaurantSlug}/${scope.locationSlug}/${resource}`,
          { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
        )
      ).status,
      403,
    );
  const callsBefore = apiCalls;
  for (const origin of [undefined, "null", "https://other.test"]) {
    const blocked = await loopbackFetch(
      browserOrigin + `/api/storefront/${scope.restaurantSlug}/${scope.locationSlug}/cart-quote`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
        body: "{}",
      },
    );
    assert.equal(blocked.status, 403);
  }
  const oversized = await loopbackFetch(
    browserOrigin +
      `/api/storefront/${scope.restaurantSlug}/${scope.locationSlug}/checkout-context`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: browserOrigin,
        "x-provide-checkout-bootstrap": "1",
      },
      body: JSON.stringify({ padding: "x".repeat(1500) }),
    },
  );
  assert.equal(oversized.status, 413);
  assert.equal(
    apiCalls,
    callsBefore,
    "Origin and bounded JSON failures precede the actual API transport",
  );
  report.cases.push({
    id: "O3-T17/T18",
    result: "PASS",
    evidence: "actual HTTPS origin and oversize rejection; no API transport",
  });
  report.cases.push({
    id: "O3-T19",
    result: "PASS",
    evidence: "all nine unsigned direct HTTPS API POST paths denied",
  });
  browser = await chromium.launch({ headless: true });
  let sequence = 0;
  for (const [mode, lost] of [
    ["pickup", true],
    ["delivery", true],
  ]) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: mode === "delivery" ? 390 : 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    await context.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.hostname !== "127.0.0.1") {
        report.externalBrowserRequests++;
        await route.abort();
      } else await route.continue();
    });
    await context.addInitScript(() => {
      Object.assign(window, {
        turnstile: {
          render: (_element, options) => {
            queueMicrotask(() => options.callback("local-" + options.cData));
            return options.cData;
          },
          remove: () => undefined,
        },
      });
    });
    const page = await context.newPage();
    activePage = page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.goto(
      browserOrigin + `/?restaurant=${scope.restaurantSlug}&location=${scope.locationSlug}`,
    );
    const dish = page
      .locator("li.dish")
      .filter({ has: page.getByRole("heading", { name: "Gemüsecurry", exact: true }) });
    await dish.getByRole("button", { name: "Hinzufügen" }).click();
    await page.getByRole("button", { name: "Gemüsecurry einmal mehr" }).click();
    await page.getByRole("heading", { name: "2 Gerichte", exact: true }).waitFor();
    if (mode === "delivery") {
      await page.getByRole("radio", { name: "Lieferung", exact: true }).check();
      await page.getByLabel("Postleitzahl (Deutschland)").fill("52062");
      await page.getByLabel("Straße und Hausnummer").fill("Synthetic Testweg 3");
      await page.getByLabel("Ort", { exact: true }).fill("Aachen");
    }
    const when = new Date(
      Math.floor(Date.now() / 3600000) * 3600000 + 4 * 3600000 + sequence++ * 900000,
    );
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Berlin",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(when)
        .map((p) => [p.type, p.value]),
    );
    await page
      .getByLabel("Datum und Uhrzeit")
      .fill(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`);
    await page.getByRole("button", { name: "Warenkorb und Preise prüfen" }).click();
    await page
      .getByRole("checkbox", {
        name: "Ich bestätige die angezeigten Gerichte, Auswahl und aktuellen Preise.",
      })
      .check();
    await page.getByLabel("Name", { exact: true }).fill("Synthetic HTTP Guest");
    await page.getByLabel("Telefonnummer").fill("+999100000071");
    await page.getByLabel("E-Mail-Adresse").fill("o3-http@example.invalid");
    await page.getByRole("checkbox", { name: /Datenschutzhinweis/ }).check();
    await page.getByRole("button", { name: "Sicherheitsprüfung starten" }).focus();
    await page.keyboard.press("Enter");
    if (mode === "pickup") {
      await page
        .getByText(
          /Die Sicherheitsprüfung konnte gerade nicht abgeschlossen werden|Der Bestellversuch konnte gerade nicht geprüft werden/,
        )
        .waitFor();
      assert.equal(dropIssueReply, false, "The session response was lost after an actual commit");
      const pending = requests.filter((r) => r.resource === "checkout-session").at(-1);
      await page.getByRole("button", { name: "Sicherheitsprüfung starten", exact: true }).click();
      await page
        .getByText(
          "Bestellversuch vorbereitet. Du kannst die Bestellung jetzt ausdrücklich absenden.",
          { exact: true },
        )
        .waitFor();
      const replay = requests.filter((r) => r.resource === "checkout-session").at(-1);
      assert.equal(replay.issueId, pending.issueId);
      assert.equal(replay.submissionKey, pending.submissionKey);
      const sessions = await admin.query(
        "select count(*)::integer n from private.checkout_sessions where restaurant_id=$1 and submission_key=$2",
        [restaurant, replay.submissionKey],
      );
      assert.equal(sessions.rows[0].n, 1);
      report.cases.push({
        id: "O3-T35",
        result: "PASS",
        evidence:
          "actual HTTPS issue reply destroyed after session commit; explicit same-UUID/key retry; exactly one PG intent",
      });
    }
    await page
      .getByText(
        "Bestellversuch vorbereitet. Du kannst die Bestellung jetzt ausdrücklich absenden.",
        { exact: true },
      )
      .waitFor();
    const cookie = (await context.cookies()).find((c) => c.name === "__Host-provide-checkout");
    assert.ok(
      cookie?.secure && cookie.httpOnly && cookie.sameSite === "Lax" && cookie.path === "/",
    );
    assert.ok(!(await page.evaluate(() => document.cookie)).includes("__Host-provide-checkout"));
    const publicMetadata = await page.evaluate(
      () =>
        Object.entries(sessionStorage).find(([key]) =>
          key.startsWith("provide-checkout-intent:"),
        )?.[1],
    );
    const intent = JSON.parse(publicMetadata).intent;
    assert.deepEqual(Object.keys(intent).sort(), [
      "receiptExpiresAt",
      "sessionId",
      "submissionKey",
      "writeExpiresAt",
    ]);
    assert.ok(
      !/Synthetic HTTP Guest|o3-http@example.invalid|Testweg|csrf|verifier/.test(publicMetadata),
    );
    if (mode === "pickup") {
      const second = await context.newPage();
      await second.goto(browserOrigin + "/");
      const modulePath = "/@fs/" + join(root, "apps/storefront/app/storefront/checkout-client.ts");
      const otherBase = "/api/storefront/o3-http-restaurant-b/o3-http-b-mitte";
      const other = await second.evaluate(
        async ({ modulePath, otherBase }) => {
          const { CheckoutClient } = await import(modulePath);
          const client = new CheckoutClient(otherBase, fetch, sessionStorage);
          const issueId = crypto.randomUUID();
          const intent = await client.issue("local-" + issueId, issueId);
          return { intent, publicMetadata: sessionStorage.getItem(client.storageKey) };
        },
        { modulePath, otherBase },
      );
      assert.notEqual(other.intent.sessionId, intent.sessionId);
      assert.notEqual(other.intent.submissionKey, intent.submissionKey);
      const sameContext = await admin.query(
        "select count(distinct verifier_hash)::integer contexts,count(*)::integer sessions from private.checkout_sessions where id=any($1::uuid[])",
        [[intent.sessionId, other.intent.sessionId]],
      );
      assert.deepEqual(sameContext.rows[0], { contexts: 1, sessions: 2 });
      assert.equal(
        await page.evaluate(
          () =>
            Object.entries(sessionStorage).find(([key]) =>
              key.startsWith("provide-checkout-intent:"),
            )?.[1],
        ),
        publicMetadata,
      );
      assert.ok(other.publicMetadata.includes(otherBase));
      const foreign = await second.evaluate(
        async ({ modulePath, otherBase, intent }) => {
          const { CheckoutClient } = await import(modulePath);
          const client = new CheckoutClient(otherBase, fetch, sessionStorage);
          const response = await client.request("checkout-receipt", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sessionId: intent.sessionId,
              submissionKey: intent.submissionKey,
            }),
          });
          return response.status;
        },
        { modulePath, otherBase, intent },
      );
      assert.equal(foreign, 410, "A foreign scope is denied without exposing the other intent");
      assert.equal(
        requests.filter((r) => ["orders", "delivery-orders", "online-orders"].includes(r.resource))
          .length,
        0,
      );
      report.cases.push({
        id: "O3-T42",
        result: "PASS",
        evidence:
          "two actual HTTPS browser tabs share one HttpOnly context, maintain distinct scoped public intents and deny cross-scope receipt; zero orders",
      });
      await second.close();
    }
    await page.screenshot({ path: join(output, `${mode}-prepared.png`), fullPage: true });
    const beforeWrites = requests.filter((r) =>
      ["orders", "delivery-orders"].includes(r.resource),
    ).length;
    dropCommittedWrite = lost;
    await page
      .getByRole("button", {
        name: mode === "pickup" ? "Abholbestellung absenden" : "Lieferbestellung absenden",
        exact: true,
      })
      .click();
    if (lost) {
      await page
        .getByText(
          "Das Ergebnis ist unklar. Prüfe zuerst diesen Bestellversuch. Es wird keine neue Bestellung automatisch gesendet.",
          { exact: true },
        )
        .waitFor();
      await countEffects(intent.submissionKey);
      assert.equal(
        await page
          .getByRole("button", {
            name: mode === "pickup" ? "Abholbestellung absenden" : "Lieferbestellung absenden",
            exact: true,
          })
          .isDisabled(),
        true,
      );
      await page.screenshot({ path: join(output, `${mode}-response-lost.png`), fullPage: true });
      await page.reload();
    }
    await page.getByText(/Bestellnummer: BS-/).waitFor();
    await countEffects(intent.submissionKey);
    assert.equal(
      requests.filter((r) => ["orders", "delivery-orders"].includes(r.resource)).length,
      beforeWrites + 1,
    );
    if (lost) {
      assert.ok(
        requests.some(
          (r) =>
            r.resource === "checkout-receipt" &&
            r.sessionId === intent.sessionId &&
            JSON.stringify(r.fields) === '["sessionId","submissionKey"]',
        ),
      );
      assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "");
      assert.equal(await page.getByLabel("E-Mail-Adresse").inputValue(), "");
      report.cases.push({
        id: "O3-T40",
        result: "PASS",
        evidence:
          "HTTP response destroyed after real commit; reload receipt; one order and one browser write; no contact resend",
      });
    }
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    await page.screenshot({ path: join(output, `${mode}-confirmed.png`), fullPage: true });
    const beforeStatus = requests.length;
    await context.clearCookies();
    await page.getByRole("button", { name: "Status aktualisieren", exact: true }).click();
    await page.getByRole("button", { name: "Status aktualisieren", exact: true }).waitFor();
    const statusRefresh = requests.slice(beforeStatus);
    assert.ok(statusRefresh.some((r) => r.resource === "order-status" && r.status === 410));
    assert.ok(statusRefresh.some((r) => r.resource === "checkout-context" && r.status === 200));
    assert.ok(statusRefresh.some((r) => r.resource === "order-status" && r.status === 200));
    assert.ok(
      !statusRefresh.some((r) =>
        ["checkout-session", "orders", "delivery-orders", "online-orders"].includes(r.resource),
      ),
    );
    await countEffects(intent.submissionKey);
    report.cases.push({
      id: "O3-T46",
      mode,
      result: "PASS",
      evidence:
        "actual HTTPS status refresh after deleting checkout cookie; renewed CSRF context only, unchanged own capability, no issue/order/provider",
    });
    report.cases.push({
      id: "O3-T39",
      mode,
      result: "PASS",
      evidence: "actual HTTPS / Secure HttpOnly host cookie / signed API / real PG",
    });
    await context.close();
  }
  assert.equal(report.providerCalls, 0);
  assert.equal(report.externalBrowserRequests, 0);
  report.status = "PASS";
  console.log(
    "O3 integrated HTTPS browser/PG evidence PASS; local challenge/edge doubles; external provider calls=0",
  );
} catch (error) {
  report.status = "FAIL";
  report.error = error instanceof Error ? error.message : "Isolated evidence failed";
  report.transport = requests;
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: join(output, "failure.png"), fullPage: true });
    report.visibleStatus = await activePage.getByRole("status").allTextContents();
  }
  throw error;
} finally {
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser?.close();
  await vite?.close();
  for (const server of [gateway, api])
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  await admin.end();
  await rm(temporary, { recursive: true, force: true });
}
