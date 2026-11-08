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

test("nodes support direct ports, stable dragging, visible settings and save-before-run", async ({
  page,
}, info) => {
  const fixture = await createWorkflowFixture(
      process.env.DATABASE_URL!,
      "http://localhost:3228",
    ),
    directory = await mkdtemp(join(tmpdir(), "workflow-ux-"));
  let desktop: ElectronApplication | undefined;
  try {
    const graph = websiteWorkflow();
    graph.title = "节点交互验收";
    graph.nodes[0]!.config = { kind: "url", url: "https://example.com" };
    graph.nodes[0]!.position = { x: 450, y: 180 };
    graph.nodes[1]!.position = { x: 840, y: 340 };
    graph.nodes[2]!.position = { x: 1230, y: 220 };
    graph.edges = graph.edges.slice(1);
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
        HELSTERA_TEST_USER_DATA: directory,
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
    await page.setViewportSize({ width: 1700, height: 960 });
    await page.goto(
      `http://localhost:3228/${desktop ? "desktop-app/" : ""}canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`,
    );
    await page.getByRole("button", { name: "打开可视化工作流" }).click();
    const dock = page.getByRole("region", {
      name: "可视化工作流",
      exact: true,
    });
    await expect(
      dock.getByRole("button", { name: /网址输入 目标网址/ }),
    ).toBeVisible();
    await dock
      .getByRole("button", { name: "定位流程节点", exact: true })
      .click();
    const source = page.locator('[data-workflow-node="site"]'),
      target = page.locator('[data-workflow-node="capture"]');
    let last = "";
    await expect
      .poll(async () => {
        const now = JSON.stringify(await source.boundingBox());
        const same = last === now;
        last = now;
        return same;
      })
      .toBe(true);
    await dock.getByRole("button", { name: "收起流程面板" }).click();
    await expect(dock).toBeHidden();
    const start = (await source.boundingBox())!;
    await page.keyboard.press("v");
    await page.mouse.move(start.x + start.width / 2, start.y + 24);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2 + 25, start.y + 64, {
      steps: 20,
    });
    await page.mouse.up();
    await expect(dock).toBeHidden();
    expect((await source.boundingBox())!.width).toBeCloseTo(start.width, 1);
    const dragged = (await source.boundingBox())!;
    await page.mouse.click(dragged.x + dragged.width / 2, dragged.y + 24);
    await expect(dock).toBeVisible();
    await expect(
      dock.getByRole("textbox", { name: "目标网址", exact: true }),
    ).toBeInViewport();
    expect((await source.boundingBox())!.width).toBeCloseTo(start.width, 1);
    await expect(page.locator(".excalidraw-hyperlinkContainer")).toHaveCount(0);
    await expect(page.locator(".excalidraw__embeddable-hint")).toHaveCount(0);
    await page
      .getByRole("button", { name: "从目标网址连接", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: "Esc 取消" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("status").filter({ hasText: "Esc 取消" }),
    ).toBeHidden();
    const output = page.getByRole("button", {
      name: "从目标网址连接",
      exact: true,
    });
    const outputBounds = (await output.boundingBox())!;
    await page.mouse.move(
      outputBounds.x + outputBounds.width / 2,
      outputBounds.y + outputBounds.height / 2,
    );
    await page.mouse.down();
    const input = page.getByRole("button", {
      name: "连接到读取网页与截图",
      exact: true,
    });
    await expect(input).toBeVisible();
    const inputBounds = (await input.boundingBox())!;
    await page.mouse.move(
      inputBounds.x + inputBounds.width / 2,
      inputBounds.y + inputBounds.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();
    await dock
      .getByRole("button", { name: /浏览与录制 读取网页与截图/ })
      .click();
    await expect(
      dock.getByRole("button", { name: "断开site到capture" }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("node-ports-and-inspector.png"),
    });
    await dock.getByRole("button", { name: "保存并运行", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "确认运行「节点交互验收」" }),
    ).toBeVisible();
    expect(
      (await fixture.db.query("select count(*)::int as n from agent_goals"))
        .rows[0].n,
    ).toBe(0);
    await page.getByRole("button", { name: "返回编辑", exact: true }).click();
    await dock.getByRole("button", { name: "断开site到capture" }).click();
    await dock.getByRole("button", { name: /网址输入 目标网址/ }).click();
    await page
      .getByRole("button", { name: "从目标网址连接", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "连接到读取网页与截图", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+s");
    await expect(
      dock.getByRole("button", { name: "已保存", exact: true }),
    ).toBeDisabled();
    await page.setViewportSize({ width: 620, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dock
      .getByRole("button", { name: /浏览与录制 读取网页与截图/ })
      .click();
    await expect(
      dock.getByRole("checkbox", { name: "录制视频" }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("node-inspector-narrow.png"),
    });
    await page.setViewportSize({width:1700,height:960});
    await dock.getByRole("button",{name:"定位流程节点",exact:true}).click();
    await dock.getByRole("button",{name:/网址输入 目标网址/}).click();
    await page.getByRole("button",{name:"在目标网址后添加节点",exact:true}).click();
    const picker=page.getByRole("dialog",{name:"添加处理节点",exact:true});await expect(picker).toBeVisible();
    await picker.getByRole("textbox",{name:"搜索节点"}).fill("搜索");
    await picker.getByRole("button",{name:/网页搜索/}).click();await expect(picker).toBeHidden();
    await expect(dock.getByRole("textbox",{name:"搜索主题"})).toBeInViewport();
    await dock.getByRole("button",{name:"撤销工作流修改"}).click();
    await expect(dock.getByRole("textbox",{name:"搜索主题"})).toHaveCount(0);
    if(await dock.getByRole("button",{name:"保存草稿",exact:true}).isVisible())await dock.getByRole("button",{name:"保存草稿",exact:true}).click();
    await dock.getByRole("button",{name:"新建流程",exact:true}).click();
    await expect(dock.getByRole("textbox",{name:"流程名称"})).toHaveValue("网站研究与截图");
    await dock.getByRole("textbox",{name:"流程名称"}).fill("保留我的草稿");
    await dock.getByRole("combobox",{name:"选择工作流"}).click();await page.getByRole("option",{name:"节点交互验收",exact:true}).click();
    await expect(page.getByRole("dialog",{name:"切换前保留当前修改"})).toBeVisible();
    await page.getByRole("button",{name:"保留本机草稿并切换"}).click();
    await dock.getByRole("combobox",{name:"选择工作流"}).click();await page.getByRole("option",{name:"网站研究与截图",exact:true}).click();
    await expect(dock).toContainText("本机有尚未保存的草稿");await dock.getByRole("button",{name:"恢复草稿",exact:true}).click();
    await expect(dock.getByRole("textbox",{name:"流程名称"})).toHaveValue("保留我的草稿");
    await dock.getByRole("button",{name:"保存草稿",exact:true}).click();await expect(dock.getByRole("button",{name:"已保存",exact:true})).toBeDisabled();
    expect((await fixture.db.query("select count(*)::int as n from agent_goals")).rows[0].n).toBe(0);
  } catch (cause) {
    console.error("[workflow-ux]", cause);
    throw cause;
  } finally {
    await desktop?.close();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
