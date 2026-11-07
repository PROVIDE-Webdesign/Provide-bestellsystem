import assert from "node:assert/strict";
import type { Browser } from "playwright";

/** Production shell and inbox; only authentication/API transport is synthetic. */
export async function verifyUnifiedDashboardBrowser(browser: Browser, output: string) {
  const restaurantId = "f2000000-0000-0000-0000-000000000001";
  const locationId = "f3000000-0000-0000-0000-000000000001";
  for (const width of [1440, 390]) {
    for (const mode of ["owner-push", "owner-disabled", "viewer-push", "owner-denied"]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const requests: unknown[] = [];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((denied) => {
        // Normalize capability presence only. No service worker or notification is sent.
        if (!("PushManager" in window))
          Object.defineProperty(window, "PushManager", { value: class {} });
        Object.defineProperty(window, "Notification", {
          configurable: true,
          value: { permission: denied ? "denied" : "default" },
        });
      }, mode === "owner-denied");
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        let data: unknown;
        if (path === "/api/access-context") {
          data = {
            aal: "aal1",
            memberships: [
              {
                restaurantId,
                role: mode.startsWith("viewer") ? "viewer" : "owner",
                status: "active",
                access: "allowed",
                restaurant: { slug: "synthetic-integration", displayName: "Synthetic Integration" },
                locations: [{ id: locationId, slug: "mitte", displayName: "Synthetic Mitte" }],
              },
            ],
          };
        } else if (path === "/api/order-alerts") {
          data = {
            restaurantId,
            locationId,
            serverNow: new Date().toISOString(),
            timeoutRule: "manual_review",
            totalPending: 0,
            orders: [],
          };
        } else if (path === "/api/orders") {
          data = { restaurantId, locationId, orders: [], nextCursor: null };
        } else if (path === "/api/operations") {
          assert.equal(route.request().method(), "GET");
          await route.fulfill({ status: 503, json: { error: { code: "service_unavailable" } } });
          return;
        } else if (path === "/api/order-push") {
          assert.equal(
            new URL(route.request().url()).searchParams.get("restaurantId"),
            restaurantId,
          );
          assert.equal(new URL(route.request().url()).searchParams.get("locationId"), locationId);
          requests.push(route.request().postDataJSON());
          await route.fulfill({ status: 503, json: { error: { code: "service_unavailable" } } });
          return;
        } else throw Error("Unexpected unified dashboard request: " + path);
        await route.fulfill({ json: { data } });
      });
      try {
        await page.goto(
          "http://127.0.0.1:4321/?viewer" + (mode !== "owner-disabled" ? "&push" : ""),
        );
        await page.getByLabel("Restaurant wählen").waitFor();
        await page.getByText("Bestelleingang & Alarm", { exact: true }).click();
        if (mode === "owner-push") {
          await page
            .getByText("Hintergrundalarm derzeit nicht verfügbar.", { exact: true })
            .waitFor();
          assert.ok(requests.length > 0, "The new shell forwards the push flag to its inbox");
          assert.ok(requests.every((request) => JSON.stringify(request) === '{"action":"status"}'));
          await page.screenshot({
            path: output + `unified-owner-push-${width}.png`,
            fullPage: true,
          });
        } else {
          await page.getByText("Keine Bestellung wartet auf Annahme.", { exact: true }).waitFor();
          assert.equal(
            requests.length,
            0,
            "Disabled features and viewers never access push management",
          );
          if (mode === "owner-denied")
            await page
              .getByText(
                "Mitteilungen sind blockiert. Erlaube sie in den Einstellungen des Geräts oder Browsers.",
                { exact: true },
              )
              .waitFor();
          assert.equal(await page.getByText(/Hintergrundalarm/).count(), 0);
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
        );
        assert.deepEqual(errors, []);
        console.log(`Unified dashboard ${mode} ${width}px PASS`);
      } catch (error) {
        console.error(
          "UNIFIED_DIAG",
          mode,
          width,
          await page.locator("body").innerText(),
          requests,
          await page.evaluate(() => ({
            sw: "serviceWorker" in navigator,
            push: "PushManager" in window,
            permission: "Notification" in window ? Notification.permission : "missing",
          })),
        );
        throw error;
      } finally {
        await context.close();
      }
    }
  }
}
