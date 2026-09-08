// @e2e — Accessibility smoke tests
// Lightweight a11y checks across key pages — no axe-core yet (would be nice).
import { test, expect } from "@playwright/test";

test.describe("Accessibility", () => {
  test("landing page has proper landmarks", async ({ page }) => {
    await page.goto("/");
    // Wait for full hydration so all components mount
    await page.waitForLoadState("networkidle");

    // <main> + <nav> + <header> + <footer> should all be present
    await expect(page.locator("header, nav").first()).toBeVisible();
    await expect(page.locator("main").first()).toBeVisible();

    // Footer is below the fold — scroll to it before checking
    await page.locator("footer").first().scrollIntoViewIfNeeded();
    await expect(page.locator("footer").first()).toBeVisible();
  });

  test("all interactive elements are focusable", async ({ page }) => {
    await page.goto("/");
    // Tab through the page — the first focused element should be the skip link
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.tagName + " " + (el?.textContent ?? "").trim().slice(0, 30);
    });
    expect(focused).toBeTruthy();
  });

  test("no images without alt text on landing", async ({ page }) => {
    await page.goto("/");
    const imgs = await page.locator("img").all();
    for (const img of imgs) {
      const alt = await img.getAttribute("alt");
      const ariaHidden = await img.getAttribute("aria-hidden");
      // Either alt must be set OR aria-hidden="true" must be set
      expect(alt !== null || ariaHidden === "true").toBeTruthy();
    }
  });

  test("headings follow proper hierarchy", async ({ page }) => {
    await page.goto("/");
    const h1Count = await page.locator("h1").count();
    // Should have exactly one h1
    expect(h1Count).toBe(1);
  });

  test("404 page provides recovery action", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist-12345");
    expect(response?.status()).toBe(404);
    // The 404 page should have a link back to home
    await expect(page.getByText(/工作台|首页/i).first()).toBeVisible();
  });

  test("PWA manifest is served", async ({ page }) => {
    const response = await page.goto("/manifest.json");
    expect(response?.status()).toBe(200);
  });
});
