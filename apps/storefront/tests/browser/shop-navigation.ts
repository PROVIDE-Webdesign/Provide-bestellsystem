import type { Page } from "playwright";

/** Exercise the shipped navigation; never expose hidden panels just for tests. */
export async function openMenu(page: Page) {
  await page
    .getByRole("button", { name: "Speisekarte", exact: true })
    .click({ timeout: 8000 })
    .catch(async (error: unknown) => {
      console.error("Navigation body:", await page.locator("body").innerText());
      throw error;
    });
  await page
    .getByRole("navigation", { name: "Speisekategorien" })
    .getByRole("button")
    .nth(1)
    .click();
}
export async function openCart(page: Page) {
  await page.getByRole("button", { name: /^Warenkorb ·/ }).click();
}
export async function openOrders(page: Page) {
  await page.getByRole("button", { name: "Meine Bestellungen", exact: true }).click();
}
