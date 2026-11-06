import assert from "node:assert/strict";
import type { Browser } from "playwright";
import fixture from "../../../../fixtures/storefront-catalog.json" with { type: "json" };

export async function verifyPaymentStatusPolling(browser: Browser) {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const now = Date.parse("2026-11-04T12:00:00Z");
    await page.clock.install({ time: new Date(now) });
    let paymentState = "refund_failed";
    let reads = 0;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const status = {
      orderId: "fa000000-0000-0000-0000-000000000421",
      orderNumber: "BS-00000421",
      status: "cancelled",
      fulfillmentType: "pickup",
      paymentCollectionMode: "online",
      requestedFor: new Date(now + 3600000).toISOString(),
      statusAvailableUntil: new Date(now + 49 * 3600000).toISOString(),
      currency: "EUR",
      totalAmountMinor: 1500,
      itemCount: 1,
      updatedAt: new Date(now).toISOString(),
    };
    await page.route("**/api/storefront/**", async (route) => {
      const resource = new URL(route.request().url()).pathname.split("/").at(-1);
      if (resource === "catalog") return route.fulfill({ json: { data: fixture } });
      if (resource === "checkout-context")
        return route.fulfill({ json: { data: { ready: true, csrf: "a".repeat(43) } } });
      if (resource === "order-status") {
        reads++;
        return route.fulfill({ json: { data: { ...status, paymentState } } });
      }
      throw Error("Unexpected request during read-only payment status regression: " + resource);
    });
    try {
      const fragment = new URLSearchParams({
        orderId: status.orderId,
        statusAccessToken: "a".repeat(43),
        statusAvailableUntil: status.statusAvailableUntil,
      });
      await page.goto("http://127.0.0.1:4321/#" + fragment.toString());
      await page.getByText("Erstattung muss geprüft werden", { exact: true }).first().waitFor();
      const refresh = page.getByRole("button", { name: "Status aktualisieren", exact: true });
      await refresh.waitFor();
      await page.waitForLoadState("networkidle");
      paymentState = "refund_pending";
      await refresh.click();
      await page.getByText("Erstattung angefordert", { exact: true }).first().waitFor();
      await page.waitForLoadState("networkidle");
      paymentState = "refunded";
      await page.clock.runFor(21_000);
      await page.getByText("Erstattet", { exact: true }).first().waitFor({ timeout: 5000 });
      await page.waitForLoadState("networkidle");
      const settledReads = reads;
      await page.clock.runFor(61_000);
      await page.waitForLoadState("networkidle");
      assert.equal(reads, settledReads, "Final refund stops polling");
      assert.deepEqual(errors, []);
      console.log(
        "Payment status " +
          width +
          "px: pending refund resumes polling; settled refund stops polling PASS",
      );
    } finally {
      await context.close();
    }
  }
}
