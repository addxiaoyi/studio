import { randomUUID } from "node:crypto";
import type { WorkflowGraph } from "@helstera/shared";
import { expect, test } from "@playwright/test";
import { WorkflowAssistantService } from "../../server/src/features/canvas-workflows/assistant";
import { createWorkflowFixture } from "../../server/src/features/canvas-workflows/browser-fixture";
import { CanvasWorkflowService } from "../../server/src/features/canvas-workflows/service";
import { projectWorkflow } from "../src/components/workflow/scene";

test("accepts one AI edit, fences deletion and preserves the selection after reload without running", async ({
  page,
}, info) => {
  const database = process.env.DATABASE_URL;
  if (!database)
    throw new Error("AI selection regression requires a local database.");
  const fixture = await createWorkflowFixture(
    database,
    "http://localhost:3228",
  );
  try {
    const graph: WorkflowGraph = {
      title: "原流程",
      nodes: [
        {
          id: "source",
          title: "输入",
          position: { x: 0, y: 0 },
          config: { kind: "text", role: "story", text: "hello" },
        },
        {
          id: "trim",
          title: "清理",
          position: { x: 390, y: 0 },
          config: {
            kind: "transform",
            operation: "trim",
            search: "",
            replacement: "",
          },
        },
        {
          id: "output",
          title: "输出",
          position: { x: 780, y: 0 },
          config: { kind: "deliver" },
        },
      ],
      edges: [
        { id: "a", source: "source", target: "trim" },
        { id: "b", source: "trim", target: "output" },
      ],
    };
    const service = new CanvasWorkflowService(fixture.db);
    const flow = await service.create(
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
    const after = {
      ...graph,
      title: "AI 新名称",
      nodes: graph.nodes
        .filter((node) => node.id !== "trim")
        .map((node) =>
          node.id === "source" ? { ...node, title: "改后输入" } : node,
        ),
      edges: [{ id: "a", source: "source", target: "output" }],
    };
    await new WorkflowAssistantService(fixture.db).propose(
      fixture.userId,
      fixture.canvasId,
      {
        plan: { action: "edit", summary: "选择改动验收", graph: after },
        prompt: "修改流程",
        requestKey: randomUUID(),
        workflowId: flow.id,
        revision: 1,
      },
    );
    async function open() {
      await page.goto(
        `http://localhost:3228/canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`,
      );
      await page
        .getByRole("button", { name: "打开可视化工作流", exact: true })
        .click();
      await page.getByRole("button", { name: "AI 搭建", exact: true }).click();
    }
    await open();
    const card = page.getByRole("region", { name: "AI 工作流操作" });
    await expect(
      card.getByRole("button", { name: "应用到画布", exact: true }),
    ).toBeDisabled();
    await expect(
      card.getByRole("checkbox", { name: /确认删除选中的/ }),
    ).toBeVisible();
    await card.getByRole("button", { name: "清空选择", exact: true }).click();
    await card.getByRole("checkbox", { name: /改后输入.*更新此节点/ }).check();
    await page.setViewportSize({ width: 320, height: 1000 });
    const chosenEdit = card.getByRole("checkbox", {
      name: /改后输入.*更新此节点/,
    });
    await chosenEdit.scrollIntoViewIfNeeded();
    await expect(chosenEdit).toBeInViewport();
    await page.screenshot({ path: info.outputPath("selective-edit-320.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await card.getByRole("button", { name: "应用到画布", exact: true }).click();
    await expect(card).toContainText("已应用");
    const saved = await service.get(fixture.userId, fixture.canvasId, flow.id);
    expect(saved.revision).toBe(2);
    expect(saved.graph.title).toBe("原流程");
    expect(saved.graph.nodes.map((node) => node.id)).toEqual([
      "source",
      "trim",
      "output",
    ]);
    expect(saved.graph.nodes.find((node) => node.id === "source")?.title).toBe(
      "改后输入",
    );
    expect(saved.graph.edges).toEqual(graph.edges);
    await open();
    await card.getByText("已应用 1 项修改", { exact: true }).click();
    await expect(
      card.getByRole("checkbox", { name: /流程名称与分组/ }),
    ).not.toBeChecked();
    await expect(
      card.getByRole("checkbox", { name: /改后输入.*更新此节点/ }),
    ).toBeChecked();
    expect(
      await service.runs(fixture.userId, fixture.canvasId, flow.id),
    ).toEqual([]);
    expect(
      (await fixture.db.query("select count(*)::int as n from agent_goals"))
        .rows[0].n,
    ).toBe(0);
  } finally {
    await fixture.close();
  }
});
