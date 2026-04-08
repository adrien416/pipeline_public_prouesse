import { test, expect } from "@playwright/test";
import { mockAllApiRoutes } from "./fixtures";

test.describe("Login", () => {
  test("happy path — login redirects to search page", async ({ page }) => {
    // Mock credits to return 401 initially (forces login page)
    await page.route("**/api/credits", (route) =>
      route.fulfill({ status: 401, json: { error: "Unauthorized" } })
    );
    await page.route("**/api/login", (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "auth_token=fake-jwt; Path=/; HttpOnly",
        },
        body: JSON.stringify({ ok: true }),
      })
    );

    await page.goto("/");

    // Login page should be visible
    await expect(page.locator("text=Prouesse Pipeline")).toBeVisible();
    await expect(page.locator("text=Se connecter")).toBeVisible();

    // Fill form
    await page.getByPlaceholder("votre@email.com").fill("votre@email.com");
    await page.locator('input[type="password"]').fill("testpassword");

    // After login, credits should succeed
    await page.route("**/api/credits", (route) =>
      route.fulfill({ json: { balance: 5000 } })
    );

    await page.getByRole("button", { name: /connecter/i }).click();

    // Should see the search tab
    await expect(page.locator("text=1. Recherche")).toBeVisible({ timeout: 5000 });
  });

  test("error — shows red error message on bad credentials", async ({ page }) => {
    await page.route("**/api/credits", (route) =>
      route.fulfill({ status: 401, json: { error: "Unauthorized" } })
    );
    await page.route("**/api/login", (route) =>
      route.fulfill({ status: 401, json: { error: "Email ou mot de passe incorrect" } })
    );

    await page.goto("/");

    await page.getByPlaceholder("votre@email.com").fill("wrong@email.com");
    await page.locator('input[type="password"]').fill("wrongpassword");
    await page.getByRole("button", { name: /connecter/i }).click();

    // Error message should appear
    await expect(page.locator(".text-red-600")).toBeVisible({ timeout: 3000 });
    await expect(page.locator(".text-red-600")).toContainText("incorrect");

    // Login form should still be visible (not redirected)
    await expect(page.getByRole("button", { name: /connecter/i })).toBeVisible();
  });
});
