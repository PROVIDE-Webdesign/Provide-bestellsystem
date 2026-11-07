import assert from "node:assert/strict";
import { chromium, webkit } from "../apps/storefront/node_modules/playwright/index.mjs";
const fixtureUrl = process.env.PUSH_BROWSER_TEST_URL ?? "http://127.0.0.1:4197";
const publicKey = "B" + "A".repeat(86);
for (const [name, type] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await type.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1",
  });
  const active = new Set(["A"]);
  let fail = false,
    statusCalls = 0,
    subscribeCalls = 0,
    removeCalls = 0,
    delay = 0;
  await context.addInitScript(
    ({ publicKey }) => {
      Object.defineProperty(navigator, "standalone", { value: true });
      window.__orderTonePlays = 0;
      class TestAudioContext {
        state = "suspended";
        currentTime = 0;
        destination = {};
        async resume() {
          this.state = "running";
        }
        async close() {
          this.state = "closed";
        }
        createOscillator() {
          return {
            frequency: {},
            connect() {},
            disconnect() {},
            start() {
              window.__orderTonePlays++;
            },
            stop() {
              queueMicrotask(() => this.onended?.());
            },
          };
        }
        createGain() {
          return {
            gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
            connect() {},
            disconnect() {},
          };
        }
      }
      Object.defineProperty(window, "AudioContext", {
        value: TestAudioContext,
        configurable: true,
      });
      Object.defineProperty(window, "Notification", {
        value: { permission: "granted" },
        configurable: true,
      });
      Object.defineProperty(window, "PushManager", { value: function () {}, configurable: true });
      if (localStorage.getItem("subscription") === null)
        localStorage.setItem("subscription", "yes");
      const sub = {
        endpoint: "https://web.push.apple.com/fake-test-endpoint",
        options: {
          applicationServerKey: Uint8Array.from(
            atob(publicKey.replaceAll("-", "+").replaceAll("_", "/")),
            (c) => c.charCodeAt(0),
          ).buffer,
        },
        toJSON: () => ({ keys: { p256dh: publicKey, auth: "A".repeat(22) } }),
        unsubscribe: async () => {
          localStorage.setItem("subscription", "no");
          return true;
        },
      };
      const registration = {
        active: { scriptURL: location.origin + "/dashboard-push-sw.js" },
        update: async () => {},
        pushManager: {
          getSubscription: async () =>
            localStorage.getItem("subscription") === "yes" ? sub : null,
          subscribe: () => {
            localStorage.setItem("subscription", "yes");
            return Promise.resolve(sub);
          },
        },
      };
      Object.defineProperty(navigator, "serviceWorker", {
        value: {
          getRegistration: async () => registration,
          register: async () => registration,
          ready: Promise.resolve(registration),
        },
        configurable: true,
      });
    },
    { publicKey },
  );
  await context.route("**/api/order-push?*", async (route) => {
    const req = route.request(),
      body = req.postDataJSON(),
      url = new URL(req.url()),
      scope = url.searchParams.get("restaurantId").startsWith("a") ? "A" : "B";
    if (body.action === "status") statusCalls++;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (fail) return route.fulfill({ status: 503, body: "unavailable" });
    if (body.action === "subscribe") {
      active.add(scope);
      subscribeCalls++;
    }
    if (body.action === "remove_scope") {
      active.delete(scope);
      removeCalls++;
    }
    await route.fulfill({
      json: { data: { active: !!body.endpoint && active.has(scope), publicKey } },
    });
  });
  await context.route("**/api/order-alerts?*", (route) => {
    const u = new URL(route.request().url());
    return route.fulfill({
      json: {
        data: {
          restaurantId: u.searchParams.get("restaurantId"),
          locationId: u.searchParams.get("locationId"),
          serverNow: new Date().toISOString(),
          timeoutRule: "manual_review",
          totalPending: 0,
          orders: [],
        },
      },
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  async function open() {
    const d = page.locator("details.operator-alarm-menu");
    if (!(await d.evaluate((x) => x.open))) await d.locator("summary").click();
  }
  async function button(label) {
    await page.getByRole("button", { name: label, exact: true }).waitFor({ state: "visible" });
  }
  const on = "Hintergrundalarm ausschalten",
    off = "Hintergrundalarm aktivieren";
  delay = 400;
  await page.goto(fixtureUrl);
  await open();
  await page.getByText("Gespeicherter Hintergrundalarm wird geprüft …", { exact: true }).waitFor();
  assert.equal(await page.getByText(/für diesen Standort aus/).count(), 0);
  await button(on);
  delay = 0;
  await page.locator("summary").click();
  const reopenedStatus = page.waitForResponse(
    (response) =>
      response.url().includes("/api/order-push?") &&
      response.request().postDataJSON()?.action === "status" &&
      response.ok(),
  );
  await open();
  await reopenedStatus;
  await button(on);
  await page.reload();
  await open();
  await button(on);
  assert.equal(subscribeCalls, 0, "reload must not silently subscribe");
  assert.equal(removeCalls, 0, "close must not remove");
  await page.getByRole("combobox").selectOption("B");
  await open();
  await button(off);
  await page.getByText("Hintergrundalarm · Testküche Mitte", { exact: true }).waitFor();
  assert.deepEqual([...active], ["A"]);
  delay = 250;
  await page.getByRole("button", { name: off, exact: true }).click();
  await page.locator("summary").click();
  await open();
  await button(on);
  await page.waitForFunction(
    () => !document.querySelector('button[aria-pressed="true"][disabled]'),
  );
  delay = 0;
  assert.deepEqual([...active], ["A", "B"]);
  await page.getByRole("combobox").selectOption("A");
  await open();
  await button(on);
  await page.getByRole("combobox").selectOption("B");
  await open();
  await button(on);
  fail = true;
  await page.locator("summary").click();
  await open();
  await page
    .getByText("Hintergrundalarm konnte nicht geprüft werden. Bitte erneut prüfen.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.getByRole("button", { name: off, exact: true }).count(), 0);
  assert.deepEqual([...active], ["A", "B"]);
  fail = false;
  // Reconnect triggers a fresh status read without racing the retry button's re-render.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await button(on);
  await page.getByRole("button", { name: on, exact: true }).click();
  await button(off);
  await page.locator("summary").click();
  await open();
  await button(off);
  assert.equal(removeCalls, 1);
  assert.equal(subscribeCalls, 1);
  assert.deepEqual([...active], ["A"]);
  assert.equal(await page.evaluate(() => localStorage.getItem("subscription")), "yes");
  // A completed request from the previous screen must refresh the current scope,
  // never copy its active status into that screen.
  delay = 400;
  await page.getByRole("button", { name: off, exact: true }).click();
  await page.getByRole("combobox").selectOption("A");
  await open();
  await button(on);
  await page.waitForTimeout(600);
  assert.deepEqual([...active], ["A", "B"]);
  await button(on);
  delay = 0;
  await page.getByRole("combobox").selectOption("B");
  await open();
  await button(on);
  active.delete("B");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await button(off);
  const plays = () => page.evaluate(() => window.__orderTonePlays);
  const soundOn = page.getByRole("button", { name: "Ton an", exact: true });
  const soundOff = page.getByRole("button", { name: "Ton aus", exact: true });
  await page.getByRole("button", { name: "Ton aktivieren und testen", exact: true }).click();
  await page.getByText("Ton aktiviert.", { exact: true }).waitFor();
  assert.equal(await plays(), 1, "explicit activation plays one test tone");
  await page.locator("summary").click();
  await open();
  await page.getByText("Ton aktiviert.", { exact: true }).waitFor();
  await page.getByRole("combobox").selectOption("A");
  await open();
  await page.getByText("Ton aktiviert.", { exact: true }).waitFor();
  assert.equal(await plays(), 1, "switching locations does not replay the test tone");
  await page.reload();
  await soundOn.waitFor();
  assert.equal(await plays(), 0, "saved preference does not play a tone on reload");
  await open();
  await page.getByText("Ton aktiviert.", { exact: true }).waitFor();
  assert.equal(await plays(), 0, "gesture restores playback without a test tone");
  await page.getByRole("button", { name: "Ton stummschalten", exact: true }).click();
  await page.reload();
  await soundOff.waitFor();
  await open();
  await page.getByText("Ton stumm.", { exact: true }).waitFor();
  assert.equal(await plays(), 0, "muted preference stays muted");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      browser: name,
      passed: true,
      scenarios: 15,
      statusCalls,
      subscribeCalls,
      removeCalls,
    }),
  );
  await browser.close();
}
