// @e2e — Landing page smoke tests
// Verifies the marketing page renders, has correct meta, and CTAs work.
import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("renders hero with brand name and CTA", async ({ page }) => {
    await page.goto("/");

    // Hero h1
    const hero = page.getByRole("heading", { level: 1 });
    await expect(hero).toBeVisible();

    // Brand badge is in the header nav
    const brand = page.getByRole("link", { name: /helstera/i }).first();
    await expect(brand).toBeVisible();

    // Primary CTA is reachable
    const cta = page.getByRole("link", { name: /免费开始试用|register/i }).first();
    await expect(cta).toBeVisible();
  });

  test("navigation links scroll to anchors", async ({ page }) => {
    await page.goto("/");
    // Click features link
    await page.getByRole("link", { name: "功能" }).first().click();
    // URL hash should update
    await expect(page).toHaveURL(/[#?]features/);
  });

  test("has correct meta title and description", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Helstera/);
    const metaDescription = page.locator('meta[name="description"]');
    await expect(metaDescription).toHaveAttribute("content", /Helstera/);
  });

  test("no console errors during initial load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    // Capture which URLs are 404-ing so we can include them in the filter
    const failedUrls: string[] = [];
    page.on("response", (res) => {
      if (res.status() === 404) failedUrls.push(res.url());
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Filter out known noise:
    //   - favicon / Manifest — common browser 404s when not in dev
    //   - /api/metrics — telemetry endpoint not wired in dev (logged as
    //     generic "Failed to load resource" without the URL, so we
    //     filter by checking if the only 404s observed were the expected ones)
    const allFailedAreExpected = failedUrls.every(
      (url) =>
        url.includes("favicon") ||
        url.includes("manifest") ||
        url.includes("/api/metrics"),
    );
    if (!allFailedAreExpected && failedUrls.length > 0) {
      console.error("Unexpected 404 URLs:", failedUrls.join("\n"));
    }
    const real = errors.filter(
      (e) =>
        // The generic "Failed to load resource: 404" entry doesn't include
        // the URL, so we rely on the allFailedAreExpected flag above.
        !e.includes("favicon") &&
        !e.includes("Manifest") &&
        !(e.includes("404 (Not Found)") && allFailedAreExpected),
    );
    expect(real).toEqual([]);
  });
});
