import {
  test,
  expect,
  _electron,
  type ElectronApplication,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowGraph } from "@helstera/shared";
import { createWorkflowFixture } from "../../server/src/features/canvas-workflows/browser-fixture";
import { CanvasWorkflowService } from "../../server/src/features/canvas-workflows/service";
import {
  savePrivateImage,
  savePrivateVideo,
} from "../../server/src/features/assets/private-video";
import {
  projectWorkflow,
  type SceneElement,
} from "../src/components/workflow/scene";

test("embeds real canvas image and video by dragging, restores drafts and removes only references", async ({
  page,
}, info) => {
  const fixture = await createWorkflowFixture(
    process.env.DATABASE_URL!,
    "http://localhost:3228",
  );
  const folder = await mkdtemp(join(tmpdir(), "workflow-drop-"));
  let desktop: ElectronApplication | undefined;
  try {
    await page.setContent(
      '<main style="background:#a3c4af;width:320px;height:180px;padding:20px;font:28px sans-serif">Reference photo</main>',
    );
    const bytes = await page.screenshot();
    const photo = await savePrivateImage(fixture.db, fixture.storage, {
      workspaceId: fixture.workspaceId,
      userId: fixture.userId,
      uploadId: randomUUID(),
      bytes,
      mimeType: "image/png",
    });
    const videoPath = join(folder, "reference.mp4");
    const encoded = spawnSync(
      process.env.HELSTERA_FFMPEG || "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=320x180:r=30:d=1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-y",
        videoPath,
      ],
      { windowsHide: true, encoding: "utf8" },
    );
    expect(encoded.status, encoded.stderr).toBe(0);
    const clip = await savePrivateVideo(fixture.db, fixture.storage, {
      workspaceId: fixture.workspaceId,
      userId: fixture.userId,
      uploadId: randomUUID(),
      bytes: await readFile(videoPath),
      mimeType: "video/mp4",
      filename: "reference.mp4",
    });
    const base = {
      x: 500,
      y: 570,
      width: 160,
      height: 100,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      boundElements: null,
      index: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      updated: Date.now(),
      locked: false,
    };
    const image: SceneElement = {
      ...base,
      id: "drop-photo",
      type: "image",
      fileId: "reference-file",
      status: "saved",
      scale: [1, 1],
      customData: { assetId: photo.assetId, title: "角色参考图" },
    };
    const video: SceneElement = {
      ...base,
      x: 760,
      id: "drop-video",
      type: "embeddable",
      link: `http://localhost:3315/api/uploads/${clip.assetId}/file`,
      customData: { assetId: clip.assetId, title: "真实录像", isVideo: true },
    };
    const graph: WorkflowGraph = {
      title: "拖入参考素材验收",
      nodes: [
        {
          id: "generate",
          title: "参考图创作",
          position: { x: 500, y: 200 },
          config: {
            kind: "generate",
            mediaType: "image",
            model: "reference-model",
            prompt: "根据参考素材设计",
            aspectRatio: "16:9",
            duration: 5,
            resolution: "720p",
          },
        },
        {
          id: "deliver",
          title: "输出画布",
          position: { x: 900, y: 200 },
          config: { kind: "deliver" },
        },
      ],
      edges: [{ id: "gen-out", source: "generate", target: "deliver" }],
    };
    const doc = await new CanvasWorkflowService(fixture.db).create(
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
          elements: projectWorkflow([image, video], doc.id, graph, {}, false),
          appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } },
          files: {
            "reference-file": {
              id: "reference-file",
              dataURL: `data:image/png;base64,${bytes.toString("base64")}`,
              mimeType: "image/png",
              created: Date.now(),
            },
          },
        }),
      ],
    );
    if (process.env.HELT_TEST_CANDIDATE_PATH) {
      const env = {
        ...process.env,
        HELSTERA_ISOLATED_TEST: "1",
        HELSTERA_TEST_USER_DATA: join(folder, "desktop"),
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
    await page.getByRole("button", { name: "打开可视化工作流" }).click();
    const workspace = page.getByRole("region", {
      name: "可视化工作流",
      exact: true,
    });
    await workspace.getByRole("button",{name:"定位流程节点",exact:true}).click();
    await expect(
      workspace.getByRole("button", { name: /图片 \/ 视频生成 参考图创作/ }),
    ).toBeVisible();
    const target = page.locator('[data-workflow-node="generate"]');
    await expect(target).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("v");
    const dragMedia = async (source: SceneElement) => {
      let lastBounds = "";
      await expect
        .poll(
          async () => {
            const current = JSON.stringify(await target.boundingBox());
            const stable = current === lastBounds;
            lastBounds = current;
            return stable;
          },
          { intervals: [100, 150, 250] },
        )
        .toBe(true);
      const bounds = (await target.boundingBox())!;
      const scale = bounds.width / 300;
      await page.mouse.move(
        bounds.x + (source.x - 500 + source.width / 2) * scale,
        bounds.y + (source.y - 200 + source.height / 2) * scale,
      );
      await page.mouse.down();
      await page.mouse.move(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
        { steps: 20 },
      );
      await expect(
        page.getByRole("status").filter({ hasText: "松开嵌入" }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`embedding-${source.id}.png`),
      });
      await page.mouse.up();
    };
    await dragMedia(image);
    await expect(target.getByLabel("嵌入的参考素材")).toContainText(
      "参考素材 · 1",
    );
    await expect(target.getByRole("img", { name: "角色参考图" })).toBeVisible();
    await dragMedia(video);
    await expect(target.getByLabel("嵌入的参考素材")).toContainText(
      "参考素材 · 2",
    );
    const references = workspace.getByRole("region", { name: "生成参考素材" });
    await references
      .getByRole("spinbutton", { name: "取帧时刻（秒）" })
      .fill("0.4");
    await workspace
      .getByRole("button", { name: "保存草稿", exact: true })
      .click();
    await expect(
      workspace.getByRole("button", { name: "已保存", exact: true }),
    ).toBeDisabled();
    const saved = (
      await fixture.db.query("select graph from canvas_workflows where id=$1", [
        doc.id,
      ])
    ).rows[0].graph as WorkflowGraph;
    expect(
      saved.nodes.find((node) => node.config.kind === "frame")?.config,
    ).toEqual({ kind: "frame", at: 0.4 });
    expect(
      (await fixture.db.query("select count(*)::int as n from agent_goals"))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await fixture.db.query(
          "select count(*)::int as n from credit_transactions",
        )
      ).rows[0].n,
    ).toBe(0);
    const content = (
      await fixture.db.query("select content from canvases where id=$1", [
        fixture.canvasId,
      ])
    ).rows[0].content;
    expect(
      content.elements.find((el: SceneElement) => el.id === image.id),
    ).toMatchObject({ x: image.x, y: image.y, isDeleted: false });
    expect(
      content.elements.find((el: SceneElement) => el.id === video.id),
    ).toMatchObject({ x: video.x, y: video.y, isDeleted: false });
    await page.reload();
    await page.getByRole("button", { name: "打开可视化工作流" }).click();
    await expect(target.getByLabel("嵌入的参考素材")).toContainText(
      "参考素材 · 2",
    );
    await workspace
      .getByRole("button", { name: /图片 \/ 视频生成 参考图创作/ })
      .click();
    await expect(
      references.getByRole("spinbutton", { name: "取帧时刻（秒）" }),
    ).toHaveValue("0.4");
    await references
      .getByRole("button", { name: "移除参考素材：角色参考图" })
      .click();
    await expect(target.getByLabel("嵌入的参考素材")).toContainText(
      "参考素材 · 1",
    );
    await workspace.getByRole("button", { name: "撤销工作流修改" }).click();
    await expect(target.getByLabel("嵌入的参考素材")).toContainText(
      "参考素材 · 2",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 620, height: 900 });
    await page.screenshot({
      path: info.outputPath("embedded-references-narrow.png"),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await desktop?.close();
    await fixture.close();
    await rm(folder, { recursive: true, force: true });
  }
});
