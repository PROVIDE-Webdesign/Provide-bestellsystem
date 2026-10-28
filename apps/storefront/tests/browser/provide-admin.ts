import { strict as assert } from "node:assert";
import type { Page } from "playwright";
import raw from "../../../../fixtures/provide-admin.json" with { type: "json" };
import { parseProvideAdminCommand } from "@provide/contracts";
export async function verifyProvideBrowser(page: Page, output: string, width: number) {
  let denied = false,
    conflict = false,
    revision = raw.selected.revision,
    mutations = 0;
  let replay: unknown = null;
  let setupMode = false;
  let savedAddress: unknown = null;
  await page.route("**/api/provide", async (route) => {
    const q = parseProvideAdminCommand(route.request().postDataJSON());
    assert.ok(q);
    assert.equal(route.request().method(), "POST");
    assert.equal(new URL(route.request().url()).search, "");
    if (denied) {
      await route.fulfill({ status: 403, json: { error: { code: "forbidden" } } });
      return;
    }
    if (q.action !== "read") {
      mutations++;
      if (setupMode) {
        assert.ok(q.action === "firstOwner" || q.action === "locationAddress");
        assert.equal(q.expectedRevision, revision);
        assert.equal(q.reason, "Synthetic setup review");
        if (q.action === "firstOwner") {
          assert.equal(q.ownerUserId, "f1000000-0000-0000-0000-000000000005");
          assert.equal(q.confirmation, raw.selected.slug);
          assert.equal(q.locationId, null);
        } else {
          assert.equal(q.locationId, raw.selected.locations[0]!.id);
          assert.deepEqual(q.address, {
            addressLine1: "Testweg 2",
            addressLine2: null,
            postalCode: "52062",
            city: "Aachen",
            countryCode: "DE",
          });
          savedAddress = q.address;
        }
        revision++;
      } else {
        assert.equal(q.action, "feature");
        assert.equal(q.expectedRevision, revision);
        assert.equal(q.reason, "Synthetic feature review");
        if (conflict) {
          await route.fulfill({ status: 409, json: { error: { code: "conflict" } } });
          return;
        }
        if (replay === null) {
          replay = q;
          await route.fulfill({ status: 503, json: { error: { code: "service_unavailable" } } });
          return;
        }
        assert.deepEqual(q, replay);
        revision++;
      }
    }
    await route.fulfill({
      json: {
        data: {
          ...raw,
          selected: q.restaurantId
            ? {
                ...raw.selected,
                revision,
                address: q.locationId ? savedAddress : null,
                locationId: q.locationId ?? null,
                scopeSlug: q.locationId ? "storefront-a-mitte" : raw.selected.slug,
                scopeDisplayName: q.locationId ? "Teststandort Mitte" : raw.selected.displayName,
                features: raw.selected.features.map((f) => ({
                  ...f,
                  effectiveEnabled: revision > 10,
                  restaurantEnabled: revision > 10,
                  mode: revision > 10 ? "enabled" : "inherit",
                  reason: revision > 10 ? "Synthetic feature review" : null,
                  expiresAt: revision > 10 ? "2026-10-02T12:00:00.000Z" : null,
                })),
                audit:
                  revision > 10
                    ? [
                        {
                          id: "fa000000-0000-0000-0000-000000000001",
                          at: raw.serverNow,
                          locationId: null,
                          action: "restaurant_feature_flags.update",
                          actorUserId: "f1000000-0000-0000-0000-000000000007",
                          reason: "Synthetic feature review",
                          before: { enabled: false },
                          after: { enabled: true },
                        },
                      ]
                    : [],
              }
            : null,
        },
      },
    });
  });
  await page.goto("http://127.0.0.1:4321/?provide=1");
  await page
    .getByRole("combobox", { name: "Mandant", exact: true })
    .selectOption(raw.selected.restaurantId);
  await page.getByRole("combobox", { name: "Verwaltungsaktion" }).selectOption("feature");
  await page.getByRole("combobox", { name: "Neue Feature-Regel" }).selectOption("enabled");
  await page.getByLabel("Änderungsgrund", { exact: true }).first().fill("Synthetic feature review");
  await page.getByLabel("Ich habe Bereich und Änderung geprüft.", { exact: true }).check();
  await page.getByRole("button", { name: "Änderung bewusst anwenden" }).click();
  await page.getByRole("button", { name: "Dieselbe Anfrage wiederholen" }).click();
  await page
    .getByText("Änderung auditiert. Aktueller Stand wurde geladen.", { exact: true })
    .waitFor();
  assert.equal(mutations, 2);
  await page.getByText("restaurant_feature_flags.update", { exact: false }).click();
  assert.ok(await page.getByText('"enabled": true', { exact: false }).isVisible());
  await page.screenshot({ path: `${output}/provide-admin-${width}.png`, fullPage: true });
  const overflow = await page.evaluate(() =>
    Array.from(document.querySelectorAll("*"))
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .map((e) => ({
        tag: e.tagName,
        class: e.className,
        width: e.getBoundingClientRect().width,
        right: e.getBoundingClientRect().right,
      }))
      .slice(0, 15),
  );
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    JSON.stringify(overflow),
  );
  setupMode = true;
  await page.getByRole("combobox", { name: "Verwaltungsaktion" }).selectOption("firstOwner");
  await page
    .getByLabel("Bestätigte Benutzer-ID des Inhabers", { exact: true })
    .fill("f1000000-0000-0000-0000-000000000005");
  await page.locator('input[name="confirmation"]').fill(raw.selected.slug);
  await page.getByLabel("Änderungsgrund", { exact: true }).first().fill("Synthetic setup review");
  await page.getByLabel("Ich habe Bereich und Änderung geprüft.", { exact: true }).check();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/provide") && r.request().postDataJSON().action === "firstOwner",
    ),
    page.getByRole("button", { name: "Änderung bewusst anwenden" }).click(),
  ]);
  await page.screenshot({ path: `${output}/provide-first-owner-${width}.png`, fullPage: true });
  await page
    .getByRole("combobox", { name: "Verwaltungsbereich" })
    .selectOption(raw.selected.locations[0]!.id);
  await page.getByText("Teststandort Mitte", { exact: true }).last().waitFor();
  await page.getByRole("combobox", { name: "Verwaltungsaktion" }).selectOption("locationAddress");
  assert.equal(await page.locator('option[value="firstOwner"]').count(), 0);
  await page.getByLabel("Straße und Hausnummer", { exact: true }).fill("Testweg 2");
  await page.getByLabel("Postleitzahl", { exact: true }).fill("52062");
  await page.getByLabel("Stadt", { exact: true }).fill("Aachen");
  await page.getByLabel("Ländercode", { exact: true }).fill("de");
  await page.getByLabel("Änderungsgrund", { exact: true }).first().fill("Synthetic setup review");
  await page.getByLabel("Ich habe Bereich und Änderung geprüft.", { exact: true }).check();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/provide") && r.request().postDataJSON().action === "locationAddress",
    ),
    page.getByRole("button", { name: "Änderung bewusst anwenden" }).click(),
  ]);
  await page.screenshot({
    path: `${output}/provide-location-address-${width}.png`,
    fullPage: true,
  });
  setupMode = false;
  await page.getByRole("combobox", { name: "Verwaltungsaktion" }).selectOption("feature");
  conflict = true;
  await page.getByLabel("Änderungsgrund", { exact: true }).first().fill("Synthetic feature review");
  await page.getByLabel("Ich habe Bereich und Änderung geprüft.", { exact: true }).check();
  await page.getByRole("button", { name: "Änderung bewusst anwenden" }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Mandant", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Dieselbe Anfrage wiederholen" }).count(), 0);
  await page.getByRole("button", { name: "Verwaltung neu laden" }).click();
  await page.getByRole("combobox", { name: "Mandant", exact: true }).waitFor();
  denied = true;
  await page.getByRole("button", { name: "Verwaltung neu laden" }).click();
  await page
    .getByText("Zugriff verweigert oder entzogen. Alle Verwaltungsdaten wurden ausgeblendet.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Mandant", exact: true }).count(), 0);
  assert.equal(await page.getByText("Synthetic feature review", { exact: true }).count(), 0);
  await page.unroute("**/api/provide");
}
