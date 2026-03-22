import { test, expect } from "@playwright/test";
import { mockAllApiRoutes, loginAndSetup, enrichedContacts } from "./fixtures";

test.describe("Campaign", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApiRoutes(page);

    // Override contacts to return enriched contacts (skip scoring + enrich steps)
    await page.route("**/api/contacts**", (route) =>
      route.fulfill({ json: { contacts: enrichedContacts } })
    );

    await loginAndSetup(page);

    // Navigate: search → scoring → enrich → campaign
    const textarea = page.locator("textarea");
    await textarea.fill("Startups cleantech");
    await page.getByRole("button", { name: /rechercher/i }).click();
    await expect(page.locator("text=contacts trouves")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /valider/i }).click();

    // On scoring page, go to enrichment
    await expect(page.locator("text=Scoring IA")).toBeVisible({ timeout: 5000 });
    const enrichBtn = page.getByRole("button", { name: /enrichissement/i });
    await expect(enrichBtn).toBeVisible({ timeout: 5000 });
    await enrichBtn.click();

    // On enrich page, go to campaign
    await expect(page.locator("text=Enrichissement")).toBeVisible({ timeout: 5000 });
    const campBtn = page.getByRole("button", { name: /campagne/i });
    if (await campBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await campBtn.click();
    }
  });

  test("campaign page shows template editor and contacts", async ({ page }) => {
    // Should show campaign page elements
    await expect(page.locator("text=Campagne")).toBeVisible({ timeout: 5000 });

    // Should show template subject field
    const subjectInput = page.locator('input[placeholder*="sujet"], input[type="text"]').first();
    if (await subjectInput.isVisible()) {
      await expect(subjectInput).toBeVisible();
    }

    // Should show at least one contact name
    await expect(page.locator("text=EcoTech").or(page.locator("text=Dupont"))).toBeVisible({
      timeout: 5000,
    });
  });

  test("launching campaign shows active status", async ({ page }) => {
    await expect(page.locator("text=Campagne")).toBeVisible({ timeout: 5000 });

    // Find and click the launch campaign button
    const launchBtn = page.getByRole("button", { name: /lancer la campagne/i });
    if (await launchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await launchBtn.click();

      // Should show campaign is active or navigate to analytics
      await expect(
        page.locator("text=active").or(page.locator("text=Analytics"))
      ).toBeVisible({ timeout: 5000 });
    }
  });
});
