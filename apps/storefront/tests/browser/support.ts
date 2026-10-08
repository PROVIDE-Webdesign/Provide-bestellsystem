import { strict as assert } from "node:assert";
import type { Page } from "playwright";
import raw from "../../../../fixtures/support.json" with { type: "json" };
import { parseSupportCommand, type SupportCommand } from "@provide/contracts";
export async function verifySupportBrowser(caller: Page, output: string, width: number) {
  // Keep virtual time isolated from the remaining browser regression suites.
  const page = await caller.context().newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let denied = false,
    deniedStatus = 403,
    canManage = true,
    revision = 1,
    deadline = raw.cases[0]!.deadline,
    lost: SupportCommand | null = null,
    calls = 0;
  const scanCursor = "fd000000-0000-0000-0000-000000000001";
  let scanCalls = 0,
    loseScan = false,
    lostScan: SupportCommand | null = null,
    scanConflict = false;
  await page.clock.install();
  await page.route("**/api/support", async (route) => {
    const q = parseSupportCommand(route.request().postDataJSON());
    assert.ok(q);
    assert.equal(new URL(route.request().url()).search, "");
    calls++;
    if (denied) {
      await route.fulfill({ status: deniedStatus, json: { error: { code: "forbidden" } } });
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
    if (q.action === "scan") {
      scanCalls++;
      if (scanConflict) {
        await route.fulfill({ status: 409, json: { error: { code: "conflict" } } });
        return;
      }
      if (loseScan) {
        loseScan = false;
        lostScan = q;
        await route.fulfill({ status: 503, json: { error: { code: "service_unavailable" } } });
        return;
      }
      if (lostScan) {
        assert.deepEqual(q, lostScan, "scan replay retains cursor and immutable request ID");
        lostScan = null;
      }
      assert.ok(q.cursor === null || q.cursor === scanCursor);
    }
    const detail = q.action === "update" || (q.action === "read" && q.caseId !== null);
    await route.fulfill({
      json: {
        data: {
          ...raw,
          canManage,
          scanned: q.action === "scan" ? (q.cursor === null ? 100 : 1) : 0,
          scanCursor: q.action === "scan" && q.cursor === null ? scanCursor : null,
          nextCursor:
            q.action === "read" && q.caseId === null && q.cursor === null
              ? raw.cases[0]!.caseId
              : null,
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
  const continueScan = page.getByRole("button", { name: "Abgleich fortsetzen", exact: true });
  const startScan = page.getByRole("button", {
    name: "Internen Abgleich starten (max. 100 Quellen)",
    exact: true,
  });
  const finishRead = async (trigger: () => Promise<unknown>) => {
    const response = page.waitForResponse((r) => r.url().endsWith("/api/support"));
    await trigger();
    await response;
    await page.getByRole("button", { name: "Fälle laden", exact: true }).waitFor();
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>(".support-form button")?.disabled,
    );
  };
  await startScan.click();
  await continueScan.waitFor();
  assert.equal(scanCalls, 1);
  await finishRead(() => page.clock.runFor(15000));
  assert.ok(await continueScan.isVisible(), "timer read cannot consume continuation");
  await finishRead(() => page.evaluate(() => window.dispatchEvent(new Event("focus"))));
  assert.ok(await continueScan.isVisible(), "focus read cannot consume continuation");
  await finishRead(() => page.getByRole("button", { name: "Weitere Fälle", exact: true }).click());
  assert.ok(await continueScan.isVisible(), "list pagination cannot consume continuation");
  await finishRead(() =>
    page
      .getByRole("button", {
        name: "BS-00000421 · E-Mail-Annahme ungewiss",
        exact: true,
      })
      .click(),
  );
  assert.ok(await continueScan.isVisible(), "detail navigation cannot consume continuation");
  await finishRead(() =>
    page.getByRole("button", { name: "Nachweis erneut lesen", exact: true }).click(),
  );
  assert.ok(await continueScan.isVisible(), "detail refresh cannot consume continuation");
  await finishRead(() => page.getByRole("button", { name: "Fälle laden", exact: true }).click());
  assert.equal(scanCalls, 1, "reads never trigger an automatic source scan");
  await page.screenshot({ path: `${output}/support-continuation-${width}.png`, fullPage: true });
  loseScan = true;
  await continueScan.click();
  await page
    .getByRole("button", { name: "Denselben Auftrag erneut versuchen", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Denselben Auftrag erneut versuchen", exact: true })
    .click();
  await page
    .getByText("1 interne Quellen im letzten Abschnitt geprüft. Dieser Abgleich ist beendet.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await continueScan.count(), 0, "successful terminal receipt ends continuation");
  assert.equal(scanCalls, 3, "second batch retries precisely the lost command");
  // Expired/foreign/already consumed cursor: explicit failure, never a false completion.
  await startScan.click();
  await continueScan.waitFor();
  scanConflict = true;
  await continueScan.click();
  await page
    .getByText("Abgleich-Fortsetzung ungültig oder abgelaufen. Bitte den Abgleich neu starten.", {
      exact: true,
    })
    .waitFor();
  scanConflict = false;
  await finishRead(() => page.getByRole("button", { name: "Fälle laden", exact: true }).click());
  assert.equal(await continueScan.count(), 0, "conflicted cursor stays discarded after read");
  await startScan.click();
  await continueScan.waitFor();
  denied = true;
  await page.getByRole("button", { name: "Fälle laden", exact: true }).click();
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
  await finishRead(() => page.getByRole("button", { name: "Fälle laden", exact: true }).click());
  assert.equal(
    await continueScan.count(),
    0,
    "403 invalidates continuation even after access returns",
  );
  await startScan.click();
  await continueScan.waitFor();
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
  canManage = true;
  await finishRead(() => page.getByRole("button", { name: "Fälle laden", exact: true }).click());
  assert.equal(await continueScan.count(), 0, "manage loss invalidates continuation permanently");
  await startScan.click();
  await continueScan.waitFor();
  await page
    .getByLabel("Standort-ID", { exact: true })
    .fill("f3000000-0000-0000-0000-000000000002");
  await page.getByLabel("Standort-ID", { exact: true }).fill(raw.locationId);
  await finishRead(() => page.getByRole("button", { name: "Fälle laden", exact: true }).click());
  assert.equal(await continueScan.count(), 0, "scope switch back cannot restore the old cursor");
  await startScan.click();
  await continueScan.waitFor();
  denied = true;
  deniedStatus = 401;
  await finishRead(() => page.getByRole("button", { name: "Fälle laden", exact: true }).click());
  denied = false;
  await finishRead(() => page.getByRole("button", { name: "Fälle laden", exact: true }).click());
  assert.equal(
    await continueScan.count(),
    0,
    "401 invalidates continuation after reauthentication",
  );
  await startScan.click();
  await continueScan.waitFor();
  await page.reload();
  await page.getByLabel("Mandanten-ID", { exact: true }).fill(raw.restaurantId);
  await page.getByLabel("Standort-ID", { exact: true }).fill(raw.locationId);
  await finishRead(() => page.getByRole("button", { name: "Fälle laden", exact: true }).click());
  assert.equal(
    await continueScan.count(),
    0,
    "unmount/remount cannot restore session-local cursor",
  );
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
  // A delayed scan receipt must not resurrect its cursor after a scope edit.
  await page.route("**/api/support", (route) => route.fulfill({ json: { data: raw } }));
  await page.getByLabel("Standort-ID", { exact: true }).fill(raw.locationId);
  await finishRead(() => page.getByRole("button", { name: "Fälle laden", exact: true }).click());
  await page.unroute("**/api/support");
  let releaseScan: () => void = () => undefined;
  const heldScan = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });
  let observeScan: () => void = () => undefined;
  const arrivedScan = new Promise<void>((resolve) => {
    observeScan = resolve;
  });
  let finishScan: () => void = () => undefined;
  const settledScan = new Promise<void>((resolve) => {
    finishScan = resolve;
  });
  await page.route("**/api/support", async (route) => {
    const q = parseSupportCommand(route.request().postDataJSON());
    assert.equal(q?.action, "scan");
    observeScan();
    await heldScan;
    await route
      .fulfill({ json: { data: { ...raw, scanned: 100, scanCursor } } })
      .catch(() => undefined);
    finishScan();
  });
  await startScan.click();
  await arrivedScan;
  await page
    .getByLabel("Standort-ID", { exact: true })
    .fill("f3000000-0000-0000-0000-000000000002");
  releaseScan();
  await settledScan;
  await page.unroute("**/api/support");
  await page.route("**/api/support", (route) => route.fulfill({ json: { data: raw } }));
  await page.getByLabel("Standort-ID", { exact: true }).fill(raw.locationId);
  await finishRead(() => page.getByRole("button", { name: "Fälle laden", exact: true }).click());
  assert.equal(await continueScan.count(), 0, "late scan cannot resurrect discarded cursor");
  await page.unroute("**/api/support");
  assert.deepEqual(errors, []);
  await page.close();
}
