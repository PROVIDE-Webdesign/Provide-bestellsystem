import assert from "node:assert/strict";
import type { Page } from "playwright";
export async function verifyRecoveryBrowser(page: Page, output: string, width: number) {
  const id = "a4100000-0000-0000-0000-000000000001";
  let state = "requested",
    revision = 1,
    denied = false,
    effects = 0;
  let caseId = id,
    approvals = 0;
  const calls: string[] = [];
  await page.route("**/api/recovery", async (route) => {
    const body = route.request().postDataJSON() as {
      command: {
        action: string;
        caseId: string;
        contactId?: string;
        evidenceReference?: string;
      };
    };
    const q = body.command;
    if (q.action === "request") {
      caseId = q.caseId;
      state = "requested";
      revision = 1;
      approvals = 0;
    } else assert.equal(q.caseId, caseId);
    calls.push(q.action);
    assert.equal("password" in q, false);
    assert.equal("token" in q, false);
    if (denied) {
      await route.fulfill({ status: 403, json: { error: { code: "forbidden" } } });
      return;
    }
    if (q.action === "verify") {
      assert.equal(q.contactId, id);
      assert.equal(q.evidenceReference, "synthetic-proof");
      state = "verified";
      revision++;
    }
    if (q.action === "approve") {
      approvals++;
      state = approvals === 2 ? "approved" : "verified";
      revision++;
    }
    if (q.action === "execute") {
      effects++;
      state = "awaiting_reenrollment";
      revision++;
    }
    if (q.action === "complete") {
      state = "completed";
      revision++;
    }
    if (q.action === "cancel") {
      state = "cancelled";
      revision++;
    }
    await route.fulfill({
      json: {
        data: {
          caseId: q.caseId,
          kind: "lost_factor",
          state,
          revision,
          expiresAt: "2026-10-04T01:00:00Z",
          approvalExpiresAt: state === "approved" ? "2026-10-03T02:00:00Z" : null,
          requiredApprovals: 2,
        },
      },
    });
  });
  await page.goto("http://127.0.0.1:4321/?recovery");
  const request = page.getByRole("button", { name: "Verlorenen MFA-Faktor melden" });
  await request.focus();
  await page.keyboard.press("Enter");
  await page.getByText("Status: Angefordert", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Freigegebenen Faktorverlust ausführen" }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Mit neuer Sitzung abschließen" }).count(),
    0,
  );
  assert.equal(await page.getByRole("button", { name: "Bestellung annehmen" }).count(), 0);
  await page.screenshot({ path: `${output}/recovery-requested-${width}.png`, fullPage: true });
  await page.reload();
  await page.getByText("Status: Angefordert", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Fall abbrechen", exact: true }).click();
  await page.getByText("Status: Abgebrochen", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Verlorenen MFA-Faktor melden" }).click();
  await page.getByText("Status: Angefordert", { exact: true }).waitFor();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByLabel("Eigene Fallkennung", { exact: true }).fill(caseId);
  await page.getByRole("button", { name: "Bestehenden Fall öffnen", exact: true }).click();
  await page.getByText("Status: Angefordert", { exact: true }).waitFor();
  await page.goto("http://127.0.0.1:4321/?recovery&operator");
  await page.getByLabel("Fallkennung", { exact: true }).fill(caseId);
  await page.getByRole("button", { name: "Fall öffnen", exact: true }).click();
  await page.getByLabel("Registrierte Kontaktkennung").fill(id);
  await page.getByLabel("Nachweisreferenz").fill("synthetic-proof");
  await page.getByRole("button", { name: "Nachweise bestätigen" }).focus();
  await page.keyboard.press("Enter");
  await page.getByText("Status: Nachweise geprüft", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Unabhängige Freigabe erteilen" }).click();
  await page.getByText("Status: Nachweise geprüft", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Freigegebenen Faktorverlust ausführen" }).count(),
    0,
  );
  // UI transport only: actual distinct human identities are proved in the Auth integration test.
  await page.getByRole("button", { name: "Unabhängige Freigabe erteilen" }).click();
  await page.getByText("Status: Freigegeben", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Freigegebenen Faktorverlust ausführen" }).click();
  await page.getByText("Status: Neue Anmeldung und MFA erforderlich", { exact: true }).waitFor();
  assert.equal(effects, 1);
  assert.equal(
    await page.getByRole("button", { name: "Freigegebenen Faktorverlust ausführen" }).count(),
    0,
  );
  await page.screenshot({ path: `${output}/recovery-awaiting-${width}.png`, fullPage: true });
  denied = true;
  await page.getByRole("button", { name: "Stand neu laden" }).click();
  await page.getByRole("status").filter({ hasText: "Berechtigung reicht" }).waitFor();
  assert.equal(effects, 1);
  assert.ok(calls.includes("verify") && calls.includes("approve") && calls.includes("execute"));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(overflow, false);
  await page.screenshot({
    path: `${output}/recovery-revoked-operator-${width}.png`,
    fullPage: true,
  });
  await page.unroute("**/api/recovery");
}
