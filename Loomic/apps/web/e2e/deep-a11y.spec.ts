// @e2e — Deep accessibility audit using @axe-core/playwright.
// WCAG 2.1 AA + best practices across the public marketing pages.
import { test, expect } from "@playwright/test";
import { auditA11y } from "./helpers/a11y";

test.describe("Deep accessibility (WCAG 2.1 AA)", () => {
  test("landing page has no a11y violations", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Exclude the hero mockup cursor (decorative animated element)
    await auditA11y(page, { exclude: ["[data-cta-delay]"] });
  });

  test("pricing page has no a11y violations", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");
    await auditA11y(page);
  });

  test("login page has no a11y violations", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await auditA11y(page);
  });

  test("register page has no a11y violations", async ({ page }) => {
    await page.goto("/register");
    await page.waitForLoadState("networkidle");
    await auditA11y(page);
  });

  test("contact-sales page has no a11y violations", async ({ page }) => {
    await page.goto("/contact-sales");
    // Wait extra time for full client hydration of motion components
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    // Debug: verify h1 is present
    const h1Count = await page.locator("h1").count();
    if (h1Count === 0) {
      const bodyHTML = await page.locator("body").innerHTML();
      console.log("[debug] h1 not found. body sample:", bodyHTML.slice(0, 500));
    }
    expect(h1Count, "page should have h1").toBeGreaterThan(0);
    await auditA11y(page);
  });
});
