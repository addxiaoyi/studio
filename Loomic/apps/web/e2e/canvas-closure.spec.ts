import {
  test,
  expect,
  _electron,
  type ElectronApplication,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPresentationFixture } from "../../server/src/features/website-capture/presentation-fixture";
import { registerLocalGrowthRoutes } from "../../server/src/http/local-growth";
import { registerPrivateVideoRoutes } from "../../server/src/http/private-video";
import { registerUploadRoutes } from "../../server/src/http/uploads";
import { createLocalUploadService } from "../../server/src/local-db/upload-service";
import {
  savePrivateImage,
  savePrivateVideo,
} from "../../server/src/features/assets/private-video";
import {
  buildVideoElement,
  buildImageElement,
} from "../../server/src/features/canvas/canvas-element-writer";

test("imports library IDs once, recovers failures, previews a real timeline and hands it to the editor", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const fixture = await createPresentationFixture(
    process.env.DATABASE_URL!,
    "http://localhost:3228",
    async (ctx) => {
      await ctx.app.register(
        createRequire(new URL("../../server/package.json", import.meta.url))(
          "@fastify/multipart",
        ),
      );
      registerLocalGrowthRoutes(ctx.app, ctx);
      registerPrivateVideoRoutes(ctx.app, ctx);
      await registerUploadRoutes(ctx.app, {
        ...ctx,
        uploadService: createLocalUploadService(ctx.db, ctx.root),
      });
      ctx.app.get("/api/workspace/settings", async () => ({
        settings: { autoDeleteEmptyCanvas: false },
      }));
    },
  );
  const folder = await mkdtemp(join(tmpdir(), "canvas-closure-"));
  let desktop: ElectronApplication | undefined;
  try {
    await page.setContent(
      '<main style="width:320px;height:180px;background:#dae7de;font:32px sans-serif">Helstera 验收素材</main>',
    );
    const photo = await savePrivateImage(fixture.db, fixture.storage, {
      workspaceId: fixture.workspaceId,
      userId: fixture.userId,
      uploadId: randomUUID(),
      bytes: await page.screenshot(),
      mimeType: "image/png",
    });
    const libraryId = (
      await fixture.db.query(
        "select id from generated_assets where object_path=(select object_path from asset_objects where id=$1)",
        [photo.assetId],
      )
    ).rows[0].id;
    const videoPath = join(folder, "clip.mp4"),
      ffmpeg =
        process.env.HELSTERA_FFMPEG ||
        (process.platform === "win32"
          ? resolve("../desktop/resources/ffmpeg/win-x64/ffmpeg.exe")
          : "ffmpeg");
    const encoded = spawnSync(
      ffmpeg,
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=320x180:r=30:d=2",
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
      filename: "clip.mp4",
    });
    const audioPath = join(folder, "voice.wav");
    const sound = spawnSync(
      ffmpeg,
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=3",
        "-y",
        audioPath,
      ],
      { windowsHide: true, encoding: "utf8" },
    );
    expect(sound.status, sound.stderr).toBe(0);
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
    await page.goto(
      `http://localhost:3228/${desktop ? "desktop-app/" : ""}canvas/?id=${fixture.canvasId}&assetId=${libraryId}`,
    );
    await expect(page.getByLabel("素材导入状态")).toContainText(
      "素材已在画布中",
      { timeout: 45000 },
    );
    const content = async () =>
      (
        await fixture.db.query("select content from canvases where id=$1", [
          fixture.canvasId,
        ])
      ).rows[0].content;
    await expect
      .poll(
        async () =>
          ((await content()).elements ?? []).filter(
            (item: any) => item.customData?.assetId === photo.assetId,
          ).length,
      )
      .toBe(1);
    await page.reload();
    await expect(page.getByLabel("素材导入状态")).toContainText(
      "素材已在画布中",
    );
    expect(
      (await content()).elements.filter(
        (item: any) => item.customData?.assetId === photo.assetId,
      ),
    ).toHaveLength(1);
    await page.screenshot({ path: info.outputPath("asset-import.png") });
    await page.goto(
      `http://localhost:3228/canvas/?id=${fixture.canvasId}&assetId=${randomUUID()}`,
    );
    await expect(page.getByRole("button", { name: "重试导入" })).toBeVisible();
    await expect(page.getByLabel("素材导入状态")).toContainText("已过期");
    const image = buildImageElement(
      "photo",
      { x: 0, y: 0, width: 320, height: 180 },
      {
        canvasId: fixture.canvasId,
        objectPath: "",
        width: 320,
        height: 180,
        mimeType: "image/png",
        assetId: photo.assetId,
        title: "封面",
      },
    );
    image.customData = { ...(image.customData as object), timelineDuration: 1 };
    const video = buildVideoElement(
      { x: 360, y: 0, width: 320, height: 180 },
      {
        canvasId: fixture.canvasId,
        signedUrl: `/api/uploads/${clip.assetId}/file`,
        width: 320,
        height: 180,
        mimeType: "video/mp4",
        assetId: clip.assetId,
        title: "真实录像",
        durationSeconds: 2,
      },
    );
    const caption = {
      ...image,
      id: "subtitle",
      type: "text",
      text: "时间线字幕",
      fontSize: 24,
      fontFamily: 1,
      originalText: "时间线字幕",
      textAlign: "center",
      verticalAlign: "top",
      baseline: 20,
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
      customData: { isSubtitle: true, subtitleStart: 0, subtitleEnd: 3 },
    };
    await fixture.db.query(
      "update canvases set content=$2::jsonb,version=version+1 where id=$1",
      [
        fixture.canvasId,
        JSON.stringify({
          elements: [caption, image, video],
          files: {},
          appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } },
        }),
      ],
    );
    await page.goto(`http://localhost:3228/canvas/?id=${fixture.canvasId}`);
    await page.getByRole("button", { name: "媒体时间线", exact: true }).click();
    await expect(page.getByLabel("时间线合成预览")).toBeVisible();
    const fileChooser = page.waitForEvent("filechooser");
    await page.locator("label").filter({ has: page.getByLabel("上传音频") }).click();
    const audioUploaded = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/api/uploads?purpose=timeline-audio"));
    await (await fileChooser).setFiles(audioPath);
    expect((await audioUploaded).ok()).toBe(true);
    await expect(
      page.getByRole("slider", { name: "voice.wav音量" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "播放预览", exact: true }).click();
    const player = page.getByLabel("时间线合成预览").locator("video");
    await expect(player).toBeVisible();
    await expect
      .poll(() =>
        player.evaluate((node) => (node as HTMLVideoElement).currentTime),
      )
      .toBeGreaterThan(0.15);
    await page.getByRole("button", { name: "暂停预览", exact: true }).click();
    await page.screenshot({ path: info.outputPath("timeline-preview.png") });
    await page.getByRole("button", { name: "创建成片", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "确认导入时间线" }),
    ).toBeEnabled({ timeout: 120000 });
    await page.getByRole("button", { name: "确认导入时间线" }).click();
    await expect(page.getByText("画布时间线已保存为独立合成")).toBeVisible({
      timeout: 60000,
    });
    await expect(
      page.getByRole("button", { name: "让 AI 继续剪辑" }),
    ).toBeEnabled();
    await page.screenshot({ path: info.outputPath("timeline-editor.png") });
    await expect(page).toHaveTitle("视频创作 | Helstera");
    const compositionUrl = page.url();
    await page.reload();
    await expect(page.getByRole("button", { name: "导出视频", exact: true })).toBeEnabled({ timeout: 60000 });
    await expect(page).toHaveURL(compositionUrl);
    await expect(page.getByLabel("修改对象")).toContainText("3.0s", { timeout: 45000 });
    await page.getByRole("button", { name: "导出视频", exact: true }).click();
    const exportDialog = page.locator("dialog[open]");
    await expect(exportDialog).toBeVisible();
    await exportDialog
      .getByRole("button", { name: "视频", exact: true })
      .click();
    await exportDialog
      .getByRole("button", { name: "容器", exact: true })
      .click();
    await exportDialog.getByText("WebM", { exact: true }).click();
    const output = info.outputPath("canvas-film.webm");
    if (desktop) {
      await desktop.evaluate(
        ({ session }, path) =>
          session.defaultSession.once("will-download", (_event, item) =>
            item.setSavePath(path),
          ),
        output,
      );
      await exportDialog.getByRole("button", { name: /导出.*视频/ }).click();
      await expect
        .poll(
          async () => {
            try {
              return (await readFile(output)).length;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
              throw error;
            }
          },
          { timeout: 90000 },
        )
        .toBeGreaterThan(1000);
    } else {
      const downloading = page.waitForEvent("download", { timeout: 90000 });
      await exportDialog.getByRole("button", { name: /导出.*视频/ }).click();
      await (await downloading).saveAs(output);
    }
    expect((await readFile(output)).length).toBeGreaterThan(1000);
    const decoded = spawnSync(
      ffmpeg,
      ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"],
      { windowsHide: true, encoding: "utf8", timeout: 30000 },
    );
    expect(decoded.status, decoded.stderr).toBe(0);
    const duration = spawnSync(ffmpeg, ["-i", output, "-f", "null", "-"], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 30000,
    });
    expect(duration.stderr).toMatch(/Duration: 00:00:03\./);
    expect(duration.stderr).toContain("Audio:");
    const frames = spawnSync(
      ffmpeg,
      [
        "-v",
        "error",
        "-i",
        output,
        "-vf",
        "fps=1,scale=16:16",
        "-f",
        "framemd5",
        "-",
      ],
      { windowsHide: true, encoding: "utf8", timeout: 30000 },
    );
    expect(
      new Set(
        frames.stdout
          .split("\n")
          .filter((line) => /^0,/.test(line))
          .map((line) => line.split(",").at(-1)),
      ).size,
    ).toBeGreaterThan(1);
    await page
      .getByRole("button", { name: "保存到私有素材库（三天临时副本）" })
      .click();
    await expect(
      page.getByRole("link", { name: "添加成片到原画布" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "添加成片到原画布" }).click();
    await expect(page.getByLabel("素材导入状态")).toContainText(
      "素材已在画布中",
      { timeout: 45000 },
    );
    await expect
      .poll(
        async () =>
          ((await content()).elements ?? []).filter(
            (item: any) => item.customData?.isVideo,
          ).length,
      )
      .toBe(2);
    await page.setViewportSize({ width: 800, height: 700 });
    const closePlayer = page.getByRole("button", { name: "关闭视频预览" });
    if (await closePlayer.isVisible()) {
      await closePlayer.focus();
      await page.keyboard.press("Escape");
      await expect(closePlayer).toBeHidden();
    }
    const chatOpen = page.getByRole("button", { name: "打开 AI 对话面板" });
    if (await chatOpen.isVisible()) await chatOpen.click();
    await expect(
      page.locator('#canvas-chat-panel[aria-modal="true"]'),
    ).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("canvas-chat-tablet.png") });
    if (desktop)
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2),
      );
    else await page.setViewportSize({ width: 720, height: 450 });
    const chatClose = page.getByRole("button", { name: "关闭 AI 对话面板" });
    if (await chatClose.isVisible()) await chatClose.click();
    await page.getByRole("button", { name: "媒体时间线", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "关闭时间线" }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "创建成片", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: info.outputPath(
        desktop ? "desktop-200-percent.png" : "timeline-narrow.png",
      ),
    });
  } finally {
    if (desktop) await desktop.close();
    await fixture.close();
    await rm(folder, { recursive: true, force: true });
  }
});
