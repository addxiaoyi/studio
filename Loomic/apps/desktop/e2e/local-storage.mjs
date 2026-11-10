import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
const webRequire = createRequire(new URL("../../web/package.json", import.meta.url));
const { _electron, expect } = webRequire("@playwright/test");
const executablePath = process.env.HELT_DESKTOP_EXE;
if (!executablePath) throw new Error("HELT_DESKTOP_EXE is required.");
const output = resolve(process.env.HELT_STORAGE_TEST_DIR || "test-results/local-storage");
const workspace = join(output, "本地创作工作区");
await mkdir(workspace, { recursive: true });
const account = "123e4567-e89b-42d3-a456-426614174000";
const asset = "123e4567-e89b-42d3-a456-426614174001";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=", "base64");
let failDownload = false;
let restoredProjects = 0;
const upload = "123e4567-e89b-42d3-a456-426614174002";
const resumeOffsets = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = value => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
  if (url.pathname.startsWith("/api/") && (req.headers.authorization !== "Bearer local-session" || !req.headers.cookie?.includes("helstera_session=private-test"))) { res.writeHead(401); res.end(); return; }
  if (url.pathname === "/api/viewer") return json({ profile: { id: account } });
  if (url.pathname === "/api/assets/history") return json({ data: [{ id: asset, asset_object_id: asset, title: "云端图片", mime_type: "image/png" }], pagination: { hasMore: false } });
  if (url.pathname === `/api/uploads/${asset}/file`) {
    const offset = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0); resumeOffsets.push(offset);
    if (failDownload) { res.writeHead(200, { "content-type": "image/png", "content-length": png.length, etag: '"original"' }); res.write(png.subarray(0, 20)); setTimeout(() => res.destroy(), 30); return; }
    res.writeHead(offset ? 206 : 200, { "content-type": "image/png", "content-length": png.length - offset, etag: '"original"', ...(offset ? { "content-range": `bytes ${offset}-${png.length - 1}/${png.length}` } : {}) }); res.end(png.subarray(offset)); return;
  }
  if (url.pathname === "/api/assets/private-try-on") {
    const chunks = []; req.on("data", chunk => chunks.push(chunk)); req.on("end", () => { assert.ok(Buffer.concat(chunks).includes(png)); json({ ok: true, assetId: upload }); }); return;
  }
  if (url.pathname === "/api/project-backups/restore") {
    const chunks = []; req.on("data", chunk => chunks.push(chunk)); req.on("end", () => { const body = JSON.parse(Buffer.concat(chunks)); assert.equal(body.replacements[asset], upload); restoredProjects++; json({ ok: true, data: { projectId: upload, canvasId: upload, sessionId: account, restored: true } }); }); return;
  }
  if (url.pathname === "/api/projects") return json({ projects: [{ id: account, name: "本地备份验收", primaryCanvas: { id: account } }] });
  if (url.pathname.endsWith("/sessions")) return json({ sessions: [{ id: account, title: "创作对话" }] });
  if (url.pathname.endsWith("/messages")) return json({ messages: [{ id: account, role: "user", content: "保存我的创作", createdAt: "2026-11-01T00:00:00.000Z" }] });
  if (url.pathname.startsWith("/api/canvases/")) return json({ canvas: { id: account, content: { elements: [{ type: "text", text: "真实工程快照" }, { type: "image", link: `/api/uploads/${asset}/file` }] } }, version: 1 });
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<html><body><h1>Helstera 工作区验收</h1></body></html>");
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const env = { ...process.env, HELSTERA_ISOLATED_TEST: "1", HELSTERA_TEST_USER_DATA: join(output, "profile"), HELSTERA_DESKTOP_LOCAL_URL: `http://127.0.0.1:${server.address().port}` };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
let desktop;
const checks = [];
try {
  desktop = await _electron.launch({ executablePath, env });
  let page = await desktop.firstWindow();
  await expect(page.getByRole("heading", { name: "给你的创作一个本地存放位置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存配置并进入工作台" })).toBeDisabled();
  await desktop.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, workspace);
  await page.getByRole("button", { name: "选择本地工作区" }).click();
  await expect(page.locator("#folder")).toHaveText(workspace);
  await page.locator("#agent").check();
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 720, height: 600 }));
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(380);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "保存配置并进入工作台" }).scrollIntoViewIfNeeded();
  const setupScreenshot = await desktop.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
  await writeFile(join(output, "setup-200-percent.png"), Buffer.from(setupScreenshot, "base64"));
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "保存配置并进入工作台" }).click();
  await expect(page.getByRole("heading", { name: "Helstera 工作区验收" })).toBeVisible();
  checks.push("firstLaunch", "folderWriteProbe", "setupAt200Percent");
  await desktop.context().addCookies([{ name: "helstera_session", value: "private-test", domain: "127.0.0.1", path: "/", httpOnly: true }]);
  const credentials = { accountId: account, accessToken: "local-session" };
  const first = await page.evaluate(input => window.electronAPI.runCloudBackup(input), credentials);
  assert.equal(first.status, "completed"); assert.equal(first.completed, 2);
  const image = first.items.find(item => item.key.startsWith("asset:")).receipt;
  assert.deepEqual(await readFile(image.path), png);
  assert.equal(image.sha256, createHash("sha256").update(png).digest("hex"));
  const snapshot = JSON.parse(await readFile(first.items.find(item => item.key.startsWith("project:")).receipt.path, "utf8"));
  assert.equal(snapshot.sessions[0].messages[0].content, "保存我的创作");
  checks.push("privateImageBytesAndHash", "canvasAndChatSnapshot");
  assert.equal((await page.evaluate(input => window.electronAPI.runCloudBackup(input), credentials)).skipped, 2);
  checks.push("deduplicatedRetry");
  await desktop.close(); desktop = await _electron.launch({ executablePath, env }); page = await desktop.firstWindow();
  await desktop.context().addCookies([{ name: "helstera_session", value: "private-test", domain: "127.0.0.1", path: "/", httpOnly: true }]);
  await expect(page.getByRole("heading", { name: "Helstera 工作区验收" })).toBeVisible();
  assert.equal((await page.evaluate(() => window.electronAPI.getDesktopSetup())).root, workspace);
  assert.equal((await page.evaluate(() => window.electronAPI.getCurrentWorkspace())).root, workspace);
  assert.equal((await page.evaluate(id => window.electronAPI.getCloudBackup(id), account)).items.length, 2);
  checks.push("setupAndAgentAccessRestored", "backupReceiptRestored");
  const { unlink } = await import("node:fs/promises"); await unlink(image.path); failDownload = true;
  const partial = await page.evaluate(input => window.electronAPI.runCloudBackup(input), credentials);
  assert.equal(partial.status, "partial"); assert.equal(partial.failed, 1);
  assert.equal((await readdir(join(workspace, "Media", account))).filter(name => !name.startsWith(".")).length, 0);
  failDownload = false;
  assert.equal((await page.evaluate(input => window.electronAPI.runCloudBackup(input), credentials)).completed, 1);
  assert.equal(resumeOffsets.at(-1), 20);
  checks.push("disconnectNoPartialFile", "retryAfterDisconnect");
  const snapshotPath = first.items.find(item => item.key.startsWith("project:")).receipt.path;
  await desktop.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, snapshotPath);
  const preview = await page.evaluate(input => window.electronAPI.inspectLocalProject(input), credentials);
  assert.equal(preview.messages, 1); assert.equal(preview.localMedia, 1); assert.equal(restoredProjects, 0);
  const restored = await page.evaluate(input => window.electronAPI.restoreLocalProject(input.id, input.credentials), { id: preview.id, credentials });
  assert.equal(restored.canvasId, upload);
  await page.evaluate(input => window.electronAPI.restoreLocalProject(input.id, input.credentials), { id: preview.id, credentials });
  assert.equal(restoredProjects, 1); checks.push("restorePreviewNoWrites", "restoreLocalMediaAndSnapshot", "restoreIdempotency");
  const report = { ok: true, checks, workspace, executablePath };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2)); console.log("LOCAL_STORAGE_PASSED", JSON.stringify(report));
} finally {
  if (desktop) await desktop.close();
  server.closeAllConnections(); await new Promise(done => server.close(done));
}
