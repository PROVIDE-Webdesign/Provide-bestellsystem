import assert from "node:assert/strict";
import type { Page } from "playwright";

// Real components/native engines; synthetic transport. DB/Auth/Realtime are separate actual tests.
export async function verifyViewerBrowser(page: Page, output: string, width: number) {
  const restaurantId = "f2000000-0000-0000-0000-000000000001";
  const locationId = "f3000000-0000-0000-0000-000000000001";
  const orderId = "fa000000-0000-0000-0000-000000000021";
  let denied = false,
    status = "accepted",
    reads = 0,
    writes = 0;
  const location = { id: locationId, slug: "synthetic-mitte", displayName: "Synthetic Mitte" };
  await page.route("**/api/access-context", (route) =>
    route.fulfill({
      json: {
        data: {
          aal: "aal1",
          memberships: [
            {
              restaurantId,
              role: "viewer",
              status: "active",
              access: "allowed",
              restaurant: {
                slug: "synthetic-restaurant",
                displayName: "Synthetic Viewer Restaurant",
              },
              locations: [location],
            },
          ],
        },
      },
    }),
  );
  await page.route("**/api/order-alerts?*", (route) =>
    route.fulfill({
      status: denied ? 403 : 200,
      json: denied
        ? { error: { code: "forbidden" } }
        : {
            data: {
              restaurantId,
              locationId,
              serverNow: new Date().toISOString(),
              timeoutRule: "manual_review",
              totalPending: 0,
              orders: [],
            },
          },
    }),
  );
  await page.route("**/api/orders**", async (route) => {
    reads++;
    if (route.request().method() !== "GET") {
      writes++;
      await route.fulfill({ status: 403, json: {} });
      return;
    }
    if (denied) {
      await route.fulfill({ status: 403, json: { error: { code: "forbidden" } } });
      return;
    }
    const detail = new URL(route.request().url()).pathname !== "/api/orders";
    // Deliberately inject a valid but overprivileged response to test the additional UI guard.
    const order = {
      orderId,
      orderNumber: "BS-00000421",
      status,
      fulfillmentType: "delivery",
      paymentCollectionMode: "online",
      paymentState: "refund_failed",
      requestedFor: "2026-10-02T14:00:00Z",
      updatedAt: "2026-10-02T13:00:00Z",
      currency: "EUR",
      totalAmountMinor: 1500,
      itemCount: 1,
      allowedTransitions:
        status === "accepted" ? ["preparing", "cancelled"] : ["ready", "cancelled"],
    };
    await route.fulfill({
      json: {
        data: detail
          ? {
              ...order,
              restaurantId,
              locationId,
              contactName: "MUST NOT DISPLAY Private Guest",
              delivery: {
                recipientName: "MUST NOT DISPLAY Recipient",
                phoneE164: "+999100000021",
                addressLine1: "MUST NOT DISPLAY Address",
                addressLine2: null,
                postalCode: "52062",
                city: "Aachen",
                countryCode: "DE",
              },
              deliveryFeeAmountMinor: 0,
              communication: {
                confirmedFor: "2026-10-02T14:30:00Z",
                dispatchedAt: null,
                revision: 1,
                timezone: "Europe/Berlin",
              },
              lines: [
                {
                  lineNumber: 1,
                  displayName: "Synthetic Viewer Dish",
                  quantity: 1,
                  unitPriceAmountMinor: 1500,
                  lineAmountMinor: 1500,
                },
              ],
            }
          : { restaurantId, locationId, orders: [order], nextCursor: null },
      },
    });
  });
  const noActions = async () => {
    assert.equal(await page.getByLabel("Status ändern").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Neue Zeit bestätigen" }).count(), 0);
    assert.equal(
      await page.getByRole("button", { name: /Vollerstattung|unterwegs bestätigen/ }).count(),
      0,
    );
    assert.equal(await page.getByText(/MUST NOT DISPLAY/).count(), 0);
    assert.equal(writes, 0);
  };
  await page.goto("http://127.0.0.1:4321/?viewer");
  await page.getByText("Viewer · nur lesen", { exact: true }).waitFor();
  await page.getByText("Nur Lesezugriff: keine Änderungen und keine Kundendaten.").waitFor();
  await page
    .getByText(
      "Verantwortliche informieren. Viewer können Bestellungen nicht annehmen oder ablehnen.",
      { exact: false },
    )
    .waitFor();
  assert.equal(await page.getByText("Manuell prüfen und annehmen", { exact: false }).count(), 0);
  assert.equal(await page.getByText("Personalverwaltung", { exact: true }).count(), 0);
  assert.equal(
    await page
      .getByText(/Historie und Kennzahlen|Standortbetrieb und Konfiguration|Menüverwaltung/)
      .count(),
    0,
  );
  const card = page.getByRole("button", { name: /BS-00000421/ });
  await card.waitFor();
  await card.focus();
  await page.keyboard.press("Enter");
  await page.getByText("Synthetic Viewer Dish").waitFor();
  await noActions();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await page.screenshot({ path: `${output}/viewer-readonly-${width}.png`, fullPage: true });
  await page.goto("http://127.0.0.1:4321/?board&viewer&live");
  await page.getByRole("button", { name: /BS-00000421/ }).click();
  await page.getByText("Synthetic Viewer Dish").waitFor();
  await noActions();
  const before = reads;
  status = "preparing";
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("synthetic-order-event", {
        detail: { schemaVersion: 1, id: "fb000000-0000-0000-0000-000000000021" },
      }),
    ),
  );
  await page.getByRole("button", { name: /BS-00000421.*In Zubereitung/ }).waitFor();
  assert.ok(reads > before);
  await noActions();
  denied = true;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("synthetic-order-event", {
        detail: { schemaVersion: 1, id: "fb000000-0000-0000-0000-000000000022" },
      }),
    ),
  );
  await page
    .getByText("Zugriff nicht mehr bestätigt. Bitte neu anmelden und Standortrechte prüfen.")
    .waitFor();
  assert.equal(await page.getByRole("button", { name: /BS-00000421/ }).count(), 0);
  assert.equal(await page.getByText("Synthetic Viewer Dish").count(), 0);
  await page.screenshot({ path: `${output}/viewer-revoked-${width}.png`, fullPage: true });
  assert.equal(writes, 0);
  await page.unroute("**/api/access-context");
  await page.unroute("**/api/order-alerts?*");
  await page.unroute("**/api/orders**");
}
