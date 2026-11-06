import type { Page } from "playwright";
export async function menuTool(page: Page, action: string) {
  const tools = page.locator("details.menu-tools");
  if ((await tools.getAttribute("open")) === null)
    await page.getByLabel("Speisekarten-Werkzeuge").click();
  await tools.getByRole("button", { name: action, exact: true }).click();
}
export async function openMenuList(page: Page) {
  const back = page.getByRole("button", { name: "‹ Zur Speisekarte", exact: true });
  if (await back.count()) await back.click();
}
export async function openMenuPublish(page: Page) {
  await openMenuList(page);
  await page.getByRole("button", { name: /^Änderungen prüfen/ }).click();
}
export async function editMenuItem(page: Page, name: string) {
  await openMenuList(page);
  await page.getByRole("button", { name: name + " bearbeiten", exact: true }).click();
}
