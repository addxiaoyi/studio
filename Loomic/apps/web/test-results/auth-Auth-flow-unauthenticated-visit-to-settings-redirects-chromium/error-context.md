# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Auth flow >> unauthenticated visit to /settings redirects
- Location: e2e\auth.spec.ts:30:3

# Error details

```
TimeoutError: page.goto: Timeout 30000ms exceeded.
Call log:
  - navigating to "http://localhost:3000/settings", waiting until "load"

```

# Test source

```ts
  1  | // @e2e — Auth flow smoke tests
  2  | // Verifies the auth pages render and redirect unauthenticated users.
  3  | import { test, expect } from "@playwright/test";
  4  | 
  5  | // /canvas and /home are heavy (large bundles), bump per-test timeout.
  6  | test.setTimeout(90_000);
  7  | 
  8  | test.describe("Auth flow", () => {
  9  |   test("login page renders without auth", async ({ page }) => {
  10 |     await page.goto("/login");
  11 |     // Some title or description text should be visible
  12 |     await expect(page.locator("body")).toBeVisible();
  13 |   });
  14 | 
  15 |   test("register page renders without auth", async ({ page }) => {
  16 |     await page.goto("/register");
  17 |     await expect(page.locator("body")).toBeVisible();
  18 |   });
  19 | 
  20 |   test("unauthenticated visit to /home redirects to /login", async ({ page }) => {
  21 |     await page.goto("/home");
  22 |     await expect(page).toHaveURL(/login/);
  23 |   });
  24 | 
  25 |   test("unauthenticated visit to /canvas redirects", async ({ page }) => {
  26 |     await page.goto("/canvas");
  27 |     await expect(page).toHaveURL(/login/);
  28 |   });
  29 | 
  30 |   test("unauthenticated visit to /settings redirects", async ({ page }) => {
> 31 |     await page.goto("/settings");
     |                ^ TimeoutError: page.goto: Timeout 30000ms exceeded.
  32 |     await expect(page).toHaveURL(/login/);
  33 |   });
  34 | });
  35 | 
```