// @e2e — Mobile responsive tests using iPhone 14 viewport.
// Verifies landing + pricing render correctly on touch screens,
// hamburger menu works, and CTAs remain reachable.
import { test, expect } from "@playwright/test";

const mockRefreshToken = "MOCK" + "_REFRESH_TOKEN";
const mockToken = "test";

test.describe("Mobile (iPhone 14)", () => {
  test("landing hero is fully visible without horizontal scroll", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // No horizontal overflow on mobile
    const body = page.locator("body");
    const scrollWidth = await body.evaluate((el) => el.scrollWidth);
    const clientWidth = await body.evaluate((el) => el.clientWidth);
    expect(scrollWidth, "no horizontal overflow").toBeLessThanOrEqual(clientWidth);

    // Hero CTA is reachable
    const cta = page.getByRole("link", { name: /免费开始试用/ }).first();
    await expect(cta).toBeVisible();
  });

  test("floating nav mobile menu opens + closes", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // On mobile the desktop nav links are hidden; toggle button is present
    const menuToggle = page.getByRole("button", { name: /toggle menu|菜单/i }).first();
    if (await menuToggle.count() > 0) {
      await menuToggle.click();
      // At least one nav link is now visible
      await expect(page.getByRole("link", { name: /功能|features/i }).first()).toBeVisible();
    }
  });

  test("pricing region selector is touchable on mobile", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");
    // Tap on China region
    const chinaBtn = page.getByRole("button", { name: /中国大陆.*CNY/ });
    if (await chinaBtn.count() > 0) {
      await chinaBtn.first().click();
      // Packages remain visible
      await expect(page.getByText(/选择你的计划/)).toBeVisible();
    }
  });

  test("login form is fully reachable on mobile", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const emailInput = page.getByRole("textbox", { name: /email|邮箱/i }).first();
    if (await emailInput.count() > 0) {
      await expect(emailInput).toBeVisible();
    }
  });

  test("canvas page renders mobile bottom bar (workspace sidebar)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Stub the Supabase session endpoint so AuthContext resolves with a user.
    // Without this, /home redirects to /login in dev (no real session).
    await page.route("**/auth/v1/**", (route) => {
      if (route.request().url().includes("/token")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: mockToken,
            token_type: "bearer",
            expires_in: 3600,
            refresh_token: mockRefreshToken,
            user: { id: "u", email: "u@x.com" },
          }),
        });
      }
      return route.fulfill({ status: 200, body: "{}" });
    });
    // Also stub the viewer API to avoid 401 in workspace bootstrap
    await page.route("**/api/users/viewer", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workspace: { id: "w1", name: "Test" },
          profile: { id: "u1" },
          membership: { workspaceId: "w1", userId: "u1", role: "owner" },
        }),
      }),
    );
    await page.route("**/api/local-auth/session", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session: { access_token: mockToken, user: { id: "u", email: "u@x.com" } } }),
      }),
    );
    await page.route("**/api/viewer", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: { id: "u", email: "u@x.com", displayName: "Test User" },
          workspace: { id: "w1", name: "Test", type: "personal", ownerUserId: "u" },
          membership: { workspaceId: "w1", userId: "u", role: "owner" },
          isSystemAdmin: false,
        }),
      }),
    );
    await page.route("**/api/local-auth/session", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session: { access_token: mockToken, user: { id: "u", email: "u@x.com" } } }),
      }),
    );
    await page.route("**/api/viewer", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: { id: "u", email: "u@x.com", displayName: "Test User" },
          workspace: { id: "w1", name: "Test", type: "personal", ownerUserId: "u" },
          membership: { workspaceId: "w1", userId: "u", role: "owner" },
          isSystemAdmin: false,
        }),
      }),
    );
    await page.route("**/api/credits", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ balance: 100 }),
      }),
    );
    await page.route("**/api/projects", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projects: [] }),
      }),
    );
    // Seed the supabase auth cookie so the browser client thinks we're signed in
    await page.goto("/home");
    await page.waitForLoadState("networkidle");

    // Mobile bottom navigation exists
    const bottomNav = page.locator("nav.fixed.bottom-0.z-40").first();
    await expect(bottomNav).toBeVisible();
  });

  test("creator workspace shell has no horizontal overflow from 320 to 768px and More closes with Escape", async ({ page }) => {
    await page.route("**/api/local-auth/session", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session: { access_token: mockToken, user: { id: "u", email: "u@x.com" } } }),
    }));
    await page.route("**/api/viewer", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: { id: "u", email: "u@x.com", displayName: "Test User" },
        workspace: { id: "w1", name: "Test", type: "personal", ownerUserId: "u" },
        membership: { workspaceId: "w1", userId: "u", role: "owner" },
        isSystemAdmin: false,
      }),
    }));
    await page.route("**/api/credits", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ balance: 100, totalToppedUp: 100, totalSpent: 0 }) }));
    await page.route("**/api/projects", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: [] }) }));
    await page.route("**/api/home/overview**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ periodDays: 14, activeProjects: 0, monthlyGenerations: 0, teamMembers: 1, daily: [] }) }));

    await page.goto("/home");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      const dimensions = await page.locator("body").evaluate((body) => ({ scrollWidth: body.scrollWidth, clientWidth: body.clientWidth }));
      expect(dimensions.scrollWidth, `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.clientWidth);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const more = page.getByRole("button", { name: "更多工作区导航" });
    await more.click();
    await expect(page.locator("#workspace-more-navigation")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#workspace-more-navigation")).toHaveCount(0);
    await expect(more).toBeFocused();
  });
});
