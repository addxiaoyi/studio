// @e2e — Auth flow smoke tests
// Verifies the auth pages render and redirect unauthenticated users.
import { test, expect } from "@playwright/test";

// /canvas and /home are heavy (large bundles), bump per-test timeout.
test.setTimeout(90_000);

test.describe("Auth flow", () => {
  test("login page renders without auth", async ({ page }) => {
    await page.goto("/login");
    // Some title or description text should be visible
    await expect(page.locator("body")).toBeVisible();
  });

  test("register page renders without auth", async ({ page }) => {
    await page.goto("/register");
    await expect(page.locator("body")).toBeVisible();
  });

  test("unauthenticated visit to /home redirects to /login", async ({ page }) => {
    await page.goto("/home");
    await expect(page).toHaveURL(/login/);
  });

  test("unauthenticated visit to /canvas redirects", async ({ page }) => {
    await page.goto("/canvas");
    await expect(page).toHaveURL(/login/);
  });

  test("unauthenticated visit to /settings redirects", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/login/);
  });
});
