import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createWorkflowFixture } from "../../server/src/features/canvas-workflows/browser-fixture";

test("home polish preserves project actions, readable names and responsive light/dark states", async ({
  page,
}, info) => {
  const database = process.env.DATABASE_URL;
  if (!database)
    throw new Error("Home design regression requires a local database.");
  const fixture = await createWorkflowFixture(
    database,
    "http://localhost:3228",
  );
  try {
    const names = [
      "夏日产品视觉方案 · 电商摄影与品牌叙事",
      "每周内容工作流 · 选题、脚本与多平台发布",
      "品牌资料与设计探索",
    ];
    await fixture.db.query("update canvases set is_primary=true where id=$1", [
      fixture.canvasId,
    ]);
    for (const [index, name] of names.entries()) {
      const project = randomUUID();
      await fixture.db.query(
        "insert into projects(id,workspace_id,created_by,name,slug) values($1,$2,$3,$4,$5)",
        [
          project,
          fixture.workspaceId,
          fixture.userId,
          name,
          `home-design-${index}`,
        ],
      );
      await fixture.db.query(
        "insert into canvases(id,project_id,created_by,name,is_primary) values($1,$2,$3,'主画布',true)",
        [randomUUID(), project, fixture.userId],
      );
    }
    let projectState: "ready" | "empty" | "error" = "ready";
    await page.route(/\/api\/projects(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "GET" || projectState === "ready")
        return route.continue();
      if (projectState === "empty")
        return route.fulfill({ json: { projects: [] } });
      return route.fulfill({
        status: 503,
        json: { error: { message: "项目读取暂时不可用" } },
      });
    });
    await page.route("**/api/home/overview?**", (route) =>
      route.fulfill({
        json: {
          ok: true,
          data: {
            periodDays: 14,
            activeProjects: 4,
            monthlyGenerations: 0,
            teamMembers: 1,
            daily: [],
          },
        },
      }),
    );
    await page.route(/\/api\/credits$/, (route) =>
      route.fulfill({
        json: { balance: 50, totalToppedUp: 50, totalSpent: 0 },
      }),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    async function checkShortcutContrast() {
      const ratios = await page
        .locator(".home-shortcuts > a, .home-shortcuts > button")
        .evaluateAll((cards) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d");
          if (!context)
            throw new Error("Contrast measurement canvas is unavailable");
          const paint = context;
          function luminance(color: string) {
            paint.clearRect(0, 0, 1, 1);
            paint.fillStyle = color;
            paint.fillRect(0, 0, 1, 1);
            const channels = Array.from(paint.getImageData(0, 0, 1, 1).data)
              .slice(0, 3)
              .map((channel) => {
                const value = channel / 255;
                return value <= 0.04045
                  ? value / 12.92
                  : ((value + 0.055) / 1.055) ** 2.4;
              });
            return (
              (channels[0] ?? 0) * 0.2126 +
              (channels[1] ?? 0) * 0.7152 +
              (channels[2] ?? 0) * 0.0722
            );
          }
          return cards.flatMap((card) => {
            const background = luminance(
              getComputedStyle(card).backgroundColor,
            );
            return Array.from(card.querySelectorAll("strong, span")).map(
              (label) => {
                const foreground = luminance(getComputedStyle(label).color);
                return (
                  (Math.max(foreground, background) + 0.05) /
                  (Math.min(foreground, background) + 0.05)
                );
              },
            );
          });
        });
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
    await page.goto("http://localhost:3228/home/");
    await expect(
      page.getByRole("heading", { level: 1, name: "开始今天的 AI 创作" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: `打开项目 ${names[0]}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "新建项目", exact: true }),
    ).toHaveCount(1);
    await checkShortcutContrast();
    await expect(
      page
        .getByRole("navigation", { name: "创作快捷入口" })
        .getByRole("button", { name: /新建画布/ }),
    ).toBeEnabled();
    for (const width of [1440, 768, 320]) {
      await page.setViewportSize({ width, height: 960 });
      const prompt = page.getByRole("textbox", { name: "创作提示词" });
      await prompt.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        await prompt.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
      ).toBeGreaterThanOrEqual(16);
      await page.screenshot({
        path: info.outputPath(`home-light-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await checkShortcutContrast();
    await page.screenshot({
      path: info.outputPath("home-dark-1440.png"),
      fullPage: true,
    });
    await page.evaluate(() =>
      document.documentElement.classList.remove("dark"),
    );
    const project = page.getByRole("link", { name: `打开项目 ${names[0]}` });
    await project.focus();
    await expect(project).toBeFocused();
    await page.getByRole("button", { name: `移到回收站 ${names[0]}` }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(project).toBeVisible();
    projectState = "empty";
    await page.reload();
    await expect(page.getByText("还没有项目", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "新建项目", exact: true }),
    ).toBeEnabled();
    projectState = "error";
    await page.reload();
    await expect(
      page.getByRole("button", { name: "重新加载", exact: true }),
    ).toBeVisible();
    projectState = "ready";
    await page.getByRole("button", { name: "重新加载", exact: true }).click();
    await expect(
      page.getByRole("link", { name: `打开项目 ${names[0]}` }),
    ).toBeVisible();
    expect(
      (await fixture.db.query("select count(*)::int as n from background_jobs"))
        .rows[0].n,
    ).toBe(0);
  } finally {
    await fixture.close();
  }
});
