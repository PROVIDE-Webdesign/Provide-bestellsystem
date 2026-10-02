import { strict as assert } from "node:assert";
import type { Page } from "playwright";
import raw from "../../../../fixtures/personnel.json" with { type: "json" };
import { parsePersonnelCommand, type PersonnelCommand } from "@provide/contracts";
export async function verifyPersonnelBrowser(page: Page, output: string, width: number) {
  let denied = false,
    conflict = false,
    manager = false,
    inbox = false,
    accepted = false;
  let replay: PersonnelCommand | undefined;
  let mutations = 0;
  const invitation = {
    id: "fa000000-0000-0000-0000-000000000019",
    restaurantId: raw.restaurantId,
    restaurantName: "Synthetic Restaurant",
    email: "invited@example.invalid",
    role: "kitchen",
    locationIds: [raw.locations[0]!.id],
    locations: [raw.locations[0]!],
    expiresAt: "2026-10-09T00:00:00.000Z",
    expired: false,
  };
  await page.route("**/api/personnel", async (route) => {
    const q = parsePersonnelCommand(route.request().postDataJSON());
    assert.ok(q);
    assert.equal(route.request().method(), "POST");
    assert.equal(new URL(route.request().url()).search, "");
    if (denied || (conflict && q.action !== "read")) {
      await route.fulfill({
        status: denied ? 403 : 409,
        json: { error: { code: denied ? "forbidden" : "conflict" } },
      });
      return;
    }
    if (inbox) {
      assert.ok(q.action === "inbox" || q.action === "accept");
      if (q.action === "accept") {
        assert.equal(q.invitationId, invitation.id);
        accepted = true;
      }
      await route.fulfill({
        json: { data: { mode: "inbox", invitations: accepted ? [] : [invitation] } },
      });
      return;
    }
    if (q.action !== "read") {
      mutations++;
      assert.equal(q.action, "invite");
      assert.equal(q.expectedRevision, raw.revision);
      assert.equal(q.reason, "Synthetic personnel review");
      assert.deepEqual(q.locationIds, [raw.locations[0]!.id]);
      if (!replay) {
        replay = q;
        await route.fulfill({ status: 503, json: { error: { code: "service_unavailable" } } });
        return;
      }
      assert.deepEqual(q, replay);
    }
    await route.fulfill({
      json: {
        data: {
          ...raw,
          actorRole: manager ? "manager" : "owner",
          locations: manager ? raw.locations.slice(0, 1) : raw.locations,
          members: manager ? raw.members.filter((m) => m.role === "kitchen") : raw.members,
          revision: mutations > 1 ? raw.revision + 1 : raw.revision,
          invitations: mutations > 1 ? [invitation] : [],
          dispatches:
            mutations > 1
              ? [
                  {
                    id: replay!.action === "invite" ? replay!.requestId : invitation.id,
                    email: invitation.email,
                    role: "kitchen",
                    locationIds: invitation.locationIds,
                    status: "sent",
                  },
                ]
              : [],
          audit:
            mutations > 1
              ? [
                  {
                    id: invitation.id,
                    at: raw.serverNow,
                    actorUserId: raw.members[0]!.userId,
                    action: "personnel.invite",
                    reason: "Synthetic personnel review",
                    before: {},
                    after: { role: "kitchen", locationIds: invitation.locationIds },
                  },
                ]
              : [],
        },
      },
    });
  });
  const form = async () => {
    await page.getByLabel("E-Mail der eingeladenen Person", { exact: true }).fill(invitation.email);
    await page.getByLabel(raw.locations[0]!.displayName, { exact: true }).check();
    await page
      .getByLabel("Grund der Personaländerung", { exact: true })
      .fill("Synthetic personnel review");
    await page.getByLabel("Ich habe Person, Rolle und Standorte geprüft.", { exact: true }).check();
  };
  await page.goto("http://127.0.0.1:4321/?personnel");
  await form();
  await page.getByRole("button", { name: "Person einladen", exact: true }).click();
  assert.equal(await page.getByLabel("E-Mail der eingeladenen Person", { exact: true }).count(), 0);
  await page
    .getByRole("button", { name: "Dieselbe Personalanfrage wiederholen", exact: true })
    .click();
  await page
    .getByText("Änderung auditiert. Aktueller Personalstand geladen.", { exact: true })
    .waitFor();
  assert.equal(mutations, 2);
  await page.getByText("personnel.invite", { exact: false }).click();
  await page.getByText('"role": "kitchen"', { exact: false }).waitFor();
  await page.screenshot({ path: `${output}/personnel-${width}.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  manager = true;
  await page.getByRole("button", { name: "Personal neu laden", exact: true }).click();
  await page.getByText(/^Verwaltungsstand \d+ · Manager$/, { exact: true }).waitFor();
  await page
    .getByRole("combobox", { name: "Neue Personalrolle", exact: true })
    .locator("option")
    .first()
    .waitFor({ state: "attached" });
  assert.deepEqual(
    await page
      .getByRole("combobox", { name: "Neue Personalrolle", exact: true })
      .locator("option")
      .allTextContents(),
    ["Küche", "Fahrer"],
  );
  assert.equal(await page.getByLabel(raw.locations[1]!.displayName, { exact: true }).count(), 0);
  conflict = true;
  await form();
  await page.getByRole("button", { name: "Person einladen", exact: true }).click();
  await page
    .getByText("Der Stand wurde geändert. Neu laden und die Änderung erneut prüfen.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Dieselbe Personalanfrage wiederholen", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.getByText(raw.members[1]!.email, { exact: true }).count(), 0);
  denied = true;
  await page.getByRole("button", { name: "Personal neu laden", exact: true }).click();
  await page
    .getByText("Personalrechte entzogen. Geladene Daten wurden verworfen.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("combobox", { name: "Neue Personalrolle", exact: true }).count(),
    0,
  );
  denied = false;
  conflict = false;
  inbox = true;
  await page.goto("http://127.0.0.1:4321/?invitations");
  await page.getByRole("button", { name: "Einladung bewusst annehmen", exact: true }).waitFor();
  await page.screenshot({ path: `${output}/invitations-${width}.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.getByRole("button", { name: "Einladung bewusst annehmen", exact: true }).click();
  await page
    .getByText("Einladung angenommen. Die Mitgliedschaft ist jetzt verfügbar.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Einladung bewusst annehmen", exact: true }).count(),
    0,
  );
  await page.unroute("**/api/personnel");
}
