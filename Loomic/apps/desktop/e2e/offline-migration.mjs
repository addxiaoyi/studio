import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { cp, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve, parse } from "node:path";
const require = createRequire(new URL("../../web/package.json", import.meta.url)), { _electron, expect } = require("@playwright/test");
const output = resolve(process.env.HELT_OFFLINE_TEST_DIR || "test-results/offline-migration");
const executablePath = process.env.HELT_DESKTOP_EXE; if (!executablePath) throw new Error("Desktop executable is required.");
await mkdir(join(output, "original"), { recursive: true });
const original = await realpath(join(output, "original"));
const movedPath = process.env.HELT_MIGRATED_WORKSPACE || join(output, "moved");
const account = randomUUID(), asset = randomUUID(), replacement = randomUUID(), project = randomUUID();
const media = join(original, "Media", account), projects = join(original, "Projects", account), profile = join(output, "profile");
await mkdir(media, { recursive: true }); await mkdir(projects, { recursive: true }); await mkdir(profile, { recursive: true });
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=", "base64");
const file = join(media, "original.png"); await writeFile(file, image);
const videoAsset = randomUUID(), videoReplacement = randomUUID();
const videoBytes = await readFile(new URL("./fixtures/local-preview.mp4", import.meta.url));
const videoPath = join(media, "local-preview.mp4"); await writeFile(videoPath, videoBytes);
const canvas = { id: randomUUID(), content: { elements: [{ id: "title", type: "text", x: 20, y: 20, width: 200, height: 60, text: "旧标题" }, { id: "image", type: "image", x: 20, y: 100, width: 100, height: 100, link: `/api/uploads/${asset}/file` }], appState: {}, files: {} } };
const snapshot = { format: "helstera-project-backup", formatVersion: 1, project: { id: project, name: "离线迁移工程", workspace: { ownerUserId: account } }, canvas, sessions: [{ id: randomUUID(), title: "本地对话", messages: [{ id: randomUUID(), role: "user", content: "离线保留的创作要求", createdAt: "2026-11-01T00:00:00Z" }] }] };
await writeFile(join(projects, "older.json"), JSON.stringify(snapshot));
const newer = structuredClone(snapshot); newer.canvas.content.elements[0].text = "新标题"; newer.canvas.content.elements.push({ id: "added", type: "rectangle", x: 250, y: 20, width: 100, height: 60 });
newer.canvas.content.elements.push({ id: "video", type: "embeddable", x: 160, y: 100, width: 160, height: 90, link: `/api/uploads/${videoAsset}/file`, customData: { isVideo: true } });
await writeFile(join(projects, "newer.json"), JSON.stringify(newer));
await writeFile(join(projects, "backup-index.json"), JSON.stringify({ account, status: "completed", items: [{ key: `asset:${asset}`, receipt: { path: file, bytes: image.length, sha256: createHash("sha256").update(image).digest("hex"), savedAt: "2026-11-01T00:00:00Z" } }, { key: `project:${project}:older`, receipt: { path: join(projects, "older.json"), savedAt: "2026-11-01T00:00:00Z" } }, { key: `project:${project}:newer`, receipt: { path: join(projects, "newer.json"), savedAt: "2026-11-02T00:00:00Z" } }] }));
const backupIndex = JSON.parse(await readFile(join(projects, "backup-index.json"), "utf8"));
backupIndex.items.push({ key: `asset:${videoAsset}`, receipt: { path: videoPath, bytes: videoBytes.length, sha256: createHash("sha256").update(videoBytes).digest("hex"), savedAt: "2026-11-02T00:00:00Z" } });
await writeFile(join(projects, "backup-index.json"), JSON.stringify(backupIndex));
await writeFile(join(profile, "desktop-setup.json"), JSON.stringify({ version: 1, completed: true, root: original, autoBackup: false, agentAccess: false }));
let requests = 0, uploaded = 0, restored = 0;
let videoOffset = 0;
const server = createServer((req, res) => {
  if (req.url.startsWith("/api/")) requests++;
  const json = value => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
  if (req.url === "/api/viewer") return json({ profile: { id: account } });
  if (req.url === "/api/assets/private-video/uploads") return json({ ok: true, data: [] });
  if (req.url === `/api/uploads/${asset}/file`) { res.writeHead(404); res.end(); return; }
  if (req.url === `/api/uploads/${videoAsset}/file`) { res.writeHead(404); res.end(); return; }
  if (req.url.startsWith("/api/assets/private-video/uploads/")) {
    const chunks = []; req.on("data", chunk => chunks.push(chunk)); req.on("end", () => {
      if (req.method === "PATCH") { const part = Buffer.concat(chunks); assert.deepEqual(part, videoBytes.subarray(videoOffset, videoOffset + part.length)); videoOffset += part.length; }
      json({ ok: true, data: { offset: videoOffset, bytes: videoBytes.length, chunkBytes: 8192, assetId: req.method === "POST" ? videoReplacement : null } });
    }); return;
  }
  if (req.url === "/api/assets/private-try-on") { const chunks = []; req.on("data", chunk => chunks.push(chunk)); req.on("end", () => { assert.ok(Buffer.concat(chunks).includes(image)); uploaded++; json({ assetId: replacement }); }); return; }
  if (req.url === "/api/project-backups/restore") { const chunks = []; req.on("data", chunk => chunks.push(chunk)); req.on("end", () => { assert.equal(JSON.parse(Buffer.concat(chunks)).replacements[asset], replacement); restored++; json({ ok: true, data: { projectId: project, canvasId: canvas.id, sessionId: snapshot.sessions[0].id, restored: true } }); }); return; }
  res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>Helstera migration acceptance</h1>");
});
await new Promise(done => server.listen(0, "127.0.0.1", done)); const port = server.address().port;
const env = { ...process.env, HELSTERA_ISOLATED_TEST: "1", HELSTERA_TEST_USER_DATA: profile, HELSTERA_DESKTOP_LOCAL_URL: `http://127.0.0.1:${port}` }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
let app;
try {
  app = await _electron.launch({ executablePath, env }); let page = await app.firstWindow(); await expect(page.getByRole("heading", { name: "Helstera migration acceptance" })).toBeVisible();
  await page.evaluate(() => { void window.electronAPI.openOfflineSnapshots(); }); await expect(page.getByRole("heading", { name: "快照与创作记录" })).toBeVisible();
  const before = requests; server.closeAllConnections(); await new Promise(done => server.close(done));
  await expect(page.getByText(/2 份本地快照/)).toBeVisible();
  await page.locator("#list button").first().click(); await expect(page.locator("#diff")).toContainText("元素新增 2、修改 1");
  await page.getByRole("button", { name: "预览 本地素材 1", exact: true }).click();
  await expect.poll(() => page.locator("#media-preview img").evaluate(image => image.naturalWidth)).toBe(1);
  await page.getByRole("button", { name: "预览 本地素材 2", exact: true }).click();
  const player = page.locator("#media-preview video");
  await expect.poll(() => player.evaluate(video => video.readyState)).toBeGreaterThanOrEqual(1);
  await player.evaluate(async video => { video.muted = true; video.currentTime = 0.5; await video.play(); });
  await expect.poll(() => player.evaluate(video => video.currentTime)).toBeGreaterThan(0.7);
  await player.evaluate(video => { video.pause(); video.currentTime = 1.4; });
  await expect.poll(() => player.evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(1.4);
  await expect(page.locator("#disk")).toContainText("本地磁盘可用");
  await expect(page.locator("#messages")).toContainText("离线保留的创作要求");
  await page.getByRole("button", { name: "加入待恢复列表" }).click(); await expect(page.locator("#queued")).toContainText("已存入本地");
  const offlineRequests = requests - before;
  assert.equal(offlineRequests, 0); assert.equal(uploaded, 0); assert.equal(restored, 0);
  await page.screenshot({ path: join(output, "offline-preview.png") });
  await app.close(); app = undefined;
  app = await _electron.launch({ executablePath, env }); page = await app.firstWindow();
  await expect(page.getByRole("button", { name: "离线浏览本地快照" })).toBeVisible({ timeout: 45000 });
  await page.getByRole("button", { name: "离线浏览本地快照" }).click();
  await expect(page.getByText(/2 份本地快照/)).toBeVisible();
  await app.close(); app = undefined;
  await cp(original, movedPath, { recursive: true, errorOnExist: true, force: false }); const moved = await realpath(movedPath);
  await writeFile(file, "old drive must not be used");
  await new Promise(done => server.listen(port, "127.0.0.1", done));
  app = await _electron.launch({ executablePath, env }); page = await app.firstWindow(); await expect(page.getByRole("heading", { name: "Helstera migration acceptance" })).toBeVisible();
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, moved);
  await page.evaluate(async () => { await window.electronAPI.chooseDesktopWorkspace(); await window.electronAPI.completeDesktopSetup({ autoBackup: false, agentAccess: false }); });
  const credentials = { accountId: account, accessToken: "migration" };
  const tasks = await page.evaluate(input => window.electronAPI.getRestoreTasks(input), credentials); assert.equal(tasks.tasks.length, 1);
  const preview = await page.evaluate(input => window.electronAPI.previewRestoreTask(input.id, input.credentials), { id: tasks.tasks[0].id, credentials }); assert.equal(preview.localMedia, 2); assert.equal(preview.missingMedia, 0);
  await page.evaluate(input => window.electronAPI.restoreLocalProject(input.id, input.credentials), { id: preview.id, credentials }); assert.equal(uploaded, 1); assert.equal(restored, 1);
  assert.deepEqual(await readFile(join(moved, "Media", account, "original.png")), image);
  await app.close(); app = await _electron.launch({ executablePath, env }); page = await app.firstWindow(); await expect(page.getByRole("heading", { name: "Helstera migration acceptance" })).toBeVisible();
  assert.equal((await page.evaluate(() => window.electronAPI.getDesktopSetup())).root, moved);
  const shared = structuredClone(snapshot); shared.project.id = randomUUID(); shared.project.name = "保留共用图片的工程";
  await writeFile(join(moved, "Projects", account, "shared.json"), JSON.stringify(shared));
  await page.evaluate(() => { void window.electronAPI.openOfflineSnapshots(); });
  await page.getByRole("button", { name: "按工程管理本地空间" }).click();
  await page.getByRole("button", { name: /离线迁移工程 · 2 份快照/ }).click();
  await expect(page.locator("#cleanup-summary")).toContainText("保留 1 个共用素材");
  await expect(page.getByRole("button", { name: "确认清理本地文件" })).toBeDisabled();
  await page.locator("#cleanup-accept").check(); await page.getByRole("button", { name: "确认清理本地文件" }).click();
  await expect(page.locator("#cleanup-status")).toContainText("已清理 3 个文件");
  assert.deepEqual(await readFile(join(moved, "Media", account, "original.png")), image);
  await assert.rejects(stat(join(moved, "Media", account, "local-preview.mp4")), { code: "ENOENT" });
  const report = { ok: true, original, moved, differentVolumes: parse(original).root !== parse(moved).root, offlineNetworkRequests: offlineRequests, coldOfflineStart: true, offlineQueued: true, overviewAndDiff: true, relocatedMediaVerified: true, oldDriveIgnored: true, restartRestored: true, realImagePreview: true, realVideoPlaybackAndSeek: true, cleanupConfirmed: true, sharedMediaPreserved: true };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2)); console.log("OFFLINE_MIGRATION_PASSED", JSON.stringify(report));
} finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
