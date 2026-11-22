import { randomUUID } from "node:crypto";
import type { WorkflowGraph } from "@helstera/shared";
import { expect, test } from "@playwright/test";
import { createWorkflowFixture } from "../../server/src/features/canvas-workflows/browser-fixture";
import { CanvasWorkflowService } from "../../server/src/features/canvas-workflows/service";
import { projectWorkflow } from "../src/components/workflow/scene";

test("selects a real nested upstream field, previews its type and runs the exact extraction", async ({
  page,
}, info) => {
  const database = process.env.DATABASE_URL;
  if (!database)
    throw new Error("Workflow field regression requires a local database.");
  const fixture = await createWorkflowFixture(
    database,
    "http://localhost:3228",
  );
  try {
    const graph: WorkflowGraph = {
      title: "字段选择验收",
      nodes: [
        {
          id: "source",
          title: "JSON 输入",
          position: { x: 0, y: 0 },
          config: {
            kind: "json",
            json: '{"score":80,"person":{"name":"Ada"}}',
          },
        },
        {
          id: "extract",
          title: "读取姓名",
          position: { x: 390, y: 0 },
          config: { kind: "extract", path: "missing" },
        },
        {
          id: "output",
          title: "输出",
          position: { x: 780, y: 0 },
          config: { kind: "deliver" },
        },
      ],
      edges: [
        { id: "a", source: "source", target: "extract" },
        { id: "b", source: "extract", target: "output" },
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
    await page.goto(
      `http://localhost:3228/canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`,
    );
    await page
      .getByRole("button", { name: "打开可视化工作流", exact: true })
      .click();
    const dock = page.getByRole("region", {
      name: "可视化工作流",
      exact: true,
    });
    await dock.getByRole("button", { name: /提取字段 读取姓名/ }).click();
    await dock.getByText("从上游选择提取字段", { exact: true }).click();
    await dock.getByRole("combobox", { name: "选择提取字段" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("listbox", { name: "选择提取字段" }),
    ).toBeVisible();
    await page.keyboard.press("End");
    await page
      .getByRole("option", { name: "person.name · 文字 · Ada", exact: true })
      .waitFor();
    await expect(
      page.getByRole("option", {
        name: "person.name · 文字 · Ada",
        exact: true,
      }),
    ).toHaveAttribute("data-highlighted");
    await page.keyboard.press("Enter");
    await expect(dock.getByRole("textbox", { name: "字段路径" })).toHaveValue(
      "person.name",
    );
    await expect(
      dock.getByRole("status").filter({ hasText: "person.name · 文字 · Ada" }),
    ).toBeVisible();
    expect(
      await service.runs(fixture.userId, fixture.canvasId, flow.id),
    ).toEqual([]);
    await page.setViewportSize({ width: 320, height: 1000 });
    const fieldPreview = dock
      .getByRole("status")
      .filter({ hasText: "person.name · 文字 · Ada" });
    await fieldPreview.scrollIntoViewIfNeeded();
    await expect(fieldPreview).toBeInViewport();
    await page.screenshot({ path: info.outputPath("upstream-field-320.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await dock.getByRole("button", { name: "保存并运行", exact: true }).click();
    await page
      .getByRole("button", { name: "确认运行已保存版本", exact: true })
      .click();
    await expect(
      dock.getByRole("region", { name: "工作流运行记录" }),
    ).toContainText("全部完成", { timeout: 30_000 });
    const run = (
      await service.runs(fixture.userId, fixture.canvasId, flow.id)
    )[0];
    if (!run)
      throw new Error("The checked field workflow did not create a run.");
    expect(
      (
        await fixture.db.query(
          "select output from agent_goal_steps where goal_id=$1 and step_id='extract'",
          [run.goalId],
        )
      ).rows[0].output,
    ).toMatchObject({ json: "Ada", text: "Ada" });
    expect(
      (await fixture.db.query("select count(*)::int as n from background_jobs"))
        .rows[0].n,
    ).toBe(0);
  } finally {
    await fixture.close();
  }
});
