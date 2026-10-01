import { strict as assert } from "node:assert";
import type { Page } from "playwright";
import { parseLocationOperationsCommand, type LocationOperationsState } from "@provide/contracts";
export async function verifyLocationOperationsBrowser(page: Page, output: string, width: number) {
  const configuration = {
    minimumLeadMinutes: 15,
    maximumAdvanceDays: 14,
    slotIntervalMinutes: 15,
    defaultOrderCapacity: 10,
    defaultItemCapacity: 100,
    orderCutoffMinutes: 0,
    acceptanceMinutes: 5,
    maxOpenOrders: null,
    windows: [
      {
        fulfillment: "pickup" as const,
        weekday: 1,
        opensAt: "12:00",
        closesAt: "22:00",
        orderCapacity: null,
        itemCapacity: null,
      },
    ],
    exceptions: [],
    zones: [{ postalCodes: ["52062"], minimumAmountMinor: 1500, feeAmountMinor: 200 }],
  };
  const versionId = "fb000000-0000-0000-0000-000000000001",
    draftId = "fb000000-0000-0000-0000-000000000002";
  let state: LocationOperationsState = {
    timezone: "Europe/Berlin",
    serverNow: new Date().toISOString(),
    publicationId: "fb000000-0000-0000-0000-000000000011",
    deliveryPolicyId: "fb000000-0000-0000-0000-000000000012",
    currentVersionId: versionId,
    operationSequence: 0,
    openOrders: 2,
    versions: [{ id: versionId, number: 1, revision: 0, status: "published", configuration }],
    overrides: [],
    audit: [],
  };
  let denied = false,
    conflict = false,
    saves = 0,
    publishes = 0;
  await page.route("**/api/operations?*", async (route) => {
    if (denied || conflict) {
      await route.fulfill({
        status: denied ? 403 : 409,
        json: { error: { code: denied ? "forbidden" : "conflict" } },
      });
      return;
    }
    if (route.request().method() === "POST") {
      const cmd = parseLocationOperationsCommand(route.request().postDataJSON());
      assert.ok(cmd, "production form emits a valid command");
      if (cmd.action === "create_draft")
        state = {
          ...state,
          versions: [
            {
              id: draftId,
              number: 2,
              status: "draft",
              revision: 0,
              configuration: structuredClone(configuration),
            },
            ...state.versions,
          ],
        };
      if (cmd.action === "save_draft") {
        saves++;
        assert.equal(cmd.expectedRevision, state.versions[0]!.revision);
        state = {
          ...state,
          versions: state.versions.map((v) =>
            v.id === cmd.versionId
              ? { ...v, revision: v.revision + 1, configuration: cmd.configuration }
              : v,
          ),
        };
      }
      if (cmd.action === "publish") {
        publishes++;
        assert.equal(cmd.expectedPublicationId, state.publicationId);
        state = {
          ...state,
          currentVersionId: cmd.versionId,
          publicationId: "fb000000-0000-0000-0000-000000000013",
          versions: state.versions.map((v) =>
            v.id === cmd.versionId ? { ...v, status: "published" } : v,
          ),
        };
      }
      if (cmd.action === "override") {
        assert.equal(cmd.expectedSequence, state.operationSequence);
        state = {
          ...state,
          operationSequence: state.operationSequence + 1,
          overrides: [
            {
              scope: cmd.scope,
              sequence: state.operationSequence + 1,
              endsAt: cmd.endsAt,
              values: cmd.values,
              reason: cmd.reason,
            },
            ...state.overrides.filter((o) => o.scope !== cmd.scope),
          ],
        };
      }
      if (cmd.action === "clear_override")
        state = {
          ...state,
          operationSequence: state.operationSequence + 1,
          overrides: state.overrides.filter((o) => o.scope !== cmd.scope),
        };
    }
    state = {
      ...state,
      serverNow: new Date().toISOString(),
      overrides: state.overrides.filter((o) => Date.parse(o.endsAt) > Date.now()),
    };
    await route.fulfill({ json: { data: state } });
  });
  await page.goto("http://127.0.0.1:4321/?operations");
  await page.getByText("Offene Bestellungen:", { exact: false }).waitFor();
  await page.getByLabel("Grund der Betriebsänderung").fill("Synthetic peak");
  await page.getByLabel("Neue Bestellungen pausieren").check();
  await page.getByRole("button", { name: "Betriebsmodus anwenden", exact: true }).click();
  await page.getByText("Synthetic peak ·", { exact: false }).waitFor();
  assert.equal(state.overrides[0]?.values.paused, true);
  await page.getByLabel("Geltungsbereich", { exact: true }).selectOption("pickup");
  await page
    .getByRole("button", { name: "Temporäre Regel dieses Bereichs beenden", exact: true })
    .click();
  assert.equal(
    state.overrides.find((o) => o.scope === "all")?.values.paused,
    true,
    "channel resume leaves whole-location pause",
  );
  await page.getByLabel("Änderungsgrund", { exact: true }).fill("Synthetic opening review");
  await page.getByRole("button", { name: "Neuen Entwurf anlegen", exact: true }).click();
  await page.getByText("Neuer Entwurf angelegt.", { exact: true }).waitFor();
  // Exact label excludes the optional temporary field.
  await page.getByLabel("Vorlauf in Minuten", { exact: true }).fill("40");
  await page.getByLabel("Annahmefrist neuer Bestellungen in Minuten", { exact: true }).fill("7");
  await page.getByLabel("Mindestartikelwert in Cent", { exact: true }).fill("1800");
  assert.equal(
    await page
      .getByRole("button", { name: "Standortregeln veröffentlichen", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Konfigurationsentwurf speichern", exact: true }).click();
  await page
    .getByText("Entwurf gespeichert. Veröffentlichung steht noch aus.", { exact: true })
    .waitFor();
  assert.equal(saves, 1);
  assert.equal(publishes, 0);
  await page
    .getByLabel(
      "Ausgewählte Zeiten, Kapazitäten und Lieferpreise geprüft; diese Version soll sofort wirksam werden.",
    )
    .check();
  await page.getByRole("button", { name: "Standortregeln veröffentlichen", exact: true }).click();
  await page.getByText("Standortregeln veröffentlicht.", { exact: true }).waitFor();
  assert.equal(publishes, 1);
  assert.equal(state.versions[0]!.configuration.minimumLeadMinutes, 40);
  await page.screenshot({ path: output + `location-operations-${width}.png`, fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  // Reload loses unsaved form state but retains the server's active operational rule.
  await page.reload();
  await page.getByText("Synthetic peak ·", { exact: false }).waitFor();
  state = {
    ...state,
    overrides: state.overrides.map((o) => ({
      ...o,
      endsAt: new Date(Date.now() - 1000).toISOString(),
    })),
  };
  await page.getByRole("button", { name: "Stand aktualisieren", exact: true }).click();
  await page.getByText("Synthetic peak ·", { exact: false }).waitFor({ state: "detached" });
  conflict = true;
  await page.getByRole("button", { name: "Stand aktualisieren", exact: true }).click();
  await page.getByText("Zwischenzeitliche Änderung:", { exact: false }).waitFor();
  conflict = false;
  denied = true;
  await page.getByRole("button", { name: "Stand aktualisieren", exact: true }).click();
  await page.getByText("Zugriff entzogen.", { exact: false }).waitFor();
  assert.equal(await page.getByLabel("Vorlauf in Minuten", { exact: true }).count(), 0);
}
