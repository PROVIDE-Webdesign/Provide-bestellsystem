import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import type { Dialog, Page, Route } from "playwright";
import {
  parseMenuAdminState,
  parseMenuConfiguration,
  type MenuAdminState,
} from "@provide/contracts";
import rawConfiguration from "../../../../fixtures/menu-configuration.json" with { type: "json" };
const configuration = parseMenuConfiguration(rawConfiguration)!;
const restaurantA = "f2000000-0000-0000-0000-000000000001";
const restaurantB = "f2000000-0000-0000-0000-000000000002";
const locationA = "f3000000-0000-0000-0000-000000000001";
const locationB = "f3000000-0000-0000-0000-000000000002";
const privateMenu = "Interner unveröffentlichter Entwurf";
const privateDish = "Unveröffentlichtes Testgericht";
const fixture: MenuAdminState = {
  timezone: "Europe/Berlin",
  deliveryTax: {
    policyId: "fa000000-0000-0000-0000-000000000011",
    mode: "fixed",
    taxRateBasisPoints: 1900,
  },
  stops: [],
  menus: [
    {
      id: "f4000000-0000-0000-0000-000000000001",
      name: privateMenu,
      versions: [
        {
          id: "f5000000-0000-0000-0000-000000000001",
          number: 2,
          revision: 0,
          status: "draft",
          sections: [{ key: "gerichte", name: "Interne Planung" }],
          items: [
            {
              id: "f6000000-0000-0000-0000-000000000001",
              sectionKey: "gerichte",
              name: privateDish,
              description: "Interne Kalkulation",
              priceAmountMinor: 1234,
              isActive: true,
              configuration,
            },
          ],
        },
      ],
      publications: [],
    },
  ],
};
assert.ok(parseMenuAdminState(fixture));
export async function verifyMenuAccessBrowser(page: Page, output: string, width: number) {
  const results: { scenario: string; result: "PASS" }[] = [];
  const accept = (dialog: Dialog) => void dialog.accept();
  page.on("dialog", accept);
  await page.unroute("**/api/menu?*");
  let status = 200,
    networkError = false,
    writes = 0;
  let delayed: Route | undefined;
  let holdHeaders = false;
  const respond = async (route: Route) => {
    if (route.request().method() === "POST") writes++;
    if (holdHeaders) {
      holdHeaders = false;
      delayed = route;
      return;
    }
    if (networkError) {
      await route.abort("failed");
      return;
    }
    const url = new URL(route.request().url());
    const sameScope =
      url.searchParams.get("restaurantId") === restaurantA &&
      url.searchParams.get("locationId") === locationA;
    await route.fulfill(
      status === 200
        ? {
            json: {
              data: sameScope ? fixture : { timezone: "Europe/Berlin", menus: [], stops: [] },
            },
          }
        : { status, json: {} },
    );
  };
  await page.route("**/api/menu?*", respond);
  const load = () => page.getByRole("button", { name: "Menüstand laden", exact: true }).click();
  const ready = async () => {
    status = 200;
    networkError = false;
    await page.goto("http://127.0.0.1:4321/?dashboard");
    await load();
    await page.getByText("Menüstand geladen.", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Preis in Euro", { exact: true }).inputValue(), "12.34");
  };
  const empty = async () => {
    assert.equal(
      await page.getByRole("button", { name: "Entwurf speichern", exact: true }).count(),
      0,
    );
    assert.equal(await page.locator(".menu-editor input, .menu-editor textarea").count(), 0);
    assert.equal(await page.getByLabel("Menüvorschau", { exact: true }).count(), 0);
    const text = await page.locator("body").innerText();
    for (const secret of [
      privateMenu,
      privateDish,
      "Interne Kalkulation",
      "Interne Importplanung",
      "Private Änderungsnotiz",
    ])
      assert.equal(text.includes(secret), false);
    assert.deepEqual(await page.locator(".menu-editor button").allTextContents(), [
      "Menüstand laden",
    ]);
  };
  try {
    for (const method of ["GET", "POST"] as const)
      for (const denied of [401, 403]) {
        await ready();
        await page.getByLabel("Name", { exact: true }).first().fill("Private Neuanlage");
        await page.getByLabel("Kurzname für die Speisekarte").fill("private-neuanlage");
        await page.getByLabel("Änderungsnotiz").fill("Private Änderungsnotiz");
        await page.getByLabel("Begründung", { exact: true }).fill("Private Steuerbegründung");
        await page.getByLabel("Importdatei (JSON)").setInputFiles({
          name: "private-import.json",
          mimeType: "application/json",
          buffer: Buffer.from(
            JSON.stringify({
              format: "provide-menu-import-v1",
              source: { name: "Interne Importplanung", sha256: "a".repeat(64) },
              sections: fixture.menus[0]!.versions[0]!.sections,
              items: fixture.menus[0]!.versions[0]!.items,
            }),
          ),
        });
        await page.getByText(/Interne Importplanung/).waitFor();
        await page.getByRole("button", { name: "Änderungsvorschau anzeigen", exact: true }).click();
        status = denied;
        if (method === "GET") await load();
        else await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
        await page.getByText(/Zugriff nicht mehr bestätigt/).waitFor();
        await empty();
        const afterDenied = writes;
        await page.screenshot({
          path: output + `menu-access-${method}-${denied}-${width}.png`,
          fullPage: true,
        });
        status = 503;
        await load();
        await page
          .getByText("Menüpflege ist gesperrt oder nicht verfügbar.", { exact: true })
          .waitFor();
        await empty();
        assert.equal(writes, afterDenied);
        status = 200;
        await load();
        await page.getByText("Menüstand geladen.", { exact: true }).waitFor();
        assert.equal(await page.getByLabel("Name", { exact: true }).first().inputValue(), "");
        assert.equal(await page.getByLabel("Kurzname für die Speisekarte").inputValue(), "");
        assert.equal(await page.getByLabel("Änderungsnotiz").inputValue(), "");
        assert.equal(await page.getByLabel("Begründung", { exact: true }).inputValue(), "");
        assert.equal(await page.getByText(/Interne Importplanung/).count(), 0);
        assert.equal(await page.getByLabel("Menüvorschau", { exact: true }).count(), 0);
        assert.equal(
          await page.getByRole("button", { name: "Entwurf speichern", exact: true }).isEnabled(),
          true,
        );
        results.push({ scenario: `${method}-${denied}-clear-and-reauthorize`, result: "PASS" });
      }
    for (const failure of ["conflict", "unavailable", "network"] as const) {
      await ready();
      await page
        .getByLabel("Name", { exact: true })
        .nth(1)
        .fill("Berechtigte ungespeicherte Änderung");
      status = failure === "conflict" ? 409 : 503;
      networkError = failure === "network";
      await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
      await page.waitForFunction(
        () => !document.querySelector<HTMLFieldSetElement>(".menu-editor > fieldset")!.disabled,
      );
      assert.equal(
        await page.getByLabel("Name", { exact: true }).nth(1).inputValue(),
        "Berechtigte ungespeicherte Änderung",
      );
      assert.equal(
        await page.getByRole("button", { name: "Entwurf speichern", exact: true }).isEnabled(),
        true,
      );
      results.push({ scenario: `${failure}-preserves-authorized-draft`, result: "PASS" });
    }
    await ready();
    await page.getByLabel("Änderungsnotiz").fill("Private Änderungsnotiz");
    await page.locator(".menu-editor > fieldset > label select").selectOption(locationB);
    await empty();
    await load();
    await page.getByText("Menüstand geladen.", { exact: true }).waitFor();
    assert.equal(await page.getByText(privateDish, { exact: true }).count(), 0);
    await page.locator(".menu-editor > fieldset > label select").selectOption(locationA);
    await load();
    await page.getByText("Menüstand geladen.", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Änderungsnotiz").inputValue(), "");
    results.push({ scenario: "location-change-clears-dependent-fields", result: "PASS" });
    for (const phase of ["headers", "body"] as const)
      for (const unmount of [false, true]) {
        await ready();
        await page.evaluate((holdBody) => {
          const original = window.fetch.bind(window);
          let release!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          Object.assign(window, {
            __menuReturned: 0,
            __menuBodyWaiting: false,
            __releaseMenu: release,
          });
          window.fetch = async (input, init) => {
            const url =
              typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const tracked = new URL(url, window.location.href).pathname === "/api/menu";
            const response = await original(
              input,
              tracked && init ? { ...init, signal: null } : init,
            );
            if (tracked && holdBody) {
              const json = response.json.bind(response);
              response.json = async () => {
                const body: unknown = await json();
                Object.assign(window, { __menuBodyWaiting: true });
                await gate;
                Object.assign(window, { __menuReturned: 1 });
                return body;
              };
            } else if (tracked) Object.assign(window, { __menuReturned: 1 });
            return response;
          };
        }, phase === "body");
        delayed = undefined;
        holdHeaders = phase === "headers";
        await load();
        if (phase === "headers") {
          for (let i = 0; !delayed && i < 100; i++) await page.waitForTimeout(10);
          assert.ok(delayed);
        } else
          await page.waitForFunction(
            () => (window as unknown as { __menuBodyWaiting: boolean }).__menuBodyWaiting,
          );
        await page.evaluate(
          ({ restaurantId, mounted }) =>
            window.dispatchEvent(
              new CustomEvent("synthetic-menu-scope", { detail: { restaurantId, mounted } }),
            ),
          { restaurantId: restaurantB, mounted: !unmount },
        );
        if (unmount) await page.getByText("Menüpflege geschlossen", { exact: true }).waitFor();
        else await empty();
        if (phase === "headers") await delayed!.fulfill({ json: { data: fixture } });
        else
          await page.evaluate(() =>
            (window as unknown as { __releaseMenu: () => void }).__releaseMenu(),
          );
        await page.waitForFunction(
          () => (window as unknown as { __menuReturned: number }).__menuReturned === 1,
        );
        // Wait a rendering turn after the continuation actually returned.
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        );
        if (unmount) assert.equal(await page.locator(".menu-editor").count(), 0);
        else await empty();
        assert.equal((await page.locator("body").innerText()).includes(privateDish), false);
        results.push({
          scenario: `late-${phase}-${unmount ? "unmount" : "restaurant"}-ignored-with-ineffective-abort`,
          result: "PASS",
        });
      }
    assert.equal(results.length, 12);
    await writeFile(
      output + `menu-access-results-${width}.json`,
      JSON.stringify(
        {
          width,
          scenarios: results,
          transport:
            "Synthetic HTTP replies; actual production MenuEditor and native browser; no server/DB authorization bypass claimed",
        },
        null,
        2,
      ),
    );
    console.log(`R12-01 menu access ${width}px: ${results.length} scenarios PASS`);
  } finally {
    page.removeListener("dialog", accept);
    await page.unroute("**/api/menu?*", respond);
  }
}
