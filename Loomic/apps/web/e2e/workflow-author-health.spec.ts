import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { WorkflowGraph } from "@helstera/shared";
import { expect, test } from "@playwright/test";
import { createWorkflowAuthorCheck } from "../../server/src/features/canvas-workflows/author-health";
import { createWorkflowFixture } from "../../server/src/features/canvas-workflows/browser-fixture";
import { CanvasWorkflowService } from "../../server/src/features/canvas-workflows/service";
import { projectWorkflow } from "../src/components/workflow/scene";

test("checks author metadata without inference and rechecks revoked credentials before startup", async ({
  page,
}, info) => {
  const database = process.env.DATABASE_URL;
  if (!database)
    throw new Error("Author health regression requires a local database.");
  let status = 401;
  const requests: string[] = [];
  const gateway = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "writer" }] }));
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const address = gateway.address();
  if (!address || typeof address === "string")
    throw new Error("Author metadata fixture did not bind a port.");
  const authorCheck = createWorkflowAuthorCheck(
    {},
    {
      getChatModelConfig: async () => ({
        model: "writer",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: "fixture",
      }),
      getWorkspaceSettings: async () => {
        throw new Error("Unused settings method");
      },
      updateWorkspaceSettings: async () => {
        throw new Error("Unused settings method");
      },
    },
  );
  const fixture = await createWorkflowFixture(
    database,
    "http://localhost:3228",
    { authorCheck },
  );
  try {
    const graph: WorkflowGraph = {
      title: "编剧连接验收",
      nodes: [
        {
          id: "source",
          title: "输入",
          position: { x: 0, y: 0 },
          config: { kind: "text", role: "story", text: "机器人寻找花园" },
        },
        {
          id: "writer",
          title: "AI 编剧",
          position: { x: 390, y: 0 },
          config: {
            kind: "write",
            mode: "rewrite",
            instruction: "Draft a script",
            shotCount: 1,
          },
        },
        {
          id: "output",
          title: "交付",
          position: { x: 780, y: 0 },
          config: { kind: "deliver" },
        },
      ],
      edges: [
        { id: "a", source: "source", target: "writer" },
        { id: "b", source: "writer", target: "output" },
      ],
    };
    const service = new CanvasWorkflowService(fixture.db, authorCheck);
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
    await page
      .getByRole("region", { name: "可视化工作流", exact: true })
      .getByRole("button", { name: "运行流程", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "确认运行「编剧连接验收」",
    });
    const confirm = dialog.getByRole("button", { name: "确认运行已保存版本" });
    await expect(dialog).toContainText("编剧连接认证失败");
    await expect(confirm).toBeDisabled();
    expect(
      await service.runs(fixture.userId, fixture.canvasId, flow.id),
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath("author-credentials-blocked.png"),
    });
    status = 200;
    await dialog.getByRole("button", { name: "重新检查" }).click();
    await expect(confirm).toBeEnabled();
    status = 401;
    await confirm.click();
    await expect(dialog).toContainText("编剧连接认证失败");
    await expect(confirm).toBeDisabled();
    expect(
      await service.runs(fixture.userId, fixture.canvasId, flow.id),
    ).toEqual([]);
    status = 200;
    await dialog.getByRole("button", { name: "重新检查" }).click();
    await confirm.click();
    await expect(
      page.getByRole("region", { name: "工作流运行记录" }),
    ).toContainText("全部完成", { timeout: 30_000 });
    expect(requests.length).toBeGreaterThanOrEqual(4);
    expect(new Set(requests)).toEqual(new Set(["GET /v1/models"]));
    expect(
      (await fixture.db.query("select count(*)::int as n from background_jobs"))
        .rows[0].n,
    ).toBe(0);
  } finally {
    await fixture.close();
    await new Promise<void>((resolve, reject) =>
      gateway.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
