import { randomUUID } from "node:crypto";
import type { WorkflowGraph } from "@helstera/shared";
import { expect, test } from "@playwright/test";
import { createWorkflowFixture } from "../../server/src/features/canvas-workflows/browser-fixture";
import { CanvasWorkflowService } from "../../server/src/features/canvas-workflows/service";
import { buildImageElement } from "../../server/src/features/canvas/canvas-element-writer";
import { projectWorkflow } from "../src/components/workflow/scene";

test("preflight aggregates blockers, locates repairs and rechecks provider changes without starting work", async ({
  page,
}, info) => {
  const database = process.env.DATABASE_URL;
  if (!database)
    throw new Error(
      "Workflow preflight regression requires an isolated local database.",
    );
  const fixture = await createWorkflowFixture(
    database,
    "http://localhost:3228",
  );
  try {
    const provider = randomUUID();
    await fixture.db.query(
      "insert into provider_configs(id,workspace_id,label,base_url,key_ciphertext,key_last4,health_status) values($1,$2,'preflight','https://provider.test.invalid','fixture','test','healthy')",
      [provider, fixture.workspaceId],
    );
    for (const [model, price] of [
      ["preflight-valid", 1],
      ["preflight-price", 999],
    ] as const) {
      await fixture.db.query(
        "insert into provider_models(provider_id,model_id,display_name,media_type,billing_unit,price_credits,health_status,supports_input_image) values($1,$2,$2,'image','per_generation',$3,'healthy',true)",
        [provider, model, price],
      );
    }
    const generate = {
      kind: "generate",
      mediaType: "image",
      prompt: "woodland",
      aspectRatio: "16:9",
      duration: 5,
      resolution: "720p",
    } as const;
    const output = {
      id: "output",
      title: "交付",
      position: { x: 600, y: 300 },
      config: { kind: "deliver" },
    } as const;
    const assetId = randomUUID();
    const image = buildImageElement(
      "preflight-image",
      { x: 0, y: 220, width: 120, height: 80 },
      {
        canvasId: fixture.canvasId,
        objectPath: "preflight-expired.png",
        width: 120,
        height: 80,
        mimeType: "image/png",
        assetId,
      },
    );
    await fixture.db.query(
      "insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type) values($1,$2,$3,'project-assets','preflight-expired.png','image/png')",
      [assetId, fixture.workspaceId, fixture.userId],
    );
    await fixture.db.query(
      "insert into generated_assets(id,workspace_id,created_by,media_type,object_path,mime_type,retention_until) values($1,$2,$3,'image','preflight-expired.png','image/png',now()-interval '1 day')",
      [randomUUID(), fixture.workspaceId, fixture.userId],
    );
    const graph: WorkflowGraph = {
      title: "运行前检查验收",
      nodes: [
        {
          id: "empty",
          title: "空资料",
          position: { x: 0, y: 0 },
          config: { kind: "text", role: "story", text: "" },
        },
        {
          id: "asset",
          title: "失效素材",
          position: { x: 0, y: 220 },
          config: {
            kind: "asset",
            mediaType: "image",
            assetId,
            elementId: String(image.id),
          },
        },
        {
          id: "missing",
          title: "缺少模型",
          position: { x: 0, y: 440 },
          config: { ...generate, model: "not-configured" },
        },
        {
          id: "price",
          title: "无效价格",
          position: { x: 0, y: 660 },
          config: { ...generate, model: "preflight-price" },
        },
        output,
      ],
      edges: ["empty", "asset", "missing", "price"].map((id) => ({
        id: `edge-${id}`,
        source: id,
        target: "output",
      })),
    };
    const service = new CanvasWorkflowService(fixture.db);
    let flow = await service.create(
      fixture.userId,
      fixture.canvasId,
      graph,
      randomUUID(),
    );
    async function paint() {
      await fixture.db.query(
        "update canvases set content=$2::jsonb where id=$1",
        [
          fixture.canvasId,
          JSON.stringify({
            elements: projectWorkflow([image], flow.id, flow.graph, {}, false),
            appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } },
            files: {
              "preflight-image": {
                id: "preflight-image",
                mimeType: "image/png",
                created: Date.now(),
                dataURL:
                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j19sAAAAASUVORK5CYII=",
              },
            },
          }),
        ],
      );
    }
    async function open() {
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
    }
    await paint();
    const endpoint = `http://localhost:3315/api/canvases/${fixture.canvasId}/workflows/${flow.id}/preflight`;
    expect(
      (await page.request.post(endpoint, { data: { revision: 1 } })).status(),
    ).toBe(401);
    expect(
      (
        await page.request.post(endpoint, {
          headers: { Authorization: `Bearer ${fixture.token}` },
          data: { revision: 99 },
        })
      ).status(),
    ).toBe(409);
    await open();
    const dialog = page.getByRole("dialog", {
      name: "确认运行「运行前检查验收」",
    });
    const confirm = dialog.getByRole("button", { name: "确认运行已保存版本" });
    await expect(
      dialog.getByText("运行前需要修复 4 项问题。", { exact: true }),
    ).toBeVisible();
    await expect(confirm).toBeDisabled();
    expect(
      await service.runs(fixture.userId, fixture.canvasId, flow.id),
    ).toEqual([]);
    expect(
      (await fixture.db.query("select count(*)::int as n from agent_goals"))
        .rows[0].n,
    ).toBe(0);
    expect(
      (await fixture.db.query("select count(*)::int as n from background_jobs"))
        .rows[0].n,
    ).toBe(0);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const bounds = await dialog.boundingBox();
      if (!bounds) throw new Error("Preflight dialog is not visible.");
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(`preflight-blockers-${width}.png`),
      });
    }
    await dialog
      .getByRole("button", { name: "重新选择素材并保存画布 · 定位节点" })
      .click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("textbox", { name: "节点名称" })).toHaveValue(
      "失效素材",
    );

    const priced: WorkflowGraph = {
      title: graph.title,
      nodes: [
        {
          id: "image",
          title: "生成图片",
          position: { x: 0, y: 0 },
          config: { ...generate, model: "preflight-valid" },
        },
        output,
      ],
      edges: [{ id: "edge", source: "image", target: "output" }],
    };
    flow = await service.save(
      fixture.userId,
      fixture.canvasId,
      flow.id,
      flow.revision,
      priced,
    );
    await paint();
    await open();
    await expect(
      dialog.getByText("本次执行范围的运行前检查已通过。", { exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText("生成图片 · preflight-valid · 1 积分");
    await fixture.db.query(
      "update provider_models set enabled=false where provider_id=$1",
      [provider],
    );
    await confirm.click();
    await expect(
      dialog.getByText("运行前需要修复 1 项问题。", { exact: true }),
    ).toBeVisible();
    await expect(confirm).toBeDisabled();
    expect(
      await service.runs(fixture.userId, fixture.canvasId, flow.id),
    ).toEqual([]);
    expect(
      (await fixture.db.query("select count(*)::int as n from agent_goals"))
        .rows[0].n,
    ).toBe(0);

    const fixed: WorkflowGraph = {
      title: graph.title,
      nodes: [
        {
          id: "text",
          title: "创作资料",
          position: { x: 0, y: 0 },
          config: {
            kind: "text",
            role: "story",
            text: "Preflight repair complete",
          },
        },
        output,
      ],
      edges: [{ id: "edge", source: "text", target: "output" }],
    };
    flow = await service.save(
      fixture.userId,
      fixture.canvasId,
      flow.id,
      flow.revision,
      fixed,
    );
    await paint();
    await open();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(
      page.getByRole("region", { name: "工作流运行记录" }),
    ).toContainText("全部完成", { timeout: 30_000 });
    expect(
      await service.runs(fixture.userId, fixture.canvasId, flow.id),
    ).toHaveLength(1);
    expect(
      (await fixture.db.query("select count(*)::int as n from background_jobs"))
        .rows[0].n,
    ).toBe(0);
  } finally {
    await fixture.close();
  }
});
