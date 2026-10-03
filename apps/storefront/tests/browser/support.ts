import { strict as assert } from "node:assert";
import type { Page } from "playwright";
import raw from "../../../../fixtures/support.json" with { type: "json" };
import { parseSupportCommand, type SupportCommand } from "@provide/contracts";
export async function verifySupportBrowser(page: Page, output: string, width: number) {
  let denied = false,
    canManage = true,
    revision = 1,
    deadline = raw.cases[0]!.deadline,
    lost: SupportCommand | null = null,
    calls = 0;
  await page.route("**/api/support", async (route) => {
    const q = parseSupportCommand(route.request().postDataJSON());
    assert.ok(q);
    assert.equal(new URL(route.request().url()).search, "");
    calls++;
    if (denied) {
      await route.fulfill({ status: 403, json: { error: { code: "forbidden" } } });
      return;
    }
    if (q.action === "update") {
      assert.equal(q.expectedRevision, revision);
      assert.equal(q.operation, "claim");
      if (!lost) {
        lost = q;
        await route.fulfill({ status: 503, json: { error: { code: "service_unavailable" } } });
        return;
      }
      assert.deepEqual(q, lost);
      revision++;
    }
    const detail = q.action === "update" || (q.action === "read" && q.caseId !== null);
    await route.fulfill({
      json: {
        data: {
          ...raw,
          canManage,
          cases: raw.cases.map((c) => ({
            ...c,
            revision,
            deadline,
            assigneeUserId: revision > 1 ? "f1000000-0000-0000-0000-000000000006" : null,
          })),
          currentSource: detail ? raw.cases[0]!.evidence : null,
        },
      },
    });
  });
  await page.goto("http://127.0.0.1:4321/?support=1");
  assert.ok(
    await page
      .getByText("Synthetischer O1-Browserprüflauf · keine echten Fälle", { exact: true })
      .isVisible(),
  );
  assert.equal(calls, 0, "no background scan or arbitrary scope fetch");
  await page.getByLabel("Mandanten-ID", { exact: true }).fill(raw.restaurantId);
  await page.getByLabel("Standort-ID", { exact: true }).fill(raw.locationId);
  await page.getByRole("button", { name: "Fälle laden", exact: true }).click();
  await page
    .getByRole("button", { name: "BS-00000421 · E-Mail-Annahme ungewiss", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "BS-00000421 · E-Mail-Annahme ungewiss", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Falldetail", exact: true }).waitFor();
  assert.ok(
    await page
      .getByText("Kein aktueller technischer Abschlussnachweis.", { exact: true })
      .isVisible(),
  );
  await page.screenshot({ path: `${output}/support-detail-${width}.png`, fullPage: true });
  await page.getByRole("button", { name: "Fallaktion speichern", exact: true }).click();
  await page
    .getByRole("button", { name: "Denselben Auftrag erneut versuchen", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Falldetail", exact: true }).count(),
    0,
    "503 removes stale detail",
  );
  await page
    .getByRole("button", { name: "Denselben Auftrag erneut versuchen", exact: true })
    .click();
  await page
    .getByText("Zuständig: f1000000-0000-0000-0000-000000000006", { exact: true })
    .waitFor();
  assert.equal(revision, 2, "lost-response retry reuses request");
  denied = true;
  await page.getByRole("button", { name: "Nachweis erneut lesen", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "BS-00000421 · E-Mail-Annahme ungewiss", exact: true })
      .count(),
    0,
    "403 clears case list",
  );
  assert.equal(
    await page.getByRole("heading", { name: "Falldetail", exact: true }).count(),
    0,
    "403 clears detail",
  );
  denied = false;
  canManage = false;
  await page.getByRole("button", { name: "Fälle laden", exact: true }).click();
  await page
    .getByRole("button", { name: "BS-00000421 · E-Mail-Annahme ungewiss", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Internen Abgleich starten (max. 100 Quellen)", exact: true })
      .count(),
    0,
    "read-only has no scan/mutation action",
  );
  assert.equal(
    await page.getByRole("heading", { name: "Fall erfassen", exact: true }).count(),
    0,
    "read-only cannot create",
  );
  await page.screenshot({ path: `${output}/support-readonly-${width}.png`, fullPage: true });
  // The repeated local hour during DST must retain its distinct UTC offset.
  const shown: string[] = [];
  for (const utc of ["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]) {
    deadline = utc;
    await page.getByRole("button", { name: "Fälle laden", exact: true }).click();
    const expected = await page.evaluate(
      (value) =>
        new Date(value).toLocaleString("de-DE", {
          timeZone: "Europe/Berlin",
          timeZoneName: "short",
        }),
      utc,
    );
    await page.getByText(`Offen · Normal · Frist ${expected}`, { exact: true }).waitFor();
    shown.push(expected);
  }
  assert.notEqual(shown[0], shown[1], "DST repeated hour is disambiguated by zone offset");
  // Scope edits must discard even a delayed successful response from the old scope.
  let release: () => void = () => undefined;
  const late = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.unroute("**/api/support");
  await page.route("**/api/support", async (route) => {
    observed();
    await late;
    await route.fulfill({ json: { data: raw } }).catch(() => undefined);
  });
  await page.getByRole("button", { name: "Fälle laden", exact: true }).click();
  await arrived;
  await page
    .getByLabel("Standort-ID", { exact: true })
    .fill("f3000000-0000-0000-0000-000000000002");
  release();
  assert.equal(
    await page
      .getByRole("button", { name: "BS-00000421 · E-Mail-Annahme ungewiss", exact: true })
      .count(),
    0,
    "scope edit clears immediately",
  );
  assert.equal(await page.getByRole("heading", { name: "Fall erfassen", exact: true }).count(), 0);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "support layout has no horizontal overflow",
  );
  await page.unroute("**/api/support");
}
