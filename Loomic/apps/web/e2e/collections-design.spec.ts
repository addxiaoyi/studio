import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createWorkflowFixture } from "../../server/src/features/canvas-workflows/browser-fixture";

test("project and asset polish preserves searches, selection and recovery across sizes", async ({
  page,
}, info) => {
  const database = process.env.DATABASE_URL;
  if (!database)
    throw new Error("Collection design regression requires a local database.");
  const fixture = await createWorkflowFixture(
    database,
    "http://localhost:3228",
  );
  try {
    const names = [
      "夏日产品视觉方案 · 电商摄影与品牌叙事",
      "每周内容工作流 · 选题与脚本整理",
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
          `collections-design-${index}`,
        ],
      );
      await fixture.db.query(
        "insert into canvases(id,project_id,created_by,name,is_primary) values($1,$2,$3,'主画布',true)",
        [randomUUID(), project, fixture.userId],
      );
    }
    await page.route(/\/api\/credits$/, (route) =>
      route.fulfill({
        json: { balance: 50, totalToppedUp: 50, totalSpent: 0 },
      }),
    );
    await page.route(/\/api\/viewer$/, (route) =>
      route.fulfill({
        json: {
          profile: {
            id: fixture.userId,
            email: "design@test.invalid",
            displayName: "Design preview",
            avatarUrl: null,
          },
          workspace: {
            id: fixture.workspaceId,
            name: "Design preview",
            type: "personal",
            ownerUserId: fixture.userId,
          },
          membership: {
            workspaceId: fixture.workspaceId,
            userId: fixture.userId,
            role: "owner",
          },
        },
      }),
    );
    const preview = await readFile(
      new URL("../public/images/showcase/showcase-9.jpg", import.meta.url),
    );
    const assets = [
      {
        id: randomUUID(),
        title: "夏日产品画面 · 自然光与品牌色探索",
        media_type: "image",
        mime_type: "image/jpeg",
      },
      {
        id: randomUUID(),
        title: "品牌发布短片 · 开场镜头与字幕版本",
        media_type: "video",
        mime_type: "video/mp4",
      },
      {
        id: randomUUID(),
        title: "工作流参考图 · 商品细节与场景",
        media_type: "image",
        mime_type: "image/jpeg",
      },
    ].map((asset) => ({
      ...asset,
      asset_object_id: randomUUID(),
      description: null,
      prompt: "Local design fixture",
      created_at: new Date().toISOString(),
      published: false,
      retention_state: "active",
      retention_until: new Date(Date.now() + 3 * 86400000).toISOString(),
    }));
    await page.route("**/api/assets/history?**", (route) => {
      const query = new URL(route.request().url()).searchParams;
      const needle = query.get("q") ?? "";
      const rows =
        query.get("includeDeleted") === "1"
          ? []
          : assets.filter(
              (asset) =>
                (!query.get("mediaType") ||
                  asset.media_type === query.get("mediaType")) &&
                asset.title.includes(needle),
            );
      return route.fulfill({
        json: {
          data: rows,
          pagination: {
            page: 1,
            pageSize: 12,
            total: rows.length,
            hasMore: false,
          },
        },
      });
    });
    await page.route("**/api/uploads/*/file?preview=1", (route) =>
      route.fulfill({ contentType: "image/jpeg", body: preview }),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("http://localhost:3228/projects/");
    await expect(
      page.getByRole("link", { name: `打开项目 ${names[0]}` }),
    ).toBeVisible();
    for (const width of [1440, 768, 320]) {
      await page.setViewportSize({ width, height: 960 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`projects-${width}.png`),
        fullPage: true,
      });
    }
    const search = page.getByRole("searchbox", { name: "搜索项目名称或描述" });
    await search.fill("不存在的项目");
    await expect(
      page.getByText("没有匹配的项目", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "清除搜索", exact: true }).click();
    await expect(
      page.getByRole("link", { name: `打开项目 ${names[0]}` }),
    ).toBeVisible();
    await page.goto("http://localhost:3228/assets/");
    await expect(
      page.getByRole("heading", { name: assets[0]?.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /在画布中编辑 夏日产品画面/ }),
    ).toBeEnabled();
    for (const width of [1440, 768, 320]) {
      await page.setViewportSize({ width, height: 960 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`assets-${width}.png`),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "视频", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: assets[1]?.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: assets[0]?.title, exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("searchbox", { name: "搜索资产标题或提示词" })
      .fill("不存在的资产");
    await expect(
      page.getByRole("heading", { name: "没有匹配的资产", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: assets[0]?.title, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "全选本页", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "资产批量操作" }),
    ).toContainText("已选 3 项");
    await page.getByRole("button", { name: "查看恢复区", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "恢复区暂无资产", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "返回我的资产", exact: true })
      .last()
      .click();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await expect(
      page.getByRole("heading", { name: assets[0]?.title, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("assets-dark-1440.png"),
      fullPage: true,
    });
    expect(
      (await fixture.db.query("select count(*)::int as n from background_jobs"))
        .rows[0].n,
    ).toBe(0);
  } finally {
    await fixture.close();
  }
});
