import { strict as assert } from "node:assert";
import type { Page } from "playwright";
import type { DashboardOrderStatus } from "@provide/contracts";

export async function verifyOrderLiveBrowser(page: Page, output: string, width: number) {
  const restaurantId = "f2000000-0000-0000-0000-000000000001",
    locationId = "f3000000-0000-0000-0000-000000000001",
    orderId = "fa000000-0000-0000-0000-000000000048";
  let status: DashboardOrderStatus = "submitted",
    denied = false,
    failed = false,
    reads = 0;
  let serverNow = Date.now();
  const deadline = serverNow + 300000;
  let escalated = false;
  let contactName: string | null = "Synthetic Realtime Guest";
  await page.addInitScript(() => {
    sessionStorage.setItem("synthetic-tone-starts", "0");
    window.AudioContext = class extends AudioContext {
      override createOscillator() {
        const oscillator = super.createOscillator(),
          start = oscillator.start.bind(oscillator);
        oscillator.start = (when?: number) => {
          sessionStorage.setItem(
            "synthetic-tone-starts",
            String(Number(sessionStorage.getItem("synthetic-tone-starts")) + 1),
          );
          start(when);
        };
        return oscillator;
      }
    };
  });
  await page.route("**/api/order-alerts?*", async (route) => {
    reads++;
    if (denied || failed) {
      await route.fulfill({
        status: denied ? 403 : 503,
        json: { error: { code: denied ? "forbidden" : "service_unavailable" } },
      });
      return;
    }
    await route.fulfill({
      json: {
        data: {
          restaurantId,
          locationId,
          serverNow: new Date(serverNow).toISOString(),
          timeoutRule: "manual_review",
          totalPending: status === "submitted" ? 1 : 0,
          orders:
            status === "submitted"
              ? [
                  {
                    orderId,
                    orderNumber: "BS-00000448",
                    fulfillmentType: "pickup",
                    deadline: new Date(deadline).toISOString(),
                    escalatedAt: escalated ? new Date(deadline).toISOString() : null,
                  },
                ]
              : [],
        },
      },
    });
  });
  await page.route("**/api/orders**", async (route) => {
    const url = new URL(route.request().url()),
      detailed = url.pathname !== "/api/orders";
    const order = {
      orderId,
      orderNumber: "BS-00000448",
      status,
      fulfillmentType: "pickup",
      paymentCollectionMode: "on_fulfillment",
      requestedFor: "2026-10-02T12:00:00Z",
      updatedAt: new Date(serverNow).toISOString(),
      currency: "EUR",
      totalAmountMinor: 1500,
      itemCount: 1,
      allowedTransitions:
        status === "submitted" ? ["accepted", "rejected", "cancelled"] : ["preparing", "cancelled"],
    };
    await route.fulfill({
      json: {
        data: detailed
          ? {
              ...order,
              restaurantId,
              locationId,
              contactName,
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
              restaurantId,
              locationId,
              orders: url.searchParams.get("orderNumber") === "BS-00000999" ? [] : [order],
              nextCursor: null,
            },
      },
    });
  });
  const signal = async (id: number) =>
    page.evaluate(
      (n) =>
        window.dispatchEvent(
          new CustomEvent("synthetic-order-event", {
            detail: {
              schemaVersion: 1,
              eventId: `fb000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
            },
          }),
        ),
      id,
    );
  const tones = () => page.evaluate(() => Number(sessionStorage.getItem("synthetic-tone-starts")));
  await page.goto("http://127.0.0.1:4321/?board&live");
  await page.getByRole("heading", { name: "Offener Bestelleingang (1)", exact: true }).waitFor();
  await page.getByText("Live verbunden", { exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  assert.equal(await tones(), 0, "No autoplay before intentional click");
  await page.getByLabel("Bestellnummer suchen").fill("BS-00000999");
  await page.getByRole("button", { name: "Suchen", exact: true }).click();
  await page
    .getByText("Für diesen Filter liegen keine Bestellungen vor.", { exact: true })
    .waitFor();
  await page
    .getByRole("list", { name: "Zur Annahme priorisiert", exact: true })
    .getByRole("button", { name: /BS-00000448/ })
    .waitFor();
  await page.getByRole("button", { name: "Ton aktivieren und testen", exact: true }).click();
  await page.getByRole("button", { name: "Ton stummschalten", exact: true }).waitFor();
  assert.equal(await tones(), 1, "Explicit activation includes one test tone");
  await page.waitForLoadState("networkidle");
  const before = reads;
  const next = page.waitForResponse((r) => r.url().includes("/api/order-alerts"));
  for (let i = 0; i < 20; i++) await signal(1);
  await next;
  await page.waitForLoadState("networkidle");
  assert.equal(reads, before + 1, "Duplicate websocket hints cause one coalesced reload");
  assert.equal(await tones(), 1, "Duplicate hints do not replay sound");
  serverNow = deadline + 1000;
  escalated = true;
  await signal(2);
  await page.getByText("Eskalation protokolliert – jetzt prüfen", { exact: true }).waitFor();
  await page
    .getByText(/Annahmefrist überschritten/)
    .first()
    .waitFor();
  await page.waitForLoadState("networkidle");
  assert.ok((await tones()) >= 2, "An opted-in overdue inbox repeats its alarm");
  await page.getByRole("button", { name: "Ton stummschalten", exact: true }).click();
  const muted = await tones();
  await page.screenshot({ path: output + `order-live-alarm-${width}.png`, fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await page
    .getByRole("list", { name: "Zur Annahme priorisiert", exact: true })
    .getByRole("button", { name: /BS-00000448/ })
    .click();
  await page.getByRole("heading", { name: "#BS-00000448", exact: true }).waitFor();
  status = "accepted";
  serverNow += 1000;
  await signal(3);
  await page.getByText("Keine Bestellung wartet auf Annahme.", { exact: true }).waitFor();
  await page
    .getByText(
      "Die Bestellung wurde aktualisiert. Bitte prüfe den neuen Stand vor der nächsten Aktion.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await tones(), muted, "Mute remains effective for subsequent updates");
  contactName = null;
  await signal(6);
  await page.waitForLoadState("networkidle");
  await page
    .getByText(
      "Die Bestellung wurde aktualisiert. Bitte prüfe den neuen Stand vor der nächsten Aktion.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.getByText("Synthetic Realtime Guest", { exact: false }).count(),
    0,
    "A refreshed redaction removes stale PII even with unchanged order timestamps",
  );
  failed = true;
  await signal(4);
  await page.getByText(/Eingang nicht aktuell/).waitFor();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("synthetic-order-state", { detail: "fallback" })),
  );
  await page.getByText(/Live nicht verbunden/).waitFor();
  await page.waitForLoadState("networkidle");
  failed = false;
  // With no websocket hint, the normal 15-second safety poll recovers the inbox.
  await page.waitForResponse((r) => r.url().includes("/api/order-alerts") && r.status() === 200);
  await page.getByText("Keine Bestellung wartet auf Annahme.", { exact: true }).waitFor();
  await page.getByText(/Live nicht verbunden/).waitFor();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("synthetic-order-state", { detail: "live" })),
  );
  await page.getByText("Keine Bestellung wartet auf Annahme.", { exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  await page.reload();
  await page.getByRole("heading", { name: "Offener Bestelleingang (0)", exact: true }).waitFor();
  await page.getByRole("button", { name: "Ton aktivieren und testen", exact: true }).waitFor();
  assert.equal(await tones(), 0, "Reload never restores autoplay permission");
  denied = true;
  await signal(5);
  await page
    .getByText("Zugriff nicht mehr bestätigt. Bitte neu anmelden und Standortrechte prüfen.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.getByText("Synthetic Realtime Guest", { exact: false }).count(), 0);
  assert.equal(
    await page.getByRole("region", { name: "Bestelleingang und Alarm", exact: true }).count(),
    0,
  );
  await page.screenshot({ path: output + `order-live-denied-${width}.png`, fullPage: true });
}
