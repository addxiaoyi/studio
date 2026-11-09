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
import { createWorkflowFixture } from "../../server/src/features/canvas-workflows/browser-fixture";
import { CanvasWorkflowService } from "../../server/src/features/canvas-workflows/service";
import { projectWorkflow } from "../src/components/workflow/scene";

test("workspace hierarchy, nested selects and recovery dialogs fit narrow windows", async ({
  page,
}, info) => {
  const fixture = await createWorkflowFixture(
    process.env.DATABASE_URL!,
    "http://localhost:3228",
  );
  const folder = await mkdtemp(join(tmpdir(), "workspace-ui-"));
  let desktop: ElectronApplication | undefined;
  try {
    const graph = websiteWorkflow();
    graph.title = "界面验收";
    graph.nodes[0]!.config = { kind: "url", url: "https://example.com" };
    const service = new CanvasWorkflowService(fixture.db),
      flow = await service.create(
        fixture.userId,
        fixture.canvasId,
        graph,
        randomUUID(),
      );
    await service.save(fixture.userId, fixture.canvasId, flow.id, 1, {
      ...graph,
      title: "第二版",
    });
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
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:3228/home/");
    await expect(
      page.getByRole("heading", { level: 1, name: "开始今天的 AI 创作" }),
    ).toBeVisible();
    const shortcuts = page.getByRole("navigation", { name: "创作快捷入口" });
    await expect(
      shortcuts.getByRole("link", { name: /女装试穿/ }),
    ).toBeInViewport();
    await expect(
      shortcuts.getByRole("link", { name: /视频创作/ }),
    ).toBeInViewport();
    expect(
      await page
        .locator("body")
        .evaluate((el) => getComputedStyle(el).backgroundImage),
    ).toBe("none");
    const heading = await page.getByRole("heading", { level: 1 }).boundingBox(),
      stats = await page.locator(".home-stats").boundingBox();
    expect(heading!.y).toBeLessThan(stats!.y);
    await page.screenshot({
      path: info.outputPath(desktop ? "desktop-home.png" : "web-home.png"),
    });
    await page.goto(
      `http://localhost:3228/${desktop ? "desktop-app/" : ""}canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`,
    );
    await page
      .getByRole("button", { name: "打开可视化工作流", exact: true })
      .click();
    const closeChat = page.getByRole("button", {
      name: "关闭 AI 对话面板",
      exact: true,
    });
    if (await closeChat.isVisible()) {
      await closeChat.click();
      await expect(closeChat).toBeHidden();
    }
    await page.setViewportSize({ width: 740, height: 540 });
    const history = page.getByRole("button", { name: "版本历史", exact: true });
    await history.click();
    const dialog = page.getByRole("dialog", { name: "工作流版本历史" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(desktop ? 46 : 0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(541);
    await dialog.getByRole("combobox", { name: "选择历史版本" }).click();
    await expect(
      page.getByRole("listbox", { name: "选择历史版本" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: "选择历史版本" }),
    ).toBeFocused();
    await dialog
      .getByRole("button", { name: "确认恢复为第 3 版", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    expect(
      (await service.get(fixture.userId, fixture.canvasId, flow.id)).revision,
    ).toBe(3);
    expect(
      await service.runs(fixture.userId, fixture.canvasId, flow.id),
    ).toHaveLength(0);
    await history.click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(history).toBeFocused();
    await page.setViewportSize({ width: 390, height: 740 });
    await history.click();
    await expect(dialog).toBeVisible();
    const narrow = await dialog.boundingBox();
    expect(narrow!.x).toBeGreaterThanOrEqual(0);
    expect(narrow!.x + narrow!.width).toBeLessThanOrEqual(391);
    await page.screenshot({
      path: info.outputPath(
        desktop ? "desktop-dialog-narrow.png" : "web-dialog-narrow.png",
      ),
    });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({
      path: info.outputPath(
        desktop ? "desktop-dialog-dark.png" : "web-dialog-dark.png",
      ),
    });
    if (desktop) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2),
      );
      const zoomed = await dialog.boundingBox();
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      expect(zoomed!.x).toBeGreaterThanOrEqual(0);
      expect(zoomed!.y + zoomed!.height).toBeLessThanOrEqual(
        viewport.height + 1,
      );
      await page.screenshot({
        path: info.outputPath("desktop-dialog-200-percent.png"),
      });
    }
    const proof=await service.create(fixture.userId,fixture.canvasId,{title:"界面任务回流",nodes:[{id:"text",title:"文字",position:{x:0,y:0},config:{kind:"text",role:"story",text:"历史记录可回到原画布"}},{id:"deliver",title:"输出",position:{x:400,y:0},config:{kind:"deliver"}}],edges:[{id:"a",source:"text",target:"deliver"}]},randomUUID());
    const proofRun=await service.run(fixture.userId,fixture.canvasId,proof.id,1,randomUUID(),fixture.sessionId);
    await page.goto("http://localhost:3228/agent-history/");
    await expect(page.getByRole("button",{name:/界面任务回流/})).toBeVisible();
    await expect(page.getByRole("region",{name:"工作流运行记录"})).toContainText("全部完成",{timeout:20000});
    await page.getByRole("link",{name:"打开对应画布与任务"}).click();await expect(page).toHaveURL(new RegExp(`goalId=${proofRun.goalId}`));
  } finally {
    await desktop?.close();
    await fixture.close();
    await rm(folder, { recursive: true, force: true });
  }
});
