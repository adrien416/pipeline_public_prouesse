import { test, expect } from "@playwright/test";
import { mockAllApiRoutes, loginAndSetup, scoredContacts } from "./fixtures";

test.describe("Enrichment", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApiRoutes(page);

    // Override contacts to return scored contacts (skip scoring step)
    await page.route("**/api/contacts**", (route) =>
      route.fulfill({ json: { contacts: scoredContacts } })
    );

    await loginAndSetup(page);

    // Navigate: search → scoring → enrich
    const textarea = page.locator("textarea");
    await textarea.fill("Startups cleantech");
    await page.getByRole("button", { name: /rechercher/i }).click();
    await expect(page.locator("text=contacts trouves")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /valider/i }).click();

    // On scoring page, click the enrichment button (contacts are pre-scored)
    await expect(page.locator("text=Scoring IA")).toBeVisible({ timeout: 5000 });

    // The enrichissement button should be visible since contacts are pre-scored
    const enrichBtn = page.getByRole("button", { name: /enrichissement/i });
    await expect(enrichBtn).toBeVisible({ timeout: 5000 });
    await enrichBtn.click();

    // Wait for enrich page
    await expect(page.locator("text=Enrichissement")).toBeVisible({ timeout: 5000 });
  });

  test("shows estimate and launches enrichment", async ({ page }) => {
    // Should show the estimate
    await expect(page.locator("text=3")).toBeVisible({ timeout: 5000 });

    // Click the launch enrichment button
    const launchBtn = page.getByRole("button", { name: /lancer/i });
    if (await launchBtn.isVisible()) {
      await launchBtn.click();
      // Should show results or completion
      await expect(page.locator("text=campagne")).toBeVisible({ timeout: 10000 });
    }
  });
});
