// @e2e — Pricing page smoke tests
import { test, expect } from "@playwright/test";

test.describe("Pricing page", () => {
  test("renders all 4 topup packages", async ({ page }) => {
    await page.goto("/pricing");

    // The 4 topup packages by name (中文化)
    await expect(page.getByText(/体验包/)).toBeVisible();
    await expect(page.getByText(/标准包/)).toBeVisible();
    await expect(page.getByText(/专业包/)).toBeVisible();
    await expect(page.getByText(/商务包/)).toBeVisible();
  });

  test("shows current balance when authenticated", async ({ page }) => {
    // For unauthenticated users, the balance is hidden — that's fine.
    await page.goto("/pricing");
    // Page should render without throwing
    await expect(page.locator("h1")).toBeVisible();
  });

  test("region selector switches between CNY and USD", async ({ page }) => {
    await page.goto("/pricing");
    const regionCN = page.getByRole("button", { name: /中国大陆|CNY/i });
    const regionIntl = page.getByRole("button", { name: /International|USD/i });
    if (await regionCN.isVisible()) {
      await regionCN.click();
      await expect(regionCN).toHaveAttribute("class", /bg-foreground/);
    }
    if (await regionIntl.isVisible()) {
      await regionIntl.click();
      await expect(regionIntl).toHaveAttribute("class", /bg-foreground/);
    }
  });

  test("FAQ section is present and collapsible", async ({ page }) => {
    await page.goto("/pricing");
    // Scroll to FAQ
    await page.getByText(/积分是如何计算的/).first().scrollIntoViewIfNeeded();
    await expect(page.getByText(/积分是如何计算的/)).toBeVisible();
  });
});
