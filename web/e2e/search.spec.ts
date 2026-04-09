import { test, expect } from "@playwright/test";
import { mockAllApiRoutes, loginAndSetup, mockContacts } from "./fixtures";

test.describe("Search", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApiRoutes(page);
    await loginAndSetup(page);
  });

  test("fill form and submit shows results table", async ({ page }) => {
    // Fill search form
    const textarea = page.locator("textarea");
    await textarea.fill("Startups cleantech en France avec impact environnemental");

    // Click search button
    await page.getByRole("button", { name: /rechercher/i }).click();

    // Wait for results to appear
    await expect(page.locator("text=contacts trouves")).toBeVisible({ timeout: 5000 });

    // Results table should show contact names
    for (const c of mockContacts) {
      await expect(page.locator(`text=${c.entreprise}`)).toBeVisible();
    }

    // "Valider et passer au scoring" button should be visible
    await expect(
      page.getByRole("button", { name: /valider/i })
    ).toBeVisible();
  });

  test("clicking Valider navigates to scoring tab", async ({ page }) => {
    const textarea = page.locator("textarea");
    await textarea.fill("Startups cleantech");
    await page.getByRole("button", { name: /rechercher/i }).click();

    await expect(page.locator("text=contacts trouves")).toBeVisible({ timeout: 5000 });

    // Click validate
    await page.getByRole("button", { name: /valider/i }).click();

    // Should navigate to scoring page
    await expect(page.locator("text=Scoring IA")).toBeVisible({ timeout: 5000 });
  });
});
