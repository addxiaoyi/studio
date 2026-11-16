import { expect, test } from "@playwright/test";

const text = "为春季服装设计一张自然光海报，保留真实面料细节。";
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "prompt@example.test",
};

test("built prompt library recovers, paginates, copies and fills Home at mobile width", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let unavailable = true;
  const offsets: number[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = { ok: true, data: [] };
    if (url.pathname === "/api/local-auth/session")
      body = { session: { access_token: "prompt-fixture", user } };
    else if (url.pathname === "/api/viewer")
      body = {
        profile: { ...user, displayName: "Prompt test" },
        workspace: {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Prompt test",
          type: "personal",
          ownerUserId: user.id,
        },
        membership: {
          role: "owner",
          userId: user.id,
          workspaceId: "22222222-2222-4222-8222-222222222222",
        },
        isSystemAdmin: false,
      };
    else if (url.pathname === "/api/prompts") {
      if (unavailable) {
        unavailable = false;
        await route.fulfill({
          status: 503,
          json: { error: "Fixture unavailable" },
        });
        return;
      }
      const offset = Number(url.searchParams.get("offset") ?? 0);
      offsets.push(offset);
      const title = offset === 0 ? "春季服装海报" : "第二页提示词";
      body = {
        ok: true,
        data: [
          { id: title, title, prompt: text, category: "海报", tags: ["服装"] },
        ],
        categories: [{ category: "海报", count: 101 }],
        pagination: { hasMore: offset === 0 },
      };
    } else if (url.pathname === "/api/credits")
      body = { balance: 100, totalToppedUp: 100, totalSpent: 0 };
    else if (url.pathname === "/api/projects") body = { projects: [] };
    else if (url.pathname === "/api/home/overview")
      body = {
        periodDays: 14,
        activeProjects: 0,
        monthlyGenerations: 0,
        teamMembers: 1,
        daily: [],
      };
    else if (url.pathname === "/api/projects/context")
      body = { ok: true, data: null };
    await route.fulfill({ status: 200, json: body });
  });
  await page.goto("/prompts/?pick=1");
  await expect(
    page.getByRole("alert").filter({ hasText: "提示词读取失败" }),
  ).toContainText("503");
  await page.getByRole("button", { name: "重试加载" }).click();
  const card = page.getByRole("article", { name: "春季服装海报" });
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "加载更多提示词" }).click();
  await expect(
    page.getByRole("article", { name: "第二页提示词" }),
  ).toBeVisible();
  expect(offsets).toEqual([0, 100]);
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await card.getByRole("button", { name: "复制提示词" }).click();
  await expect(card.getByRole("status")).toHaveText("已复制提示词");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  await page.screenshot({ path: info.outputPath("prompt-mobile.png") });
  await page.evaluate(() =>
    sessionStorage.setItem(
      "helstera_prompt_return",
      "https://outside.invalid/",
    ),
  );
  await card.getByRole("button", { name: "使用提示词" }).click();
  await expect(page).toHaveURL(/\/home\/$/);
  await expect(page.locator("textarea").first()).toHaveValue(text);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("helstera_selected_prompt"),
    ),
  ).toBeNull();
  expect(errors).toEqual([]);
});
