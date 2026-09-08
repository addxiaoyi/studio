# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mobile.spec.ts >> Mobile (iPhone 14) >> pricing region selector is touchable on mobile
- Location: e2e\mobile.spec.ts:33:3

# Error details

```
Error: locator.tap: The page does not support tap. Use hasTouch context option to enable touch support.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - navigation [ref=e4]:
        - link "Helstera" [ref=e5] [cursor=pointer]:
          - /url: /
        - generic [ref=e8]:
          - link "登录" [ref=e9] [cursor=pointer]:
            - /url: /login
          - link "免费开始" [ref=e10] [cursor=pointer]:
            - /url: /register
    - main [ref=e11]:
      - generic [ref=e12]:
        - generic [ref=e13]: 积分充值
        - heading "用多少买多少，永久有效" [level=1] [ref=e14]
        - paragraph [ref=e15]: 一次性购买积分，永久有效。所有 AI 模型通用，模型差异化定价，按需使用不浪费。
        - generic [ref=e16]:
          - generic [ref=e17]: 无月费
          - generic [ref=e21]: 永不过期
          - generic [ref=e25]: 30 天可退
          - generic [ref=e29]: 所有 AI 模型
      - generic [ref=e33]:
        - generic [ref=e35]:
          - button "🌐 International (USD)" [ref=e36]
          - button "🇨🇳 中国大陆 (CNY)" [ref=e37]
        - generic [ref=e39]:
          - generic [ref=e40]:
            - paragraph [ref=e41]: 按需充值
            - heading "简单透明的积分充值" [level=2] [ref=e42]
            - paragraph [ref=e43]: 没有订阅、没有月费。一次性购买积分，永久有效，按使用量消耗。 当前余额：0 积分
          - generic [ref=e44]:
            - generic [ref=e45]:
              - heading "体验包" [level=3] [ref=e46]
              - generic [ref=e47]: ¥50一次付费
              - generic [ref=e48]:
                - generic [ref=e49]: "500"
                - generic [ref=e50]: 积分
              - paragraph [ref=e51]: 合计到账 500 积分 · 永久有效
              - button "登录后充值" [ref=e52]
              - list [ref=e54]:
                - listitem [ref=e55]:
                  - generic [ref=e58]: 永不过期
                - listitem [ref=e59]:
                  - generic [ref=e62]: 支持所有 AI 模型
                - listitem [ref=e63]:
                  - generic [ref=e66]: 30 天内未使用可退
            - generic [ref=e67]:
              - generic [ref=e68]: 推荐
              - heading "标准包" [level=3] [ref=e70]
              - generic [ref=e71]: ¥200一次付费
              - generic [ref=e72]:
                - generic [ref=e73]: 2,000
                - generic [ref=e74]: 积分
                - generic [ref=e75]: 200 加赠
              - paragraph [ref=e77]: 合计到账 2,200 积分 · 永久有效
              - button "登录后充值" [ref=e78]
              - list [ref=e80]:
                - listitem [ref=e81]:
                  - generic [ref=e84]: 永不过期
                - listitem [ref=e85]:
                  - generic [ref=e88]: 支持所有 AI 模型
                - listitem [ref=e89]:
                  - generic [ref=e92]: 30 天内未使用可退
            - generic [ref=e93]:
              - generic [ref=e94]: 最划算
              - heading "专业包" [level=3] [ref=e99]
              - generic [ref=e100]: ¥500一次付费
              - generic [ref=e101]:
                - generic [ref=e102]: 5,500
                - generic [ref=e103]: 积分
                - generic [ref=e104]: 500 加赠
              - paragraph [ref=e106]: 合计到账 6,000 积分 · 永久有效
              - button "登录后充值" [ref=e107]
              - list [ref=e109]:
                - listitem [ref=e110]:
                  - generic [ref=e113]: 永不过期
                - listitem [ref=e114]:
                  - generic [ref=e117]: 支持所有 AI 模型
                - listitem [ref=e118]:
                  - generic [ref=e121]: 30 天内未使用可退
            - generic [ref=e122]:
              - heading "商务包" [level=3] [ref=e123]
              - generic [ref=e124]: ¥1,000一次付费
              - generic [ref=e125]:
                - generic [ref=e126]: 11,500
                - generic [ref=e127]: 积分
                - generic [ref=e128]: 500 加赠
              - paragraph [ref=e130]: 合计到账 12,000 积分 · 永久有效
              - button "登录后充值" [ref=e131]
              - list [ref=e133]:
                - listitem [ref=e134]:
                  - generic [ref=e137]: 永不过期
                - listitem [ref=e138]:
                  - generic [ref=e141]: 支持所有 AI 模型
                - listitem [ref=e142]:
                  - generic [ref=e145]: 30 天内未使用可退
      - generic [ref=e147]:
        - generic [ref=e148]:
          - paragraph [ref=e149]: 为什么选择按量付费
          - heading "没有月费 · 没有锁定" [level=2] [ref=e150]
        - generic [ref=e151]:
          - generic [ref=e152]:
            - heading "用多少算多少" [level=3] [ref=e155]
            - paragraph [ref=e156]: 模型差异化定价：图片 5-12 积分/张，视频 40-60 积分/5s。
          - generic [ref=e157]:
            - heading "无自动扣费" [level=3] [ref=e160]
            - paragraph [ref=e161]: 积分用完才提醒，永不悄悄扣款。
          - generic [ref=e162]:
            - heading "永久有效" [level=3] [ref=e166]
            - paragraph [ref=e167]: 30 天内未使用可全额退款，0 过期焦虑。
      - generic [ref=e168]:
        - generic [ref=e169]:
          - text: FAQ
          - heading "常见问题" [level=2] [ref=e170]
          - paragraph [ref=e171]: 关于 Helstera 方案、计费与安全的常见问题
        - generic [ref=e172]:
          - generic [ref=e173]:
            - button "积分是如何计算的？" [ref=e174] [cursor=pointer]
            - paragraph [ref=e180]: 不同模型、不同分辨率消耗不同积分。图片约 5-12 积分/张（HD/4K 加成），视频约 40-60 积分/5s 基础（按分辨率和时长累加）。
          - button "未使用的积分会过期吗？" [ref=e182] [cursor=pointer]
          - button "30 天内未使用可以退款吗？" [ref=e188] [cursor=pointer]
          - button "支持哪些支付方式？" [ref=e194] [cursor=pointer]
          - button "积分可以转让给其他工作区吗？" [ref=e200] [cursor=pointer]
          - button "不同模型消耗积分差异大吗？" [ref=e206] [cursor=pointer]
          - button "购买后多久到账？" [ref=e212] [cursor=pointer]
          - button "可以开具发票吗？" [ref=e218] [cursor=pointer]
  - button "Open Next.js Dev Tools" [ref=e228] [cursor=pointer]
  - alert [ref=e232]
```

# Test source

```ts
  1   | // @e2e — Mobile responsive tests using iPhone 14 viewport.
  2   | // Verifies landing + pricing render correctly on touch screens,
  3   | // hamburger menu works, and CTAs remain reachable.
  4   | import { test, expect } from "@playwright/test";
  5   | 
  6   | test.describe("Mobile (iPhone 14)", () => {
  7   |   test("landing hero is fully visible without horizontal scroll", async ({ page }) => {
  8   |     await page.goto("/");
  9   |     await page.waitForLoadState("networkidle");
  10  |     // No horizontal overflow on mobile
  11  |     const body = page.locator("body");
  12  |     const scrollWidth = await body.evaluate((el) => el.scrollWidth);
  13  |     const clientWidth = await body.evaluate((el) => el.clientWidth);
  14  |     expect(scrollWidth, "no horizontal overflow").toBeLessThanOrEqual(clientWidth);
  15  | 
  16  |     // Hero CTA is reachable
  17  |     const cta = page.getByRole("link", { name: /免费开始试用/ }).first();
  18  |     await expect(cta).toBeVisible();
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
> 39  |       await chinaBtn.first().tap();
      |                              ^ Error: locator.tap: The page does not support tap. Use hasTouch context option to enable touch support.
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
  119 |     await expect(bottomNav).toBeVisible();
  120 |   });
  121 | });
  122 | 
```