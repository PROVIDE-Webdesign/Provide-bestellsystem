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
    await route.fulfill({
      json: {
        data: {
          ...raw,
          selected: q.restaurantId
            ? {
                ...raw.selected,
                revision,
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
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/provide-admin-${width}.png`, fullPage: true });
  await page
    .getByRole("combobox", { name: "Verwaltungsbereich" })
    .selectOption(raw.selected.locations[0]!.id);
  await page.getByText("Teststandort Mitte", { exact: true }).last().waitFor();
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
