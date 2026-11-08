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
import {
  projectWorkflow,
  type SceneElement,
} from "../src/components/workflow/scene";
import { workflowCurve } from "../src/components/workflow/curves";

test("curved wires follow node drags, survive reload and preserve native undo and deletion", async ({
  page,
}, info) => {
  const fixture = await createWorkflowFixture(
    process.env.DATABASE_URL!,
    "http://localhost:3228",
  );
  const directory = await mkdtemp(join(tmpdir(), "workflow-curves-"));
  let desktop: ElectronApplication | undefined;
  try {
    const graph = websiteWorkflow();
    graph.title = "柔和连线验收";
    graph.nodes[0]!.config = { kind: "url", url: "https://example.com" };
    graph.nodes[0]!.position = { x: 440, y: 190 };
    graph.nodes[1]!.position = { x: 860, y: 350 };
    graph.nodes[2]!.position = { x: 1280, y: 220 };
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
      dock.getByRole("button", { name: /浏览与录制 读取网页与截图/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("v");
    const capture = page.locator('[data-workflow-node="capture"]');
    let last = "";
    await expect
      .poll(async () => {
        const current = JSON.stringify(await capture.boundingBox());
        const settled = last === current;
        last = current;
        return settled;
      })
      .toBe(true);
    const initial = (await capture.boundingBox())!;
    const start = { x: initial.x + initial.width / 2, y: initial.y + 25 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 36, start.y + 105, { steps: 24 });
    await page.mouse.up();
    const savedScene = async (): Promise<SceneElement[]> =>
      (
        await fixture.db.query("select content from canvases where id=$1", [
          fixture.canvasId,
        ])
      ).rows[0].content.elements;
    await expect
      .poll(
        async () =>
          (await savedScene()).find((el) => el.id === `wf:${flow.id}:capture`)
            ?.y,
      )
      .toBeGreaterThan(450);
    let elements = await savedScene();
    const from = elements.find((el) => el.id === `wf:${flow.id}:site`)!;
    const to = elements.find((el) => el.id === `wf:${flow.id}:capture`)!;
    const wire = elements.find((el) => el.id === `we:${flow.id}:e-1`)!;
    expect(wire).toMatchObject(workflowCurve(from, to));
    const changedY = to.y;
    await page.mouse.move(1150, 100);
    await page.screenshot({
      path: info.outputPath("workflow-curves-drag.png"),
    });
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () => (await savedScene()).find((el) => el.id === to.id)?.y)
      .toBeCloseTo(350, 1);
    await page.keyboard.press("Control+Shift+z");
    await expect
      .poll(async () => (await savedScene()).find((el) => el.id === to.id)?.y)
      .toBeCloseTo(changedY, 1);
    await dock.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(
      dock.getByRole("button", { name: "已保存", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await page.getByRole("button", { name: "打开可视化工作流" }).click();
    await expect(dock.getByRole("button",{name:/浏览与录制 读取网页与截图/})).toBeVisible();
    await expect.poll(async()=>{
      const output=await page.locator('[data-workflow-node="deliver"]').boundingBox();
      const canvas=await page.locator('[data-canvas-surface]').boundingBox();
      return Boolean(output&&canvas&&output.x+output.width<canvas.x+canvas.width-20);
    }).toBe(true);
    await expect(capture).toBeVisible();
    elements = await savedScene();
    expect(elements.find((el) => el.id === wire.id)?.points).toHaveLength(9);
    await expect
      .poll(async () => {
        const current = JSON.stringify(await capture.boundingBox());
        const settled = last === current;
        last = current;
        return settled;
      })
      .toBe(true);
    const sourceBox = (await page
      .locator('[data-workflow-node="site"]')
      .boundingBox())!;
    const zoom = sourceBox.width / (from.width - 2);
    const nativeWire = elements.find((el) => el.id === wire.id)!;
    const middle = (nativeWire.points as number[][])[4]!;
    await page.mouse.click(
      sourceBox.x + (nativeWire.x + middle[0]! - from.x - 1) * zoom,
      sourceBox.y + (nativeWire.y + middle[1]! - from.y - 1) * zoom,
    );
    await page.screenshot({path:info.outputPath("curve-selected.png")});
    await expect(page.getByText("已选 1 项",{exact:false})).toBeVisible();
    await page.keyboard.press("Delete");
    await expect
      .poll(
        async () =>
          (await savedScene()).find((el) => el.id === wire.id)?.isDeleted,
      )
      .toBe(true);
    await page.keyboard.press("Control+z");
    await expect
      .poll(
        async () =>
          (await savedScene()).find((el) => el.id === wire.id)?.isDeleted,
      )
      .toBe(false);
    await dock
      .getByRole("button", { name: /浏览与录制 读取网页与截图/ })
      .click();
    await dock.getByRole("button", { name: "断开site到capture" }).click();
    await expect(
      dock.getByRole("button", { name: "运行流程", exact: true }),
    ).toBeDisabled();
    await dock.getByRole("button", { name: "撤销工作流修改" }).click();
    await expect(
      dock.getByRole("button", { name: "断开site到capture" }),
    ).toBeVisible();
    expect(
      (await fixture.db.query("select count(*)::int as n from agent_goals"))
        .rows[0].n,
    ).toBe(0);
    const save = dock.getByRole("button",{name:"保存草稿",exact:true});
    if(await save.isVisible())await save.click();
    await expect(dock.getByRole("button",{name:"已保存",exact:true})).toBeDisabled();
    await page.mouse.click(1200,170);
    await expect(page.locator('[data-canvas-surface]').getByText("已保存",{exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath("workflow-curves-final.png")});
  } catch (cause) {
    console.error("[workflow-curves] acceptance failed",cause);
    throw cause;
  } finally {
    await desktop?.close();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
