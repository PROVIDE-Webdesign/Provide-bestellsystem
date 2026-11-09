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
  const categories = page.getByRole("navigation", { name: "Speisekategorien" }).getByRole("button");
  await categories.first().waitFor();
  const regular = categories.filter({ hasNotText: /^Beliebt$/ });
  if (await regular.count()) await regular.first().click();
}
export async function openCart(page: Page) {
  const basket = page.getByRole("button", { name: /^Warenkorb ·/ });
  const cart = page.getByRole("complementary", { name: /^\d+ Gerichte$/ });
  await cart.or(basket).first().waitFor();
  if (await cart.isVisible()) return;
  await basket.click({ timeout: 3000 }).catch(async (error: unknown) => {
    if (!(await cart.isVisible())) throw error;
  });
}
export async function openOrders(page: Page) {
  await page.getByRole("button", { name: "Meine Bestellungen", exact: true }).click();
}
