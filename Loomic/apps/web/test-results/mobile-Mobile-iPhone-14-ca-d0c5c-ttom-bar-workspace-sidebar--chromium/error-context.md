# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mobile.spec.ts >> Mobile (iPhone 14) >> canvas page renders mobile bottom bar (workspace sidebar)
- Location: e2e\mobile.spec.ts:54:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('nav[aria-label=\'Main navigation\']').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('nav[aria-label=\'Main navigation\']').first() with timeout 5000ms
  - waiting for locator('nav[aria-label=\'Main navigation\']').first()

```

```yaml
- complementary "品牌介绍":
  - text: Helstera
  - heading "Welcome back" [level=1]
  - paragraph: Sign in to continue where your workspace left off.
  - list:
    - listitem: Use password, magic link, or Google sign-in
    - listitem: Keep your canvas and workspace state in one place
    - listitem: Move from idea to delivery without switching tools
- main:
  - heading "Welcome back" [level=2]
  - paragraph: Sign in to your workspace
  - text: Email
  - textbox "Email":
    - /placeholder: you@example.com
  - button "发送登录链接": Send login link
  - button "Use password instead"
  - separator
  - text: or
  - separator
  - button "使用 Google 账号继续": Continue with Google
  - paragraph:
    - text: Need an account?
    - link "Create one":
      - /url: /register
- alert
```

# Test source

```ts
  19  |   });
  20  | 
  21  |   test("floating nav mobile menu opens + closes", async ({ page }) => {
  22  |     await page.goto("/");
  23  |     await page.waitForLoadState("networkidle");
  24  |     // On mobile the desktop nav links are hidden; toggle button is present
  25  |     const menuToggle = page.getByRole("button", { name: /toggle menu|菜单/i }).first();
  26  |     if (await menuToggle.count() > 0) {
  27  |       await menuToggle.click();
  28  |       // At least one nav link is now visible
  29  |       await expect(page.getByRole("link", { name: /功能|features/i }).first()).toBeVisible();
  30  |     }
  31  |   });
  32  | 
  33  |   test("pricing region selector is touchable on mobile", async ({ page }) => {
  34  |     await page.goto("/pricing");
  35  |     await page.waitForLoadState("networkidle");
  36  |     // Tap on China region
  37  |     const chinaBtn = page.getByRole("button", { name: /中国大陆.*CNY/ });
  38  |     if (await chinaBtn.count() > 0) {
  39  |       await chinaBtn.first().tap();
  40  |       // Packages remain visible
  41  |       await expect(page.getByText(/选择你的计划/)).toBeVisible();
  42  |     }
  43  |   });
  44  | 
  45  |   test("login form is fully reachable on mobile", async ({ page }) => {
  46  |     await page.goto("/login");
  47  |     await page.waitForLoadState("networkidle");
  48  |     const emailInput = page.getByRole("textbox", { name: /email|邮箱/i }).first();
  49  |     if (await emailInput.count() > 0) {
  50  |       await expect(emailInput).toBeVisible();
  51  |     }
  52  |   });
  53  | 
  54  |   test("canvas page renders mobile bottom bar (workspace sidebar)", async ({ page }) => {
  55  |     // Stub the Supabase session endpoint so AuthContext resolves with a user.
  56  |     // Without this, /home redirects to /login in dev (no real session).
  57  |     await page.route("**/auth/v1/**", (route) => {
  58  |       if (route.request().url().includes("/token")) {
  59  |         return route.fulfill({
  60  |           status: 200,
  61  |           contentType: "application/json",
  62  |           body: JSON.stringify({
  63  |             access_token: "test",
  64  |             token_type: "bearer",
  65  |             expires_in: 3600,
  66  |             refresh_token: "test-refresh",
  67  |             user: { id: "u", email: "u@x.com" },
  68  |           }),
  69  |         });
  70  |       }
  71  |       return route.fulfill({ status: 200, body: "{}" });
  72  |     });
  73  |     // Also stub the viewer API to avoid 401 in workspace bootstrap
  74  |     await page.route("**/api/users/viewer", (route) =>
  75  |       route.fulfill({
  76  |         status: 200,
  77  |         contentType: "application/json",
  78  |         body: JSON.stringify({
  79  |           workspace: { id: "w1", name: "Test" },
  80  |           profile: { id: "u1" },
  81  |           membership: { workspaceId: "w1", userId: "u1", role: "owner" },
  82  |         }),
  83  |       }),
  84  |     );
  85  |     await page.route("**/api/credits", (route) =>
  86  |       route.fulfill({
  87  |         status: 200,
  88  |         contentType: "application/json",
  89  |         body: JSON.stringify({ balance: 100 }),
  90  |       }),
  91  |     );
  92  |     await page.route("**/api/projects", (route) =>
  93  |       route.fulfill({
  94  |         status: 200,
  95  |         contentType: "application/json",
  96  |         body: JSON.stringify({ projects: [] }),
  97  |       }),
  98  |     );
  99  |     // Seed the supabase auth cookie so the browser client thinks we're signed in
  100 |     await page.context().addCookies([
  101 |       {
  102 |         name: "sb-localhost-auth-token",
  103 |         value: JSON.stringify({
  104 |           access_token: "test",
  105 |           refresh_token: "test-refresh",
  106 |           user: { id: "u", email: "u@x.com" },
  107 |           expires_at: Math.floor(Date.now() / 1000) + 3600,
  108 |         }),
  109 |         domain: "localhost",
  110 |         path: "/",
  111 |       },
  112 |     ]);
  113 | 
  114 |     await page.goto("/home");
  115 |     await page.waitForLoadState("networkidle");
  116 | 
  117 |     // Mobile bottom navigation exists
  118 |     const bottomNav = page.locator("nav[aria-label='Main navigation']").first();
> 119 |     await expect(bottomNav).toBeVisible();
      |                             ^ Error: expect(locator).toBeVisible() failed
  120 |   });
  121 | });
  122 | 
```