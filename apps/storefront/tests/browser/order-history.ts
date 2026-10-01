import { strict as assert } from "node:assert";
import type { Page } from "playwright";
import raw from "../../../../fixtures/order-history.json" with { type: "json" };
import { parseHistoryQuery } from "@provide/contracts";
export async function verifyHistoryBrowser(page: Page, output: string, width: number) {
  let denied = false,
    requests = 0;
  await page.route("**/api/history?*", async (route) => {
    requests++;
    const q = parseHistoryQuery(route.request().postDataJSON());
    assert.ok(q);
    assert.equal(route.request().method(), "POST");
    assert.ok(!route.request().url().includes("Synthetic"));
    if (denied) {
      await route.fulfill({ status: 403, json: { error: { code: "forbidden" } } });
      return;
    }
    const o = raw.orders[0]!;
    const detail = q.orderId
      ? {
          order: {
            ...o,
            restaurantId: raw.restaurantId,
            locationId: raw.locationId,
            contactName: "Synthetic History",
            lines: [
              {
                lineNumber: 1,
                displayName: "Gemüsecurry",
                quantity: 1,
                unitPriceAmountMinor: 1250,
                lineAmountMinor: 1250,
              },
            ],
          },
          events: [
            {
              sequence: 1,
              fromStatus: null,
              toStatus: "submitted",
              actorKind: "system",
              at: raw.serverNow,
            },
            {
              sequence: 2,
              fromStatus: "submitted",
              toStatus: "accepted",
              actorKind: "personnel",
              at: raw.serverNow,
            },
            {
              sequence: 3,
              fromStatus: "accepted",
              toStatus: "preparing",
              actorKind: "personnel",
              at: raw.serverNow,
            },
            {
              sequence: 4,
              fromStatus: "preparing",
              toStatus: "ready",
              actorKind: "personnel",
              at: raw.serverNow,
            },
            {
              sequence: 5,
              fromStatus: "ready",
              toStatus: "completed",
              actorKind: "personnel",
              at: raw.serverNow,
            },
          ],
        }
      : null;
    await route.fulfill({
      json: {
        data: {
          ...raw,
          detail,
          orders: q.cursor
            ? [
                {
                  ...o,
                  orderId: "fc000000-0000-0000-0000-000000000002",
                  orderNumber: "BS-00000422",
                },
              ]
            : raw.orders,
          nextCursor: q.cursor
            ? null
            : "2026-10-01T12:00:00.123456Z|fc000000-0000-0000-0000-000000000001",
          metrics: [
            ...["total", "day", "week"].map((period) => ({
              ...raw.metrics[0],
              period,
              date: period === "week" ? "2026-09-28" : "2026-10-01",
              orderCount: 2,
              completedCount: 2,
              pickupCount: 2,
              completedGrossMinor: 2500,
            })),
          ],
        },
      },
    });
  });
  await page.goto("http://127.0.0.1:4321/?history");
  await page.getByRole("heading", { name: "Gesamt · EUR", exact: true }).waitFor();
  await page.getByLabel("Kundenname suchen").fill("Synthetic");
  await page.getByRole("button", { name: "Historie suchen", exact: true }).click();
  await page.getByRole("button", { name: /BS-00000421/ }).click();
  await page.getByRole("heading", { name: "Verlauf BS-00000421", exact: true }).waitFor();
  await page.getByText("Tages- und Wochenkennzahlen", { exact: true }).click();
  await page.getByRole("heading", { name: "Woche ab 2026-09-28 · EUR", exact: true }).waitFor();
  await page.screenshot({ path: output + `order-history-${width}.png`, fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await page.getByRole("button", { name: "Ältere Bestellungen", exact: true }).click();
  await page.getByRole("button", { name: /BS-00000421/ }).waitFor({ state: "detached" });
  await page.getByRole("button", { name: /BS-00000422/ }).waitFor();
  const prior = requests;
  await page.getByLabel("Kundenname suchen").fill("x");
  await page.getByRole("button", { name: "Historie suchen", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(requests, prior, "invalid short name never sent");
  denied = true;
  await page.getByRole("button", { name: "Aktuelle Woche", exact: true }).click();
  await page.getByText("Zugriff entzogen.", { exact: false }).waitFor();
  assert.equal(await page.getByText("Bruttobestellwert (erfüllt)", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Kundenname suchen").inputValue(), "");
}
