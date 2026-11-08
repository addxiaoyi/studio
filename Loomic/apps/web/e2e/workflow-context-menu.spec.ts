import {
  test,
  expect,
  _electron,
  type ElectronApplication,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { websiteWorkflow } from "@helstera/shared";
import { CanvasWorkflowService } from "../../server/src/features/canvas-workflows/service";
import { createWorkflowFixture } from "../../server/src/features/canvas-workflows/browser-fixture";
import { projectWorkflow } from "../src/components/workflow/scene";

test("node menu prioritizes editing and AI, isolates floating panels and supports keyboard", async ({
  page,
}, info) => {
  const fixture = await createWorkflowFixture(
    process.env.DATABASE_URL!,
    "http://localhost:3228",
  );
  const folder = await mkdtemp(join(tmpdir(), "workflow-menu-"));
  let desktop: ElectronApplication | undefined;
  try {
    const graph = websiteWorkflow();
    graph.nodes.forEach((node, index) => {
      node.position = { x: 460 + index * 340, y: 180 };
    });
    const flow = await new CanvasWorkflowService(fixture.db).create(
      fixture.userId,
      fixture.canvasId,
      graph,
      randomUUID(),
    );
    await fixture.db.query(
      "update canvases set content=$2::jsonb where id=$1",
      [
        fixture.canvasId,
        JSON.stringify({
          elements: projectWorkflow([], flow.id, graph, {}, false),
          appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } },
          files: {},
        }),
      ],
    );
    if (process.env.HELT_TEST_CANDIDATE_PATH) {
      const env = {
        ...process.env,
        HELSTERA_ISOLATED_TEST: "1",
        HELSTERA_TEST_USER_DATA: folder,
        HELSTERA_DESKTOP_LOCAL_URL: "http://localhost:3228",
      };
      delete env.ELECTRON_RUN_AS_NODE;
      desktop = await _electron.launch({
        executablePath: process.env.HELT_TEST_CANDIDATE_PATH,
        env: env as Record<string, string>,
        timeout: 45000,
      });
      page = await desktop.firstWindow();
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(
      `http://localhost:3228/${desktop ? "desktop-app/" : ""}canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`,
    );
    const dock = page.getByRole("region", {
      name: "可视化工作流",
      exact: true,
    });
    await page.getByRole("button", { name: "打开可视化工作流" }).click();
    await expect(
      dock.getByRole("button", { name: /网址输入 目标网址/ }),
    ).toBeVisible();
    await dock.getByRole("button", { name: "收起流程面板" }).click();
    const node = page.locator('[data-workflow-node="site"]');
    const openMenu = async () => {
      const box = (await node.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + 45, {
        button: "right",
      });
    };
    await openMenu();
    const menu = page.getByRole("menu", { name: "节点操作" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText([
      "编辑节点",
      "让 AI 修改",
      "连接下一步",
      "添加后续节点",
    ]);
    await expect(page.locator(".context-menu")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await page.keyboard.press("Shift+F10");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(
      dock.getByRole("textbox", { name: "让 AI 帮你搭建" }),
    ).toBeFocused();
    await expect(dock).toContainText("已选 1 个节点");
    await expect(dock).toContainText("目标网址");
    expect(
      (
        await fixture.db.query(
          "select count(*)::int as n from canvas_workflow_proposals",
        )
      ).rows[0].n,
    ).toBe(0);
    await dock.getByRole("button", { name: "收起流程面板" }).click();
    await openMenu();
    await menu.getByRole("menuitem", { name: "编辑节点", exact: true }).click();
    await expect(dock.getByRole("textbox", { name: "目标网址", exact: true })).toBeInViewport();
    await dock.getByRole("button", { name: "收起流程面板" }).click();
    await openMenu();
    await menu.getByRole("menuitem", { name: "添加后续节点", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "添加处理节点" });
    await expect(picker).toContainText("接在「目标网址」之后");
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await openMenu();
    await menu
      .getByRole("menuitem", { name: "连接下一步", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Esc 取消" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 760, height: 900 });
    const closeChat = page.getByRole("button", { name: "关闭 AI 对话面板", exact: true });
    if (await closeChat.isVisible()) await closeChat.click();
    await expect(page.getByRole("dialog", { name: "Helstera Agent", exact: true })).toBeHidden();
    await openMenu();
    await expect(menu).toBeInViewport();
    await page.screenshot({ path: info.outputPath("node-menu-narrow.png") });
    await page.mouse.click(200, 280);
    await expect(menu).toBeHidden();
    await expect(picker).toBeHidden();
    await page
      .getByRole("button", { name: "AI 生成图片", exact: true })
      .click();
    const composer = page.locator(
      '[data-canvas-floating-panel="image-generator"]',
    );
    await expect(composer).toBeVisible();
    await composer.locator("textarea").fill("保留这个尚未提交的提示词");
    const surface = (await page.locator("[data-canvas-surface]").boundingBox())!;
    await page.mouse.click(surface.x + surface.width / 2, surface.y + surface.height / 2, { button: "right" });
    await expect(page.locator(".context-menu")).toBeVisible();
    await expect(composer).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(composer).toBeVisible();
    await expect(composer.locator("textarea")).toHaveValue(
      "保留这个尚未提交的提示词",
    );
    expect(
      (await fixture.db.query("select count(*)::int as n from agent_goals"))
        .rows[0].n,
    ).toBe(0);
  } finally {
    await desktop?.close();
    await fixture.close();
    await rm(folder, { recursive: true, force: true });
  }
});
