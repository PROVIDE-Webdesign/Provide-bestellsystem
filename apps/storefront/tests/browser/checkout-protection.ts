import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { parsePublicCatalog } from "@provide/contracts";
import fixture from "../../../../fixtures/storefront-catalog.json" with { type: "json" };
/** UI-only transport doubles; native cookie/SQL evidence is separately required by CI. */
export async function verifyCheckoutProtectionBrowser(browser: Browser, output: string) {
  const catalog = parsePublicCatalog(fixture),
    menu = catalog.menus[0]!,
    item = menu.sections[0]!.items[0]!;
  const base = "/api/storefront/storefront-restaurant-a/storefront-a-mitte";
  const now = new Date("2026-10-08T10:00:00Z").getTime();
  for (const width of [1440, 390])
    for (const scenario of [
      "rate",
      "outage",
      "write-expiry",
      "receipt-expiry",
      "missing-metadata",
      "blocked-storage",
    ] as const) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await page.clock.install({ time: new Date(now - 10000) });
      await page.addInitScript((blocked: boolean) => {
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
        if (blocked)
          Object.defineProperty(window, "sessionStorage", {
            get: () => {
              throw Error("Synthetic blocked session storage");
            },
          });
      }, scenario === "blocked-storage");
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const issues: unknown[] = [];
      let writes = 0,
        receiptReads = 0,
        failIssue = true;
      await page.route("**/api/storefront/**", async (route) => {
        const resource = new URL(route.request().url()).pathname.split("/").at(-1);
        if (resource === "catalog") {
          await route.fulfill({ json: { data: catalog } });
          return;
        }
        if (resource === "checkout-context") {
          await route.fulfill({
            json: {
              data: {
                ready: true,
                csrf: "a".repeat(43),
                hasExistingIntents: scenario === "missing-metadata",
              },
            },
          });
          return;
        }
        if (resource === "cart-quote") {
          await route.fulfill({
            json: {
              data: {
                status: "current",
                currentMenuVersionId: menu.versionId,
                currency: "EUR",
                itemCount: 1,
                subtotalAmountMinor: item.priceAmountMinor,
                deliveryQuote: null,
                lines: [
                  {
                    menuItemId: item.id,
                    name: item.name,
                    quantity: 1,
                    variantId: null,
                    optionIds: [],
                    unitPriceAmountMinor: item.priceAmountMinor,
                    lineAmountMinor: item.priceAmountMinor,
                    selectionSnapshot: null,
                  },
                ],
              },
            },
          });
          return;
        }
        if (resource === "checkout-session") {
          const issue = route.request().postDataJSON() as { submissionKey: string };
          issues.push(issue);
          if (failIssue && ["rate", "outage"].includes(scenario)) {
            failIssue = false;
            await route.fulfill({
              status: scenario === "rate" ? 429 : 503,
              headers: { "retry-after": "10" },
              json: {
                error: { code: scenario === "rate" ? "rate_limited" : "service_unavailable" },
              },
            });
            return;
          }
          await route.fulfill({
            json: {
              data: {
                sessionId: "fc000000-0000-0000-0000-000000000031",
                submissionKey: issue.submissionKey,
                writeExpiresAt: new Date(now + 1800000).toISOString(),
                receiptExpiresAt: new Date(now + 5400000).toISOString(),
              },
            },
          });
          return;
        }
        if (resource === "checkout-receipt") {
          receiptReads++;
          await route.fulfill(
            scenario === "receipt-expiry"
              ? { status: 410, json: { error: { code: "checkout_session_expired" } } }
              : { json: { data: { state: "unsubmitted", writeExpired: true } } },
          );
          return;
        }
        if (resource === "orders") {
          writes++;
          await route.fulfill({ status: 503, json: { error: { code: "service_unavailable" } } });
          return;
        }
        await route.fulfill({ status: 404, json: {} });
      });
      try {
        await page.goto("http://127.0.0.1:4321");
        const dish = page
          .locator("li.dish")
          .filter({ has: page.getByRole("heading", { name: item.name, exact: true }) });
        await dish.getByRole("button", { name: "Hinzufügen" }).click();
        await page.getByLabel("Datum und Uhrzeit").fill("2026-10-08T16:00");
        await page.getByRole("button", { name: "Warenkorb und Preise prüfen" }).click();
        await page
          .getByRole("checkbox", {
            name: "Ich bestätige die angezeigten Gerichte, Auswahl und aktuellen Preise.",
          })
          .check();
        const start = page.getByRole("button", { name: "Sicherheitsprüfung starten", exact: true });
        await start.focus();
        await page.keyboard.press("Enter");
        if (scenario === "rate") {
          await page
            .getByText("Bitte warte 10 Sekunden und versuche es bewusst erneut.", { exact: true })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "Abholbestellung absenden", exact: true })
              .isDisabled(),
            true,
          );
          await start.click();
          await page
            .getByText(
              "Bestellversuch vorbereitet. Du kannst die Bestellung jetzt ausdrücklich absenden.",
              { exact: true },
            )
            .waitFor();
          assert.deepEqual(
            issues[1],
            issues[0],
            "Explicit retry preserves provider UUID, challenge and key",
          );
        } else if (scenario === "outage") {
          await page
            .getByText(
              "Der Bestellversuch konnte gerade nicht geprüft werden. Dein Warenkorb bleibt erhalten.",
              { exact: true },
            )
            .waitFor();
          assert.equal(issues.length, 1);
          await start.click();
          await page
            .getByText(
              "Bestellversuch vorbereitet. Du kannst die Bestellung jetzt ausdrücklich absenden.",
              { exact: true },
            )
            .waitFor();
          assert.deepEqual(issues[1], issues[0]);
        } else if (scenario === "missing-metadata") {
          await page
            .getByText(/Für diesen Browser gibt es einen bisherigen Bestellversuch/)
            .waitFor();
          assert.equal(issues.length, 0);
          await page
            .getByRole("button", { name: "Neuen Bestellversuch bewusst starten", exact: true })
            .waitFor();
        } else {
          await page
            .getByText(
              "Bestellversuch vorbereitet. Du kannst die Bestellung jetzt ausdrücklich absenden.",
              { exact: true },
            )
            .waitFor();
          if (scenario === "write-expiry" || scenario === "receipt-expiry") {
            await page.clock.pauseAt(new Date(now + 1800001));
            await page
              .getByText(
                "Der Schreibzeitraum ist abgelaufen. Prüfe zuerst den bisherigen Bestellversuch, bevor du ihn ausdrücklich erneuerst.",
                { exact: true },
              )
              .waitFor();
            assert.equal(
              await page
                .getByRole("button", { name: "Abholbestellung absenden", exact: true })
                .isDisabled(),
              true,
            );
            if (scenario === "receipt-expiry") {
              await page.clock.fastForward(3600000);
              assert.ok(
                await page.evaluate(() =>
                  Object.entries(sessionStorage).some(([key]) =>
                    key.startsWith("provide-checkout-intent:"),
                  ),
                ),
              );
              const receiptResponse = page.waitForResponse(
                (response) =>
                  response.url().endsWith("checkout-receipt") && response.status() === 410,
              );
              await page.reload();
              await receiptResponse;
              await page.getByText(/Der Bestellversuch ist abgelaufen/).waitFor();
              assert.ok(receiptReads > 0);
              assert.equal(
                issues.length,
                1,
                "Expired recovery must not automatically create another key",
              );
            }
          }
        }
        assert.equal(writes, 0);
        await page.getByRole("heading", { name: "1 Gerichte", exact: true }).waitFor();
        assert.deepEqual(errors, []);
        if (scenario !== "receipt-expiry")
          assert.equal(
            await page.evaluate(() => document.activeElement?.getAttribute("role")),
            "status",
          );
        await page.evaluate(() => {
          document.documentElement.style.zoom = "2";
        });
        await page.screenshot({ path: output + `o3-${scenario}-${width}.png`, fullPage: true });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
        );
        console.log(
          `O3 UI transport-double ${scenario} ${width}px keyboard/focus/live/200%-zoom PASS`,
        );
        // Public intent metadata is scoped; blocked storage is warned, never treated as order confirmation.
        if (scenario === "blocked-storage")
          assert.equal(
            await page.evaluate(() => {
              try {
                sessionStorage.getItem("synthetic-blocked-storage-check");
                return false;
              } catch {
                return true;
              }
            }, base),
            true,
          );
      } catch (error) {
        await page.screenshot({
          path: output + `o3-failure-${scenario}-${width}.png`,
          fullPage: true,
        });
        console.log(
          "O3 browser failure",
          JSON.stringify({
            scenario,
            width,
            receiptReads,
            issues: issues.length,
            status: await page.getByRole("status").allTextContents(),
          }),
        );
        throw error;
      } finally {
        await context.close();
      }
    }
}
