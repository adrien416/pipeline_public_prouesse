import { test, expect } from "@playwright/test";
import { mockAllApiRoutes, loginAndSetup } from "./fixtures";

test.describe("Scoring", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApiRoutes(page);
    await loginAndSetup(page);

    // Navigate through search to reach scoring
    const textarea = page.locator("textarea");
    await textarea.fill("Startups cleantech");
    await page.getByRole("button", { name: /rechercher/i }).click();
    await expect(page.locator("text=contacts trouves")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /valider/i }).click();
    await expect(page.locator("text=Scoring IA")).toBeVisible({ timeout: 5000 });
  });

  test("launch scoring shows progress and scores", async ({ page }) => {
    // Click launch scoring button
    await page.getByRole("button", { name: /lancer le scoring/i }).click();

    // Should show "Scoring en cours" state
    await expect(page.getByRole("button", { name: /scoring en cours/i })).toBeVisible({ timeout: 3000 });

    // Wait for scoring to complete (the mock returns done:false then done:true)
    // The polling interval is 13s — use clock fast-forward
    // Note: clock API may not work in all Playwright versions, so we use a generous timeout
    await expect(
      page.locator("text=Enrichissement")
    ).toBeVisible({ timeout: 30000 });

    // Scores should appear in the table
    await expect(page.locator("text=7")).toBeVisible();
  });
});
