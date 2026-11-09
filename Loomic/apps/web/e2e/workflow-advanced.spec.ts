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
import { layoutWorkflow, type WorkflowGraph } from "@helstera/shared";
import { CanvasWorkflowService } from "../../server/src/features/canvas-workflows/service";
import { createWorkflowFixture } from "../../server/src/features/canvas-workflows/browser-fixture";
import { projectWorkflow } from "../src/components/workflow/scene";

test("Switch, batch checkpoints and version restore work in the real workspace", async ({
  page,
}, info) => {
  const fixture = await createWorkflowFixture(
      process.env.DATABASE_URL!,
      "http://localhost:3228",
    ),
    folder = await mkdtemp(join(tmpdir(), "workflow-advanced-"));
  let desktop: ElectronApplication | undefined;
  try {
    const position = { x: 0, y: 0 };
    const graph = layoutWorkflow({
      title: "批量与多路分支验收",
      nodes: [
        {
          id: "input",
          title: "输入列表",
          position,
          config: {
            kind: "json",
            json: '[{"title":"alpha"},{"title":"beta"},{"title":"gamma"}]',
          },
        },
        {
          id: "split",
          title: "拆分列表",
          position,
          config: {
            kind: "split",
            source: "json",
            path: "",
            separator: "\n",
            maxItems: 3,
          },
        },
        {
          id: "batch",
          title: "批量整理",
          position,
          config: {
            kind: "batch",
            maxItems: 3,
            batchSize: 1,
            operations: [
              { kind: "extract", path: "title" },
              {
                kind: "transform",
                operation: "uppercase",
                search: "",
                replacement: "",
              },
              { kind: "template", template: "{{index}}. {{text}}" },
            ],
          },
        },
        {
          id: "route",
          title: "分类选择",
          position,
          config: {
            kind: "switch",
            mode: "first",
            cases: [
              {
                id: "alpha",
                title: "含 ALPHA",
                conditions: [
                  { field: "text", operator: "contains", value: "ALPHA" },
                ],
                match: "all",
              },
            ],
          },
        },
        {
          id: "hit",
          title: "命中处理",
          position,
          config: { kind: "template", template: "MATCH {{text}}" },
        },
        {
          id: "fallback",
          title: "默认处理",
          position,
          config: { kind: "template", template: "DEFAULT {{text}}" },
        },
        {
          id: "merge",
          title: "合并",
          position,
          config: { kind: "merge", separator: "\n" },
        },
        { id: "output", title: "交付", position, config: { kind: "deliver" } },
      ],
      edges: [
        { id: "a", source: "input", target: "split" },
        { id: "b", source: "split", target: "batch" },
        { id: "c", source: "batch", target: "route" },
        { id: "d", source: "route", target: "hit", branch: "alpha" },
        { id: "e", source: "route", target: "fallback", branch: "default" },
        { id: "f", source: "hit", target: "merge" },
        { id: "g", source: "fallback", target: "merge" },
        { id: "h", source: "merge", target: "output" },
      ],
      groups: [
        {
          id: "preparation",
          title: "资料整理",
          nodeIds: ["input", "split", "batch"],
          collapsed: false,
        },
      ],
    } satisfies WorkflowGraph);
    const service = new CanvasWorkflowService(fixture.db),
      flow = await service.create(
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
    await page.setViewportSize({ width: 1700, height: 1000 });
    await page.goto(
      `http://localhost:3228/${desktop ? "desktop-app/" : ""}canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`,
    );
    await page
      .getByRole("button", { name: "打开可视化工作流", exact: true })
      .click();
    const dock = page.getByRole("region", {
      name: "可视化工作流",
      exact: true,
    });
    await dock.getByRole("button", { name: /批量循环 批量整理/ }).click();
    await expect(
      dock.getByRole("spinbutton", { name: "每批处理项数" }),
    ).toHaveValue("1");
    await dock.getByRole("button", { name: "运行流程", exact: true }).click();
    await page
      .getByRole("button", { name: "确认运行已保存版本", exact: true })
      .click();
    await expect(
      dock.getByRole("region", { name: "工作流运行记录" }),
    ).toContainText("全部完成", { timeout: 45000 });
    await expect(dock).toContainText("MATCH 1. ALPHA");
    const runs = await service.runs(fixture.userId, fixture.canvasId, flow.id),
      goalId = runs[0]!.goalId;
    expect(
      (
        await fixture.db.query(
          "select output,attempt from agent_goal_steps where goal_id=$1 and step_id='batch'",
          [goalId],
        )
      ).rows[0],
    ).toMatchObject({
      attempt: 1,
      output: { items: ["1. ALPHA", "2. BETA", "3. GAMMA"], processed: 3 },
    });
    expect(
      (
        await fixture.db.query(
          "select attempt from agent_goal_steps where goal_id=$1 and step_id='fallback'",
          [goalId],
        )
      ).rows[0].attempt,
    ).toBe(0);
    await dock
      .getByRole("button", { name: "定位节点：分类选择", exact: true })
      .click();
    await dock
      .getByRole("textbox", { name: "比较值", exact: true })
      .fill("NOT_FOUND");
    await dock.getByRole("button", { name: "保存并运行", exact: true }).click();
    await page
      .getByRole("button", { name: "确认运行已保存版本", exact: true })
      .click();
    await expect(
      dock.getByRole("region", { name: "工作流运行记录" }),
    ).toContainText("全部完成", { timeout: 45000 });
    await expect(dock).toContainText("DEFAULT 1. ALPHA");
    const latest = (
      await service.runs(fixture.userId, fixture.canvasId, flow.id)
    )[0]!;
    expect(
      (
        await fixture.db.query(
          "select attempt from agent_goal_steps where goal_id=$1 and step_id='hit'",
          [latest.goalId],
        )
      ).rows[0].attempt,
    ).toBe(0);
    await dock.getByRole("button", { name: "版本历史", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "工作流版本历史" });
    await expect(dialog.getByRole("list", { name: "版本差异" })).toContainText(
      "分支规则",
    );
    await dialog
      .getByRole("button", { name: "确认恢复为第 3 版", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    expect(
      (await service.get(fixture.userId, fixture.canvasId, flow.id)).graph,
    ).toEqual(graph);
    expect(
      await service.runs(fixture.userId, fixture.canvasId, flow.id),
    ).toHaveLength(2);
    await page.reload();
    await page
      .getByRole("button", { name: "打开可视化工作流", exact: true })
      .click();
    await dock.getByText("缩略导航", { exact: true }).click();
    await dock
      .getByRole("button", { name: "缩略定位分组资料整理", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("article", { name: /输入列表，/ }),
    ).toBeInViewport();
    expect(
      (await fixture.db.query("select count(*)::int as n from background_jobs"))
        .rows[0].n,
    ).toBe(0);
    await page.screenshot({ path: info.outputPath("advanced-workflow.png") });
  } finally {
    await desktop?.close();
    await fixture.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test("48-node grouped navigation works with keyboard and narrow viewports", async ({
  page,
}, info) => {
  const fixture = await createWorkflowFixture(
    process.env.DATABASE_URL!,
    "http://localhost:3228",
  );
  try {
    const nodes: WorkflowGraph["nodes"] = Array.from(
      { length: 48 },
      (_, i) => ({
        id: `node-${i}`,
        title: `步骤 ${i + 1}`,
        position: { x: (i % 8) * 400 - 1600, y: Math.floor(i / 8) * 260 - 500 },
        config:
          i === 0
            ? { kind: "text", role: "story", text: "start" }
            : i === 47
              ? { kind: "deliver" }
              : {
                  kind: "transform",
                  operation: "trim",
                  search: "",
                  replacement: "",
                },
      }),
    );
    const graph: WorkflowGraph = {
      title: "48节点导航验收",
      nodes,
      edges: nodes
        .slice(1)
        .map((node, i) => ({
          id: `edge-${i}`,
          source: `node-${i}`,
          target: node.id,
        })),
      groups: Array.from({ length: 4 }, (_, i) => ({
        id: `group-${i}`,
        title: `阶段 ${i + 1}`,
        nodeIds: nodes.slice(i * 12, i * 12 + 12).map((node) => node.id),
        collapsed: i === 0,
      })),
    };
    const service = new CanvasWorkflowService(fixture.db),
      flow = await service.create(
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
    await page.goto(`http://localhost:3228/canvas/?id=${fixture.canvasId}`);
    await page
      .getByRole("button", { name: "打开可视化工作流", exact: true })
      .click();
    const dock = page.getByRole("region", {
      name: "可视化工作流",
      exact: true,
    });
    await dock.getByText("缩略导航", { exact: true }).click();
    await dock
      .getByRole("button", { name: "缩略定位分组阶段 1", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("button", { name: "展开画布分组阶段 1" }),
    ).toBeInViewport();
    await dock.getByRole("textbox", { name: "查找节点或备注" }).fill("步骤 48");
    await dock
      .getByRole("button", { name: "步骤 48", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("article", { name: /步骤 48，/ }),
    ).toBeInViewport();
    const closeChat = page.getByRole("button", {
      name: "关闭 AI 对话面板",
      exact: true,
    });
    if (await closeChat.isVisible()) await closeChat.click();
    await page.setViewportSize({ width: 740, height: 850 });
    await expect(
      dock.getByRole("textbox", { name: "查找节点或备注" }),
    ).toBeVisible();
    await dock.getByRole("button", { name: "版本历史", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "工作流版本历史" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "工作流版本历史" }),
    ).toBeHidden();
    expect(
      (await service.get(fixture.userId, fixture.canvasId, flow.id)).graph
        .nodes,
    ).toHaveLength(48);
    await page.screenshot({
      path: info.outputPath("large-workflow-narrow.png"),
    });
  } finally {
    await fixture.close();
  }
});
