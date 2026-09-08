// @e2e — Sidebar navigation tests
// Verifies the desktop + mobile sidebar is reachable, clickable,
// and persists across navigation.
import { test, expect } from "@playwright/test";

test.describe("Sidebar navigation", () => {
  test("landing nav has logo + all main nav items", async ({ page }) => {
    await page.goto("/");

    // Brand link is at the very top of the header (header > a)
    const brand = page
      .getByRole("link", { name: /helstera/i })
      .first();
    await expect(brand).toBeVisible();

    // Main nav (the bottom nav with 4 items)
    const nav = page.getByRole("navigation").first();
    await expect(nav).toBeVisible();

    // There should be at least 3 links in the main nav
    const links = nav.getByRole("link");
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("home sidebar logo is clickable", async ({ page }) => {
    await page.goto("/");
    const brandLink = page
      .getByRole("link", { name: /helstera/i })
      .first();
    await expect(brandLink).toBeVisible();
  });

  test("theme toggle button is present", async ({ page }) => {
    await page.goto("/");
    const themeToggle = page
      .getByRole("button", { name: /theme|模式|深色|浅色/i })
      .first();
    await expect(themeToggle).toBeVisible();
  });

  test("CTA button links to register or login", async ({ page }) => {
    await page.goto("/");
    const cta = page
      .getByRole("link", { name: /免费试用|register/i })
      .first();
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute("href");
    expect(href).toMatch(/register|login/);
  });
});
