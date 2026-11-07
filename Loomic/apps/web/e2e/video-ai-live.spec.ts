import { expect, test, _electron, type ElectronApplication, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { loadEnvFile } from "node:process";
import { mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createEditorBrowserFixture } from "../../server/src/features/video-editor/browser-fixture";

loadEnvFile(resolve("../../.env.local"));
const realModel = process.env.HELT_TEST_REAL_MODEL === "1";
const candidatePath = process.env.HELT_TEST_CANDIDATE_PATH;
test.skip(!realModel && process.env.HELT_TEST_EDITOR_FIXTURE !== "1", "Opt in to a real model or an explicitly injected test plan.");
let fixture: Awaited<ReturnType<typeof createEditorBrowserFixture>>;
let folder: string;
let electron: ElectronApplication | undefined;

async function captureEditor(page: Page, info: TestInfo, name: string) {
  await expect(page.getByTestId("studio-ai-plan")).toBeVisible();
  await expect(page.getByText("正在恢复编辑记录…", { exact: true })).toHaveCount(0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  if (!electron) { await page.screenshot({ path: info.outputPath(name) }); return; }
  const encoded = await electron.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Editor test window closed before evidence capture.");
    return (await window.webContents.capturePage()).toPNG().toString("base64");
  });
  await writeFile(info.outputPath(name), Buffer.from(encoded, "base64"));
  await info.attach(name, { body: Buffer.from(encoded, "base64"), contentType: "image/png" });
}

test.beforeAll(async () => {
  const commands = { summary: "当前合成审批与恢复测试", actions: [
    { type: "cut", format: "landscape", clips: [{ name: "clip.mp4", duration: 2, start: 0, end: 1.5 }] },
    { type: "caption", text: "编辑器真实验收", startMs: 0, endMs: 1000 },
    { type: "audio", assetName: "music.wav", startMs: 200, volume: 0.3 },
    { type: "export", format: "mp4" },
  ] };
  fixture = await createEditorBrowserFixture(process.env.DATABASE_URL!, process.env.E2E_BASE_URL ?? "http://localhost:3216", realModel ? undefined : JSON.stringify(commands));
  folder = await mkdtemp(join(tmpdir(), "loomic-ai-browser-"));
  const ffmpeg = resolve("../desktop/resources/ffmpeg/win-x64/ffmpeg.exe");
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(folder, "clip.mp4")]);
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", join(folder, "music.wav")]);
  if (candidatePath) {
    await mkdir(join(folder, "assets"));
    const env: NodeJS.ProcessEnv = { ...process.env, HELSTERA_ISOLATED_TEST: "1", HELSTERA_TEST_USER_DATA: join(folder, "profile"), HELSTERA_DESKTOP_LOCAL_URL: "http://localhost:3216" };
    delete env.ELECTRON_RUN_AS_NODE;
    electron = await _electron.launch({ executablePath: candidatePath, args: [], env: Object.fromEntries(Object.entries(env).filter((item): item is [string, string] => item[1] !== undefined)), timeout: 30_000 });
    console.log("NATIVE_ASSET_DIRECTORY", join(folder, "assets"));
  } else if (process.env.HELT_TEST_ELECTRON_PATH) {
    const env: NodeJS.ProcessEnv = { ...process.env, HELT_ELECTRON_SMOKE_OUT: folder, HELT_TEST_FFMPEG: ffmpeg, HELT_TEST_FFPROBE: resolve("../desktop/resources/ffmpeg/win-x64/ffprobe.exe") };
    delete env.ELECTRON_RUN_AS_NODE;
    execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "scripts/video-electron-smoke.vite.ts"], { cwd: resolve("../desktop"), env });
    electron = await _electron.launch({ executablePath: process.env.HELT_TEST_ELECTRON_PATH, args: [resolve("../desktop/scripts/video-editor-electron.cjs")], env: Object.fromEntries(Object.entries(env).filter((item): item is [string, string] => item[1] !== undefined)), timeout: 30_000 });
  }
});
test.afterAll(async () => { await electron?.close(); await fixture?.close(); });

test("real auth, approval and current-composition edits survive a lost receipt and refresh", async ({ page, context }, info) => {
  if (candidatePath) test.setTimeout(600_000);
  if (electron) { page = await electron.firstWindow(); context = electron.context(); }
  info.annotations.push({ type: "model-source", description: realModel ? "real configured provider" : "injected test plan; does not validate model inference" });
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  const login = await context.request.post("http://localhost:3311/api/local-auth/password", { data: { email: fixture.email, password: fixture.password } });
  expect(login.status()).toBe(200);
  await page.goto(`${process.env.E2E_BASE_URL ?? "http://localhost:3216"}/video/?/MyComp`);
  await expect(page.getByLabel("导入本机素材")).toBeEnabled({ timeout: 90_000 });
  await page.getByLabel("导入本机素材").setInputFiles([join(folder, "clip.mp4"), join(folder, "music.wav")]);
  await page.getByRole("button", { name: "AI 编辑", exact: true }).click();
  const goal = page.getByLabel("描述视频编辑目标");
  await goal.fill("使用 clip.mp4 的第0至1.5秒替换当前合成为横屏，在0至1秒插入字幕‘编辑器真实验收’，添加 music.wav 从0.2秒开始以30%音量播放，最后导出MP4。严格执行这些参数。");
  await page.getByText("背景音乐（可选）", { exact: true }).click();
  await page.getByLabel("背景音乐素材", { exact: true }).selectOption("music.wav");
  await page.getByLabel("音乐起播（秒）", { exact: true }).fill("0.2");
  const snapshotCheck = await page.evaluate(async () => {
    try { return await (window as any).remotion_browserStudio.loomicSnapshot("MyComp"); }
    catch (error) { return { error: (error as Error).stack }; }
  });
  expect(snapshotCheck.error, snapshotCheck.error).toBeUndefined();
  const planned = page.waitForResponse(response => response.url().endsWith("/api/video/editor/plan"), { timeout: 80_000 }).catch(async error => { console.log("AI panel:", await page.getByLabel("AI 编辑当前合成", { exact: true }).innerText()); throw error; });
  await page.getByRole("button", { name: "预览修改方案", exact: true }).click();
  const response = await planned;
  expect(response.status(), await response.text()).toBe(200);
  const payload = await response.json();
  expect(payload.source).toBe("model");
  expect(payload.plan.actions.map((action: { type: string }) => action.type)).toEqual(expect.arrayContaining(["cut", "caption", "audio", "export"]));
  expect((await fixture.db.query("select status from video_editor_plans where id=$1", [payload.approval.id])).rows[0].status).toBe("pending");
  const confirm = page.getByRole("button", { name: "确认并应用修改", exact: true });
  await expect(confirm).toBeDisabled();
  const plan = page.getByTestId("studio-ai-plan");
  for (const checkbox of await plan.getByRole("checkbox").all()) await checkbox.check();
  await page.route("**/api/video/editor/plans/*/complete", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "测试：回执连接中断" } }) }), { times: 1 });
  await confirm.click();
  await expect(page.getByRole("heading", { name: "修改已应用", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "重试同步记录", exact: true })).toBeVisible();
  expect((await fixture.db.query("select status from video_editor_plans where id=$1", [payload.approval.id])).rows[0].status).toBe("approved");
  const applied = await page.evaluate(async userId => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("loomic-visualforge-projects", 3); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise<{ files: Record<string, string>; loomicAppliedEdits: string[] }>((resolve, reject) => { const request = db.transaction("projects").objectStore("projects").get(userId); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  }, fixture.userId);
  expect(applied.loomicAppliedEdits).toEqual([payload.approval.id]);
  expect(Object.values(applied.files).join("\n")).toContain("编辑器真实验收");
  await captureEditor(page, info, "ai-edit-applied.png");
  await page.reload();
  await expect(page.getByLabel("导入本机素材")).toBeEnabled({ timeout: 90_000 });
  await page.getByRole("button", { name: "AI 编辑", exact: true }).click();
  await expect.poll(async () => (await fixture.db.query("select editor_applied_at is not null as applied from video_editor_plans where id=$1", [payload.approval.id])).rows[0].applied).toBe(true);
  expect((await fixture.db.query("select status from video_editor_plans where id=$1", [payload.approval.id])).rows[0].status).toBe("approved");
  await expect(page.getByRole("heading", { name: "修改已应用", exact: true })).toBeVisible();
  const restored = await page.evaluate(async () => (window as any).remotion_browserStudio.loomicSnapshot("MyComp"));
  expect(restored.captions).toEqual([{ text: "编辑器真实验收", startMs: 0, endMs: 1000 }]);
  expect(restored.duration).toBe(1.5);
  const duplicate = await context.request.post(`http://localhost:3311/api/video/editor/plans/${payload.approval.id}/complete`, { data: { fingerprint: payload.approval.fingerprint } });
  expect(duplicate.status()).toBe(200);
  if (electron) {
    if (candidatePath) {
      console.log("NATIVE_FOLDER_PICKER_READY");
      const selected = await page.evaluate(() => (window as any).electronAPI.selectAssetFolder());
      expect(selected, "The native folder picker must select the isolated acceptance directory.").not.toBeNull();
      expect(selected.path).toBe(join(folder, "assets"));
      expect(selected.kind).toBe("native");
      expect(selected.availableBytes).toBeGreaterThan(0);
      const savedFolder = await page.evaluate(() => (window as any).electronAPI.getAssetFolderStatus());
      expect(savedFolder).toMatchObject({ path: join(folder, "assets"), permission: "granted" });
    }
    const exportButton = page.getByTestId("studio-ai-plan").getByRole("button", { name: "导出视频", exact: true });
    if (candidatePath) console.log("NATIVE_DECLINE_READY");
    await exportButton.click();
    await expect(page.getByText("已取消导出，没有生成文件。", { exact: true })).toBeVisible({ timeout: candidatePath ? 120_000 : 5_000 });
    expect(await readdir(join(folder, "assets"))).toEqual([]);
    if (candidatePath) console.log("NATIVE_EXPORT_CONFIRM_READY");
    else await electron.evaluate(() => { (globalThis as any).loomicTestExportApproved = true; });
    await page.route("**/api/video/editor/plans/*/complete", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "测试：成片回执连接中断" } }) }), { times: 1 });
    await exportButton.click();
    await expect(page.getByRole("button", { name: "成片已保存", exact: true })).toBeVisible({ timeout: candidatePath ? 120_000 : 60_000 });
    const video = page.getByLabel("本机导出记录").locator("video");
    await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    const exports = (await readdir(join(folder, "assets"))).filter(name => name.endsWith(".mp4"));
    expect(exports).toHaveLength(1);
    const output = join(folder, "assets", exports[0]!);
    expect((await stat(output)).size).toBeGreaterThan(1000);
    const probe = JSON.parse(execFileSync(resolve("../desktop/resources/ffmpeg/win-x64/ffprobe.exe"), ["-v", "error", "-show_streams", "-of", "json", output], { encoding: "utf8" }));
    expect(probe.streams.map((stream: { codec_type: string }) => stream.codec_type)).toEqual(expect.arrayContaining(["audio", "video"]));
    await expect(page.getByRole("button", { name: "重试同步记录", exact: true })).toBeVisible();
    expect((await fixture.db.query("select status from video_editor_plans where id=$1", [payload.approval.id])).rows[0].status).toBe("approved");
    await page.reload();
    await page.getByRole("button", { name: "AI 编辑", exact: true }).click();
    await expect(page.getByRole("button", { name: "成片已保存", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("本机导出记录").locator("video")).toBeVisible();
    await expect.poll(async () => (await fixture.db.query("select status from video_editor_plans where id=$1", [payload.approval.id])).rows[0].status).toBe("completed");
    expect((await readdir(join(folder, "assets"))).filter(name => name.endsWith(".mp4"))).toEqual(exports);
    const nativeApproval = candidatePath ? "native-dialog" : "test-controlled";
    await writeFile(info.outputPath("electron-export.json"), JSON.stringify({ output, streams: probe.streams, nativeApproval, rejectedBeforeExport: true, exportReceiptRecovered: true }, null, 2));
    await info.attach("electron-export", { body: JSON.stringify({ output, streams: probe.streams, nativeApproval, rejectedBeforeExport: true }), contentType: "application/json" });
  }
  await expect(page.getByRole("region", { name: "视频创作工作台", exact: true }).getByRole("alert")).toHaveCount(0);
  expect(failures).toEqual([]);
  await captureEditor(page, info, "ai-edit-restored.png");
  await info.attach("model-plan", { body: JSON.stringify({ inference: realModel ? "real" : "injected-fixture", model: payload.model, source: payload.source, plan: payload.plan }), contentType: "application/json" });
});
